"""Tiny JSON persistence for runtime state: model choice and scheduled tasks."""

import json
import logging
import os

log = logging.getLogger(__name__)


class Store:
    def __init__(self, path: str):
        self.path = path
        self.model = None  # overrides OLLAMA_MODEL when set via /model
        self.next_task_id = 1
        self.tasks = []  # list of task dicts, see scheduler.py
        self._load()

    def _load(self):
        try:
            with open(self.path) as fh:
                data = json.load(fh)
        except FileNotFoundError:
            return
        except (json.JSONDecodeError, OSError):
            log.warning("Could not read state file %s; starting fresh", self.path)
            return
        self.model = data.get("model")
        self.next_task_id = int(data.get("next_task_id", 1))
        self.tasks = list(data.get("tasks", []))

    def save(self):
        data = {
            "model": self.model,
            "next_task_id": self.next_task_id,
            "tasks": self.tasks,
        }
        tmp = self.path + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(data, fh, indent=2)
        os.replace(tmp, self.path)

    # --- tasks -----------------------------------------------------------

    def add_task(self, task: dict) -> dict:
        task = {"id": self.next_task_id, **task}
        self.next_task_id += 1
        self.tasks.append(task)
        self.save()
        return task

    def get_task(self, task_id: int):
        for task in self.tasks:
            if task["id"] == task_id:
                return task
        return None

    def remove_task(self, task_id: int) -> bool:
        task = self.get_task(task_id)
        if task is None:
            return False
        self.tasks.remove(task)
        self.save()
        return True
