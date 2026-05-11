# AgentForge Adversarial Platform — Users & Use Cases

This platform is not built for the physicians using the Clinical Co-Pilot. They are the *protected population*, not the operators. The operators are the people responsible for keeping the Co-Pilot safe to use — and that means the platform's user model has to be designed for *them*, not for the end-users of the system being defended.

There are four primary users, plus one secondary, all of whom interact with the platform at different cadences and trust levels. Each has a defined workflow and a clear answer to "why is automation the right solution here, rather than a human running these tests manually?"

---

## User 1 — Security Engineer (primary operator)

**Who they are.** The person responsible for hands-on adversarial testing of the Clinical Co-Pilot. Typically an AppSec or AI red-team engineer reporting to a CISO. Familiar with the OWASP Top 10 for LLMs, can read a vulnerability report, knows the difference between a real finding and noise.

**What they need from this platform.**

1. A continuously-running attack surface that doesn't depend on their personal availability.
2. A reproducible record of every attack and every verdict, so post-mortems are possible.
3. Confidence that when the platform reports a finding, the reproducer actually works.
4. The ability to add new attack categories or seed payloads without rewriting the orchestrator.
5. A way to triage: which findings need their attention *today* vs. which can wait.

**Workflow.**

| Step | Action | Touchpoint |
|---|---|---|
| 1 | Morning standup: open dashboard, see overnight findings sorted by severity. | UI `/dashboard` |
| 2 | Triage queue: confirm critical/high findings (the Documentation Agent's gated drafts), reject false positives, sign off on publishing. | UI `/findings/_draft` |
| 3 | Review the coverage matrix — any category gone red? Any with no recent runs? | UI `/coverage` |
| 4 | Adjust the Orchestrator: bump priority on a category, pause a noisy campaign, increase the daily $ cap if needed. | UI `/orchestrator` or CLI |
| 5 | Add new seed cases when they hear about a novel attack technique in the wild. | `./evals/seeds/` PR |
| 6 | When a fix lands in `../agentforge`: confirm the relevant regression case now passes, that the negative-control still passes, and that no neighboring categories regressed. | UI `/findings/VULN-NNNN` |

**Why automation is the right solution.**

The threat model has 17 ranked subcategories. Manual probing of all of them, once, takes a senior security engineer roughly 2–3 days. The Co-Pilot is changing every day. Manual testing is structurally incompatible with continuous deployment — by the time the engineer finishes the suite, the target has moved. Automation is not a *nicer* answer; it is the *only* answer that scales to "test every deployment of an evolving LLM system."

What manual testing *does* uniquely well — applying judgment to a novel attack class, deciding whether a partial is interesting, writing the prose narrative around a finding — this platform deliberately preserves for the human. The human is in the loop where their judgment is valuable (rubric changes, severity calls on critical findings, force-promote in a hotfix), and the human is out of the loop where they are slow (running the same indirect-injection corpus against every new build).

---

## User 2 — ML Platform / Co-Pilot Maintainer

**Who they are.** The engineer maintaining the Clinical Co-Pilot itself. Owns the LLM tool definitions, the system prompt, the retrieval pipeline, the LangGraph supervisor. Cares about correctness, latency, cost — and now, security.

**What they need from this platform.**

1. Fast feedback when a change they made breaks something that was previously safe.
2. A regression suite that runs **without their input** as part of the deploy pipeline (per `ARCHITECTURE.md §3.4`, gated before `hold-qa` in the AgentForge CI/CD pipeline).
3. Clear, actionable vulnerability reports written in language a normal engineer can read.
4. Confidence that "the suite passed" actually means "the system is at least as safe as it was yesterday."
5. An emergency bypass when a real hotfix has to ship past a regression that's a false positive.

**Workflow.**

| Step | Action | Touchpoint |
|---|---|---|
| 1 | Open PR against `../agentforge/master`. | GitHub |
| 2 | CI runs unit/integration tests on dev deploy. | CircleCI |
| 3 | Pre-`hold-qa` job calls the adversary service's `/regression-runs` against the dev target. | CircleCI → platform API |
| 4 | If regression detected: PR shows a red check linking back to the specific failing case + finding report. Maintainer reads, fixes, repushes. | CircleCI annotation |
| 5 | If a critical hotfix has to ship past a real-but-non-blocking regression: maintainer adds `[adversarial-bypass]` to the commit message + justification in PR description; bypass is logged to the audit trail. | Commit convention |
| 6 | After merge: full LLM-judged campaign runs asynchronously, posts results to the dashboard. | Background |

**Why automation is the right solution.**

The platform engineer can't be expected to manually re-run 17 categories' worth of attacks on every PR. They wouldn't, even if they could — context-switching cost is too high. Automating this into the deploy pipeline means security gets the same continuous-test treatment that we already give to functionality. A regression is identified within 5 minutes of the build, not within "however long until the next manual security review."

---

## User 3 — CISO / Compliance Officer

**Who they are.** Hospital-or-vendor security executive accountable to HIPAA, internal risk committees, and possibly auditors. May never log into the platform directly, but reads its outputs.

**What they need from this platform.**

1. A defensible answer to "what AI-specific risks exist in this product, and how are you addressing them?"
2. Trend data: is the system getting more or less resilient over time?
3. An audit trail proving that the test discipline was applied consistently, not just before a board meeting.
4. Vulnerability reports that look like vulnerability reports — not LLM stream-of-consciousness.

**Workflow.**

| Step | Action | Touchpoint |
|---|---|---|
| 1 | Weekly review of the dashboard's executive summary. | UI `/dashboard/exec` |
| 2 | Reads the most-recent critical and high findings. | `./findings/` |
| 3 | Asks for evidence of testing coverage during quarterly review. | Audit-log export |
| 4 | Forwards findings to the broader risk committee or external auditor. | Manual export |

**Why automation is the right solution.**

A CISO can't sign off on "we tested it once" for an LLM. The attack surface evolves with every commit; the *category* of attacks evolves with every public-research disclosure; the model itself silently changes on the provider side. The only defensible compliance posture is "we test continuously, and here is the record." Manual testing produces a snapshot. Automation produces a record.

This user explicitly does not need the platform to be autonomous in *remediation*. They need it to be autonomous in *discovery and documentation*, with humans gating publication of critical-severity findings.

---

## User 4 — SRE / On-Call Engineer

**Who they are.** The person paged when the production Co-Pilot misbehaves. Owns target uptime, latency, cost. May not be the same person as the platform maintainer.

**What they need from this platform.**

1. A pager-grade signal when the adversarial platform itself catches a *new* critical-severity exploit in production (not just a known one regressing).
2. Cost-amplification alerts (per `ARCHITECTURE.md §3.3`): if the platform's harness sees a sudden spike in tokens-per-turn against prod, that's actionable for them.
3. A "stop the world" button to pause all adversarial campaigns against the prod target during an active incident.

**Workflow.**

| Step | Action | Touchpoint |
|---|---|---|
| 1 | PagerDuty alert fires when a `verdict=pass, severity=critical` finding lands against the prod target. | Webhook |
| 2 | Acknowledges the page, reviews the finding's reproducer. | UI `/findings/VULN-NNNN` |
| 3 | Decides: is this exploitable right now in prod? Engages the platform maintainer. | Manual |
| 4 | If yes: pauses prod campaigns to stop the platform from re-triggering the issue while it's being fixed. | UI `/orchestrator/pause` |
| 5 | After fix lands: confirms regression case is now green on prod. | UI |

**Why automation is the right solution.**

The SRE never wants to be the person doing the testing. They want to be the person who finds out *fast* if testing turned up something prod-affecting. Automation gives them a tight feedback loop without adding a new manual task to their on-call duties.

---

## User 5 — External Security Researcher (secondary, read-only)

**Who they are.** Someone outside the immediate team who is granted scoped access to review the platform's findings — for example, an auditor or a contracted red-team peer reviewer. Sometimes anonymous bug-bounty-style contributors who submit their own attacks.

**What they need from this platform.**

1. Read-only access to closed findings (no PHI, redacted).
2. A way to submit a novel attack and have it added to the seed corpus.
3. Visibility into which categories are *un*covered or under-tested, so they can prioritize their own work.

**Workflow.**

| Step | Action | Touchpoint |
|---|---|---|
| 1 | Browse public findings index. | `./findings/` (filtered) |
| 2 | Submit a new attack PR against `./evals/seeds/`. | GitHub |
| 3 | If accepted: the Orchestrator queues the new case automatically in the next campaign for that category. | Automatic |

**Why automation is the right solution.**

External contributors should not require the platform team's full attention to validate a submission. Auto-running a submitted case in a sandboxed campaign and routing its results into the standard Judge flow lets the platform absorb community contributions without adding manual review time.

---

## Cross-cutting principles

These apply to every user listed above.

### Read-only by default, write by explicit grant

- The platform's audit log can be read by any operator user.
- Triggering a campaign against prod, changing a rubric, or publishing a critical finding requires a separate granted permission, not just operator access.
- The harness's target-host allowlist (per `ARCHITECTURE.md §13`) is editable only via PR + code review, not via UI.

### Explicit human-in-the-loop boundaries

Per spec and per `ARCHITECTURE.md §4`, the platform asks a human at:

- Critical/high finding publication
- Rubric version changes (would flip historical verdicts)
- New target host (allowlist additions)
- Production-target campaigns above a configurable $ cap
- Force-promote past a regression (`[adversarial-bypass]` audit trail)

The platform does *not* ask a human for: routine campaign scheduling, mutation generation, judging individual attacks, drafting medium/low findings, nightly regression runs, coverage-priority shifts. That balance is deliberate — anywhere the cost of being wrong is high *and* anywhere humans bring useful judgment, the human is in the loop. Everywhere else, the platform proceeds.

### Why this isn't "an LLM eval tool"

A normal LLM eval tool (Promptfoo, DeepEval, internal harness) is owned by one user — the engineer who built the model. The adversarial platform is owned by four different users with four different reporting lines. That's why the role separation in §1–§4 above is in the user model itself, not just in the agent design. The platform team can't ship a product that conflates "the engineer maintaining the Co-Pilot" with "the security engineer testing it" without baking in exactly the conflict-of-interest the spec warns against.

---

## References

- `ARCHITECTURE.md` — agent and component design
- `THREAT_MODEL.md` — what the platform is testing for
- `ARCHITECTURE.md §13` — authorization scope (who can be tested)
- `ARCHITECTURE.md §4` — human approval gates (where users enter the loop)
