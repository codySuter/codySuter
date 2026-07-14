"""Telegram front-end: receives messages, runs the agent, replies."""

import asyncio
import logging
from datetime import datetime

from telegram import BotCommand, Update
from telegram.constants import ChatAction
from telegram.error import BadRequest
from telegram.ext import (
    Application,
    ApplicationBuilder,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from .agent import Agent
from .config import Settings
from .scheduler import (
    SCHEDULE_USAGE,
    describe_task,
    human_interval,
    next_occurrence,
    parse_schedule,
)
from .state import Store

log = logging.getLogger(__name__)

TELEGRAM_MESSAGE_LIMIT = 4096

COMMANDS = [
    ("start", "What this bot does"),
    ("reset", "Clear the conversation"),
    ("model", "Show or switch the local model"),
    ("schedule", "Schedule a recurring task"),
    ("tasks", "List scheduled tasks"),
    ("runtask", "Run a scheduled task now"),
    ("unschedule", "Remove a scheduled task"),
]

START_TEXT = """\
Hi! Ask me anything — I can search the web and read pages to answer. \
I run on a Raspberry Pi, so give me a minute per answer.

/model — show installed models or switch: /model llama3.2:3b
/schedule — recurring tasks, e.g.:
    /schedule 08:00 weather in berlin today
    /schedule 08:00 mon,fri tech news headlines
    /schedule every 4h bitcoin price right now
/tasks — list scheduled tasks
/runtask 1 — test task #1 now
/unschedule 1 — remove task #1
/reset — clear our conversation"""


def _chunks(text: str, size: int = TELEGRAM_MESSAGE_LIMIT - 96):
    for start in range(0, len(text), size):
        yield text[start : start + size]


class Bot:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.store = Store(settings.state_file)
        if self.store.model:
            settings.model = self.store.model
        self.agent = Agent(settings)
        # chat_id -> list of {"role": ..., "content": ...} (final turns only)
        self.histories: dict = {}
        self.locks: dict = {}

    # --- authorization -------------------------------------------------

    def _authorized(self, user_id: int) -> bool:
        return user_id in self.settings.allowed_user_ids

    async def _gate(self, update: Update) -> bool:
        user = update.effective_user
        if user is not None and self._authorized(user.id):
            return True
        if user is not None and update.effective_message is not None:
            log.warning("Rejected message from user id %s (%s)", user.id, user.full_name)
            await update.effective_message.reply_text(
                f"Sorry, this is a private bot. Your Telegram user ID is {user.id} — "
                "add it to ALLOWED_USER_IDS in the bot's .env file to get access."
            )
        return False

    # --- sending ---------------------------------------------------------

    async def _send_text(self, bot, chat_id: int, text: str):
        for chunk in _chunks(text):
            try:
                await bot.send_message(chat_id, chunk, parse_mode="Markdown")
            except BadRequest:
                # Text Telegram can't parse as Markdown; send it plain.
                await bot.send_message(chat_id, chunk)

    async def _keep_typing(self, bot, chat_id: int, stop: asyncio.Event):
        while not stop.is_set():
            try:
                await bot.send_chat_action(chat_id, ChatAction.TYPING)
            except Exception:
                pass
            try:
                await asyncio.wait_for(stop.wait(), timeout=6)
            except asyncio.TimeoutError:
                continue

    # --- basic handlers --------------------------------------------------

    async def cmd_start(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        if not await self._gate(update):
            return
        await self._send_text(context.bot, update.effective_chat.id, START_TEXT)

    async def cmd_reset(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        if not await self._gate(update):
            return
        self.histories.pop(update.effective_chat.id, None)
        await update.effective_message.reply_text("Conversation cleared.")

    async def on_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        message = update.effective_message
        if message is None or not message.text:
            return
        if not await self._gate(update):
            return

        chat_id = update.effective_chat.id
        lock = self.locks.setdefault(chat_id, asyncio.Lock())
        if lock.locked():
            await message.reply_text(
                "Still working on your previous question — one at a time, "
                "this Pi only has so many cores."
            )
            return

        async with lock:
            stop_typing = asyncio.Event()
            typing_task = asyncio.create_task(
                self._keep_typing(context.bot, chat_id, stop_typing)
            )
            try:
                history = self.histories.setdefault(chat_id, [])
                reply = await self.agent.answer(history, message.text)
                history.append({"role": "user", "content": message.text})
                history.append({"role": "assistant", "content": reply})
                del history[: -2 * self.settings.history_turns]
            except Exception:
                log.exception("Agent failed")
                reply = (
                    "Something went wrong while answering. Check that Ollama "
                    "is running (`systemctl status ollama`) and try again."
                )
            finally:
                stop_typing.set()
                await typing_task

            await self._send_text(context.bot, chat_id, reply)

    # --- /model ------------------------------------------------------------

    async def cmd_model(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        if not await self._gate(update):
            return
        chat_id = update.effective_chat.id
        requested = " ".join(context.args).strip() if context.args else ""

        try:
            listing = await self.agent.client.list()
            installed = {m.model: m for m in listing.models if m.model}
        except Exception as exc:
            log.warning("Could not list Ollama models: %s", exc)
            installed = None

        if not requested:
            lines = [f"Current model: {self.settings.model}", ""]
            if installed is None:
                lines.append("Couldn't reach Ollama to list installed models.")
            elif not installed:
                lines.append("No models installed — run `ollama pull qwen3:4b` on the Pi.")
            else:
                lines.append("Installed models (switch with /model <name>):")
                for name in sorted(installed):
                    size = installed[name].size
                    size_txt = f" ({size / 1e9:.1f} GB)" if size else ""
                    marker = "  ← current" if name == self.settings.model else ""
                    lines.append(f"• {name}{size_txt}{marker}")
            await self._send_text(context.bot, chat_id, "\n".join(lines))
            return

        if installed is None:
            await self._send_text(
                context.bot,
                chat_id,
                "Couldn't reach Ollama to verify that model, so I'm not switching. "
                "Is the Ollama service running?",
            )
            return

        resolved = next(
            (c for c in (requested, f"{requested}:latest") if c in installed), None
        )
        if resolved is None:
            await self._send_text(
                context.bot,
                chat_id,
                f"`{requested}` isn't installed. Run `ollama pull {requested}` on "
                "the Pi first, or pick one from /model.",
            )
            return

        self.settings.model = resolved
        self.store.model = resolved
        self.store.save()
        await self._send_text(
            context.bot,
            chat_id,
            f"Switched to {resolved}. (It needs tool-calling support to search "
            "the web — if answers stop using search, switch back.)",
        )

    # --- scheduled tasks -----------------------------------------------------

    async def cmd_schedule(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        if not await self._gate(update):
            return
        chat_id = update.effective_chat.id
        if context.application.job_queue is None:
            await self._send_text(
                context.bot,
                chat_id,
                "Scheduling is unavailable — reinstall dependencies: "
                "pip install -r requirements.txt",
            )
            return
        try:
            spec = parse_schedule(" ".join(context.args or []))
        except ValueError as exc:
            await self._send_text(context.bot, chat_id, str(exc))
            return

        task = self.store.add_task({**spec, "chat_id": chat_id})
        self._register_task(context.application.job_queue, task)

        if task["kind"] == "interval":
            when = f"first run in {human_interval(task['minutes'])}"
        else:
            when = "next run " + next_occurrence(task, datetime.now()).strftime(
                "%a %H:%M"
            )
        await self._send_text(
            context.bot, chat_id, f"Scheduled {describe_task(task)}\n({when})"
        )

    async def cmd_tasks(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        if not await self._gate(update):
            return
        chat_id = update.effective_chat.id
        tasks = [t for t in self.store.tasks if t["chat_id"] == chat_id]
        if not tasks:
            await self._send_text(
                context.bot, chat_id, "No scheduled tasks.\n\n" + SCHEDULE_USAGE
            )
            return
        lines = [describe_task(t) for t in tasks]
        lines.append("\n/runtask <id> tests one now; /unschedule <id> removes it.")
        await self._send_text(context.bot, chat_id, "\n".join(lines))

    async def _task_from_args(self, update: Update, context) -> dict | None:
        """Resolve '/cmd <id>' to a task owned by this chat, replying on errors."""
        chat_id = update.effective_chat.id
        args = context.args or []
        task = self.store.get_task(int(args[0])) if args and args[0].isdigit() else None
        if task is None or task["chat_id"] != chat_id:
            await self._send_text(
                context.bot, chat_id, "Give me a task number from /tasks."
            )
            return None
        return task

    async def cmd_unschedule(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        if not await self._gate(update):
            return
        task = await self._task_from_args(update, context)
        if task is None:
            return
        self.store.remove_task(task["id"])
        if context.application.job_queue is not None:
            for job in context.application.job_queue.get_jobs_by_name(f"task-{task['id']}"):
                job.schedule_removal()
        await self._send_text(
            context.bot, update.effective_chat.id, f"Removed {describe_task(task)}"
        )

    async def cmd_runtask(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        if not await self._gate(update):
            return
        task = await self._task_from_args(update, context)
        if task is None:
            return
        await self._send_text(
            context.bot, update.effective_chat.id, f"Running task #{task['id']} now…"
        )
        context.application.create_task(self._execute_task(context.bot, task))

    def _register_task(self, job_queue, task: dict):
        """Arm the job for a task. Daily tasks use a re-arming run_once chain
        with a plain seconds delay, which sidesteps timezone handling entirely
        (everything is computed from the Pi's local clock)."""
        name = f"task-{task['id']}"
        if task["kind"] == "interval":
            seconds = task["minutes"] * 60
            job_queue.run_repeating(
                self._on_job, interval=seconds, first=seconds, name=name, data=task["id"]
            )
        else:
            now = datetime.now()
            delay = (next_occurrence(task, now) - now).total_seconds()
            job_queue.run_once(self._on_job, when=max(delay, 1.0), name=name, data=task["id"])

    async def _on_job(self, context: ContextTypes.DEFAULT_TYPE):
        task = self.store.get_task(context.job.data)
        if task is None:
            return  # unscheduled after this run was armed
        try:
            await self._execute_task(context.bot, task)
        finally:
            if task["kind"] == "daily" and self.store.get_task(task["id"]) is not None:
                self._register_task(context.job_queue, task)

    async def _execute_task(self, bot, task: dict):
        chat_id = task["chat_id"]
        lock = self.locks.setdefault(chat_id, asyncio.Lock())
        async with lock:  # wait for any in-flight question; Pi does one at a time
            try:
                answer = await self.agent.answer([], task["prompt"])
            except Exception:
                log.exception("Scheduled task #%s failed", task["id"])
                answer = "The scheduled run failed — check that Ollama is running."
        await self._send_text(bot, chat_id, f"⏰ Task #{task['id']}: {task['prompt']}\n\n{answer}")

    # --- wiring ---------------------------------------------------------

    async def _post_init(self, app: Application):
        try:
            await app.bot.set_my_commands([BotCommand(c, d) for c, d in COMMANDS])
        except Exception:
            log.warning("Could not set the bot command menu", exc_info=True)
        if not self.store.tasks:
            return
        if app.job_queue is None:
            log.error(
                "%d saved task(s) NOT scheduled — job-queue support missing; "
                "reinstall with: pip install -r requirements.txt",
                len(self.store.tasks),
            )
            return
        for task in self.store.tasks:
            self._register_task(app.job_queue, task)
        log.info("Re-armed %d scheduled task(s)", len(self.store.tasks))

    def build(self) -> Application:
        app = (
            ApplicationBuilder()
            .token(self.settings.telegram_token)
            .post_init(self._post_init)
            .build()
        )
        app.add_handler(CommandHandler("start", self.cmd_start))
        app.add_handler(CommandHandler("reset", self.cmd_reset))
        app.add_handler(CommandHandler("model", self.cmd_model))
        app.add_handler(CommandHandler("schedule", self.cmd_schedule))
        app.add_handler(CommandHandler("tasks", self.cmd_tasks))
        app.add_handler(CommandHandler("runtask", self.cmd_runtask))
        app.add_handler(CommandHandler("unschedule", self.cmd_unschedule))
        app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, self.on_message))
        return app


def run(settings: Settings):
    if not settings.allowed_user_ids:
        log.warning(
            "ALLOWED_USER_IDS is empty — the bot will refuse everyone. "
            "Message the bot once and it will tell you your user ID."
        )
    Bot(settings).build().run_polling(allowed_updates=Update.ALL_TYPES)
