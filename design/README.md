# Design

PNG exports of Figma mocks for review. Source-of-truth is the Figma file:
- File: AgentForge — `kj4MWNr8mpjZ2wVg1PbS0F`
- Page: "Week 3 — Adversarial Security"

The mocks were built in the same Figma file as the W2 OpenEMR Co-Pilot
screens so the visual theme stays consistent (same Inter weights, same
cream-on-navy palette, same card / badge conventions). Exports are
regenerated from Figma any time mocks change.

| # | Page | File |
|---|---|---|
| 1 | Dashboard      | mocks/01_dashboard.png |
| 2 | Findings list  | mocks/02_findings.png |
| 3 | Ad Hoc Run     | mocks/03_run.png |
| 4 | Coverage matrix    | mocks/04_coverage.png |
| 5 | Orchestrator (w/ Escalation Policy card) | mocks/05_orchestrator.png |
| 6 | Run History    | mocks/06_run_history.png |
| 7 | Executive View | mocks/07_exec_view.png |

## Visual tokens (locked)

| Token | Value |
|---|---|
| Sidebar / top navy | `#0d1b2a` |
| Secondary navy    | `#152a42` |
| Content bg (cream) | `#fbf7f0` |
| Card bg / radius   | `#ffffff` / 12px |
| Border             | `#e2e5eb` |
| Soft border        | `#eeebE3` |
| Teal accent (brand) | `#008c8c` |
| Severity — critical | `#d93838` on `#fbe2e2` |
| Severity — high     | `#e26a2c` on `#fbeadb` |
| Severity — medium   | `#b78800` on `#fbf1d0` |
| Severity — low      | `#2f55b7` on `#e0eafb` |
| Pass / ok           | `#148e4d` on `#dcf1e2` |
| Type family         | Inter (Regular / Medium / Semi Bold / Bold) |
