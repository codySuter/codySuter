"""Schedule parsing and timing for recurring tasks.

Tasks are plain JSON-friendly dicts so they persist in the state file:

  {"id": 1, "chat_id": 9, "prompt": "...", "kind": "daily",
   "hour": 8, "minute": 30, "days": [0, 4]}
  {"id": 2, "chat_id": 9, "prompt": "...", "kind": "interval", "minutes": 240}

"days" uses Python weekday numbers (0=Monday); None means every day.
All times of day are the Pi's local time — set it with `timedatectl`.
"""

import re
from datetime import datetime, timedelta

DAY_NAMES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
FULL_DAY_NAMES = [
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
]
MIN_INTERVAL_MINUTES = 5

SCHEDULE_USAGE = """\
How to schedule a task:

/schedule 08:00 weather in berlin today
/schedule 21:30 mon,thu any concerts announced in town this week?
/schedule every 4h bitcoin price right now

Start with a time of day (24h clock, Pi's local time) plus an optional \
day list, or `every <N>m / <N>h / <N>d` for intervals (minimum 5m). \
Everything after that is the question I'll answer on schedule."""


def _parse_days(token: str):
    """'mon,wed,fri' -> [0, 2, 4]; returns None if token isn't a day list."""
    days = set()
    for part in token.lower().split(","):
        if part in DAY_NAMES:
            days.add(DAY_NAMES.index(part))
        elif part in FULL_DAY_NAMES:
            days.add(FULL_DAY_NAMES.index(part))
        else:
            return None
    return sorted(days)


def parse_schedule(text: str) -> dict:
    """Parse '/schedule' arguments into a task dict (without id/chat_id).

    Raises ValueError with a user-facing message on bad input.
    """
    parts = text.strip().split()
    if len(parts) < 2:
        raise ValueError(SCHEDULE_USAGE)

    if parts[0].lower() == "every":
        match = re.fullmatch(r"(\d+)([mhd])", parts[1].lower())
        if not match:
            raise ValueError(SCHEDULE_USAGE)
        minutes = int(match.group(1)) * {"m": 1, "h": 60, "d": 1440}[match.group(2)]
        if minutes < MIN_INTERVAL_MINUTES:
            raise ValueError(f"Minimum interval is {MIN_INTERVAL_MINUTES} minutes.")
        prompt = " ".join(parts[2:])
        if not prompt:
            raise ValueError(SCHEDULE_USAGE)
        return {"kind": "interval", "minutes": minutes, "prompt": prompt}

    match = re.fullmatch(r"([01]?\d|2[0-3]):([0-5]\d)", parts[0])
    if not match:
        raise ValueError(SCHEDULE_USAGE)

    rest = parts[1:]
    days = None
    if rest:
        if rest[0].lower() == "daily":
            rest = rest[1:]
        else:
            parsed = _parse_days(rest[0])
            if parsed is not None:
                days = parsed
                rest = rest[1:]
    prompt = " ".join(rest)
    if not prompt:
        raise ValueError(SCHEDULE_USAGE)
    return {
        "kind": "daily",
        "hour": int(match.group(1)),
        "minute": int(match.group(2)),
        "days": days,
        "prompt": prompt,
    }


def next_occurrence(task: dict, now: datetime) -> datetime:
    """Next local datetime a daily-kind task should run."""
    candidate = now.replace(
        hour=task["hour"], minute=task["minute"], second=0, microsecond=0
    )
    if candidate <= now:
        candidate += timedelta(days=1)
    days = task.get("days")
    while days and candidate.weekday() not in days:
        candidate += timedelta(days=1)
    return candidate


def human_interval(minutes: int) -> str:
    if minutes % 1440 == 0:
        n = minutes // 1440
        return f"{n} day" + ("s" if n > 1 else "")
    if minutes % 60 == 0:
        n = minutes // 60
        return f"{n} hour" + ("s" if n > 1 else "")
    if minutes > 60:
        return f"{minutes // 60} h {minutes % 60} min"
    return f"{minutes} min"


def describe_task(task: dict) -> str:
    if task["kind"] == "interval":
        when = f"every {human_interval(task['minutes'])}"
    else:
        clock = f"{task['hour']:02d}:{task['minute']:02d}"
        if task.get("days"):
            names = ", ".join(DAY_NAMES[d].capitalize() for d in task["days"])
            when = f"{names} at {clock}"
        else:
            when = f"daily at {clock}"
    return f"#{task['id']} — {when} — {task['prompt']}"
