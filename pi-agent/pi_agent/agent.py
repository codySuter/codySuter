"""The agent loop: chat with a local Ollama model that can call tools."""

import asyncio
import functools
import logging

import ollama

from .config import Settings
from .tools import fetch_page, web_search

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """\
You are a concise research assistant chatting over Telegram, running on a \
small local computer with no GPU, so every token you generate takes real time.

Rules:
- For anything involving current events, prices, weather, releases, or facts \
you are not certain about, call web_search first instead of guessing.
- If search snippets are not enough to answer confidently, call fetch_page on \
the most promising result URL and read it.
- Answer in a few short sentences or a short bullet list. No preamble, no \
filler, no repeating the question.
- When your answer comes from the web, end with the source URL(s), one per line.
- If the tools fail or you cannot find an answer, say so plainly.
"""

TOOL_SPECS = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": (
                "Search the web (DuckDuckGo). Returns a numbered list of "
                "results with title, URL and snippet."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query, a few keywords work best",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_page",
            "description": (
                "Download a web page and return its readable text content. "
                "Use it to read a search result in full."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "Full URL including http(s)://",
                    },
                },
                "required": ["url"],
            },
        },
    },
]


class Agent:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.client = ollama.AsyncClient(host=settings.ollama_host)

    async def _call_tool(self, name: str, args: dict) -> str:
        if name == "web_search":
            fn = functools.partial(
                web_search,
                str(args.get("query", "")),
                max_results=self.settings.search_max_results,
            )
        elif name == "fetch_page":
            fn = functools.partial(
                fetch_page,
                str(args.get("url", "")),
                char_limit=self.settings.page_char_limit,
            )
        else:
            return f"Unknown tool: {name}"
        return await asyncio.to_thread(fn)

    async def _chat(self, messages: list, use_tools: bool = True):
        kwargs = {
            "model": self.settings.model,
            "messages": messages,
            "options": {"num_ctx": 8192},
        }
        if use_tools:
            kwargs["tools"] = TOOL_SPECS
        # Thinking models (qwen3, deepseek-r1) burn minutes of CPU on hidden
        # reasoning tokens; ask Ollama to skip that, and retry plainly for
        # models that don't accept the parameter at all.
        try:
            return await self.client.chat(**kwargs, think=False)
        except (ollama.ResponseError, TypeError):
            return await self.client.chat(**kwargs)

    async def answer(self, history: list, user_message: str) -> str:
        """Run the tool-calling loop and return the final reply text."""
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        messages.extend(history)
        messages.append({"role": "user", "content": user_message})

        for round_no in range(self.settings.max_tool_rounds):
            last_round = round_no == self.settings.max_tool_rounds - 1
            response = await self._chat(messages, use_tools=not last_round)
            msg = response.message

            if not msg.tool_calls:
                return (msg.content or "").strip() or "(the model returned an empty reply)"

            messages.append(msg)
            for call in msg.tool_calls:
                name = call.function.name
                args = dict(call.function.arguments or {})
                log.info("tool call: %s(%s)", name, args)
                result = await self._call_tool(name, args)
                messages.append({"role": "tool", "tool_name": name, "content": result})

        # Unreachable: the last round is forced to run without tools.
        return "I ran out of search attempts without finding an answer."
