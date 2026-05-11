"""Red Team Agent prototype — seed phase.

This is the first iteration of the Red Team Agent described in
ARCHITECTURE.md §1.1. In its seed phase it does the simpler half of
the agent's job: emit a stream of attack payloads from versioned seed
files. The mutation phase (TAP via PyRIT + the abliterated model on
RunPod) attaches to the same interface.

Why a class, not a script: the Orchestrator (ARCHITECTURE.md §1.3)
needs to ask the Red Team for `next_batch(category=..., n=...,
seed_only=True|False)`. The class abstracts the dispatch source so
the Orchestrator's contract stays stable when we wire in mutation."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator

import yaml


@dataclass
class Attack:
    """One adversarial attempt — what gets sent to the harness."""

    id: str
    category: str
    subcategory: str
    endpoint: str
    active_patient_id: str
    active_user: str
    payload: str
    assertions: list[dict]
    seed_label: str
    source: str = "seed"  # later: "mutation" when TAP wires in
    seed_parent_id: str | None = None
    metadata: dict = field(default_factory=dict)


class SeedDispatcher:
    """Reads ./evals/seeds/<category_dir>/seeds.yaml files.

    Each YAML has a `defaults` block whose keys are inherited by every
    `cases` entry unless that entry overrides them. `assertions` from
    defaults is overridden wholesale by a case-level `assertions` field
    (not merged) — this keeps each case's success criterion explicit."""

    def __init__(self, seeds_root: str | Path) -> None:
        self.seeds_root = Path(seeds_root)
        if not self.seeds_root.is_dir():
            raise FileNotFoundError(f"Seeds root not found: {self.seeds_root}")

    # ------------------------------------------------------------------

    def categories(self) -> list[str]:
        return sorted(
            p.name for p in self.seeds_root.iterdir() if p.is_dir() and (p / "seeds.yaml").exists()
        )

    def load_category(self, category_dir: str) -> list[Attack]:
        path = self.seeds_root / category_dir / "seeds.yaml"
        with path.open() as f:
            raw = yaml.safe_load(f) or {}
        defaults = raw.get("defaults", {})
        cases = raw.get("cases", [])
        attacks: list[Attack] = []
        for case in cases:
            merged = {**defaults, **case}
            attacks.append(
                Attack(
                    id=merged["id"],
                    category=merged["category"],
                    subcategory=merged["subcategory"],
                    endpoint=merged.get("endpoint", "/chat"),
                    active_patient_id=str(merged.get("active_patient_id", "4")),
                    active_user=merged.get("active_user", "adversarial_test"),
                    payload=merged["payload"].rstrip(),
                    assertions=merged.get("assertions", []),
                    seed_label=merged.get("label", merged["id"]),
                    metadata={"category_dir": category_dir, "source_file": str(path)},
                )
            )
        return attacks

    def load_all(self) -> list[Attack]:
        result: list[Attack] = []
        for cat in self.categories():
            result.extend(self.load_category(cat))
        return result

    # ------------------------------------------------------------------

    def stream_batch(
        self, *, categories: list[str] | None = None, n: int | None = None
    ) -> Iterator[Attack]:
        """Generator the Orchestrator can pull from.

        Today: emits stored seeds in deterministic order.
        Tomorrow: interleaves seed + mutation outputs (from TAP)."""
        cats = categories or self.categories()
        count = 0
        for cat in cats:
            for atk in self.load_category(cat):
                if n is not None and count >= n:
                    return
                yield atk
                count += 1


def new_campaign_id() -> str:
    """Campaign ID convention: cmp_<unix_seconds>_<rand>. Sortable by start time."""
    return f"cmp_{int(time.time())}_{uuid.uuid4().hex[:6]}"
