"""Telegram front-end: receives messages, runs the agent, replies."""

import asyncio
import logging

from telegram import Update
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

log = logging.getLogger(__name__)

TELEGRAM_MESSAGE_LIMIT = 4096


def _chunks(text: str, size: int = TELEGRAM_MESSAGE_LIMIT - 96):
    for start in range(0, len(text), size):
        yield text[start : start + size]


class Bot:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.agent = Agent(settings)
        # chat_id -> list of {"role": ..., "content": ...} (final turns only)
        self.histories: dict = {}
        self.locks: dict = {}

    # --- authorization -------------------------------------------------

    def _authorized(self, user_id: int) -> bool:
        return user_id in self.settings.allowed_user_ids

    async def _reject(self, update: Update):
        user = update.effective_user
        log.warning("Rejected message from user id %s (%s)", user.id, user.full_name)
        await update.effective_message.reply_text(
            f"Sorry, this is a private bot. Your Telegram user ID is {user.id} — "
            "add it to ALLOWED_USER_IDS in the bot's .env file to get access."
        )

    # --- handlers ------------------------------------------------------

    async def cmd_start(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        if not self._authorized(update.effective_user.id):
            await self._reject(update)
            return
        await update.effective_message.reply_text(
            "Hi! Ask me anything — I can search the web and read pages to "
            "answer. I run on a Raspberry Pi, so give me a minute per answer.\n\n"
            "/reset clears our conversation."
        )

    async def cmd_reset(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        if not self._authorized(update.effective_user.id):
            await self._reject(update)
            return
        self.histories.pop(update.effective_chat.id, None)
        await update.effective_message.reply_text("Conversation cleared.")

    async def on_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        message = update.effective_message
        if message is None or not message.text:
            return
        if not self._authorized(update.effective_user.id):
            await self._reject(update)
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
                self._keep_typing(context, chat_id, stop_typing)
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

            for chunk in _chunks(reply):
                try:
                    await message.reply_text(chunk, parse_mode="Markdown")
                except BadRequest:
                    # Model produced text Telegram can't parse as Markdown.
                    await message.reply_text(chunk)

    async def _keep_typing(self, context, chat_id: int, stop: asyncio.Event):
        while not stop.is_set():
            try:
                await context.bot.send_chat_action(chat_id, ChatAction.TYPING)
            except Exception:
                pass
            try:
                await asyncio.wait_for(stop.wait(), timeout=6)
            except asyncio.TimeoutError:
                continue

    # --- wiring ---------------------------------------------------------

    def build(self) -> Application:
        app = ApplicationBuilder().token(self.settings.telegram_token).build()
        app.add_handler(CommandHandler("start", self.cmd_start))
        app.add_handler(CommandHandler("reset", self.cmd_reset))
        app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, self.on_message))
        return app


def run(settings: Settings):
    if not settings.allowed_user_ids:
        log.warning(
            "ALLOWED_USER_IDS is empty — the bot will refuse everyone. "
            "Message the bot once and it will tell you your user ID."
        )
    Bot(settings).build().run_polling(allowed_updates=Update.ALL_TYPES)
