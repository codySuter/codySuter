# Pi Agent — a local AI assistant on a Raspberry Pi 5, driven from Telegram

A small, fully local AI agent for a Raspberry Pi 5 (16 GB). You message it on
Telegram, it runs a local LLM through [Ollama](https://ollama.com), and it can
**search the web** (DuckDuckGo, no API key) and **read pages** to answer
"look this up for me" style questions. Nothing about your conversation leaves
the Pi except the web searches themselves and Telegram transport.

```
You (Telegram app) ──► Telegram servers ──► bot (long polling, no open ports)
                                              │
                                              ▼
                                   Ollama (local LLM on the Pi)
                                              │ tool calls
                                              ▼
                             web_search (DuckDuckGo) / fetch_page
```

## What to expect from a Pi 5

The Pi 5 runs 3–4B models at ~5–8 tokens/sec and 7–8B models at ~2–3
tokens/sec, CPU-only. A typical search-and-answer round trip takes **30
seconds to a couple of minutes**. That's fine for "look this up and get back
to me" tasks, which is what this bot is for.

| Model | RAM used | Speed on Pi 5 | Notes |
|---|---|---|---|
| `llama3.2:3b` | ~3 GB | ★★★ fastest | good enough for simple lookups |
| `qwen3:4b` (default) | ~4 GB | ★★ | best balance of smarts and speed |
| `qwen2.5:7b` | ~6 GB | ★ slow | noticeably better reasoning |

All three support tool calling, which the agent requires. With 16 GB of RAM
you have plenty of headroom for any of them.

## Setup

### 1. Install Ollama on the Pi

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen3:4b
```

Optional but recommended on a Pi — keep the model loaded between questions so
you don't pay a ~20 s model-load penalty every time:

```bash
sudo systemctl edit ollama
```

and add:

```ini
[Service]
Environment="OLLAMA_KEEP_ALIVE=2h"
```

then `sudo systemctl restart ollama`.

### 2. Create the Telegram bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram, send `/newbot`,
   pick a name and username. Copy the **token** it gives you.
2. Message [@userinfobot](https://t.me/userinfobot) to get your numeric
   **user ID** (or skip this — the bot tells unauthorized users their ID).

### 3. Install the bot

```bash
# on the Pi
git clone <this repo> && cd <repo>/pi-agent   # or copy the pi-agent/ folder over
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
nano .env    # paste TELEGRAM_BOT_TOKEN, set ALLOWED_USER_IDS
```

### 4. Run it

```bash
.venv/bin/python -m pi_agent
```

Message your bot on Telegram. `/start` says hello, `/reset` clears the
conversation, anything else gets answered.

### 5. Run it as a service (start on boot)

```bash
sudo cp systemd/pi-agent.service /etc/systemd/system/
sudo nano /etc/systemd/system/pi-agent.service   # fix User/paths if needed
sudo systemctl daemon-reload
sudo systemctl enable --now pi-agent
journalctl -u pi-agent -f    # watch the logs
```

## Security notes

- The bot **only answers user IDs listed in `ALLOWED_USER_IDS`**; everyone
  else gets refused. Don't run it open — it can browse the web on your
  connection.
- It uses Telegram long polling, so you don't need to open any ports or have
  a public IP.
- Keep `.env` out of git (already covered by `.gitignore`).

## How it works

- `pi_agent/bot.py` — python-telegram-bot front-end: auth allowlist, typing
  indicator while the Pi thinks, one question at a time per chat, splits
  replies over Telegram's 4096-char limit.
- `pi_agent/agent.py` — the loop: sends your message (plus recent history) to
  Ollama with two tool definitions; when the model asks for a tool, runs it
  and feeds the result back, up to `MAX_TOOL_ROUNDS` times, then returns the
  final answer.
- `pi_agent/tools.py` — the tools: `web_search` (DuckDuckGo via the `ddgs`
  package, no API key) and `fetch_page` (httpx + trafilatura to extract
  readable article text, truncated to `PAGE_CHAR_LIMIT`).

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Something went wrong while answering" | `systemctl status ollama`; try `ollama run qwen3:4b "hi"` manually |
| Very slow first answer, fast after | Model loading from SD card — set `OLLAMA_KEEP_ALIVE` (see above), and use an NVMe HAT if you have one |
| `does not support tools` error in logs | Your `OLLAMA_MODEL` can't do tool calling — use one from the table above |
| Bot never replies, no logs | Wrong bot token, or another instance of the bot is polling with the same token |
| Search returns "Search failed" | DuckDuckGo rate limiting — wait a minute; it's occasional and self-heals |
