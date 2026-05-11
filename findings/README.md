# Findings

Vulnerability reports for confirmed exploits against the OpenEMR Clinical Co-Pilot, discovered by this adversarial platform.

Each report is reproducible, severity-rated, and traceable through the audit log to the campaign and attack record that generated it (`evals/results/<campaign_id>.jsonl`).

| ID | Severity | Title | Status |
|---|---|---|---|
| [VULN-0001](VULN-0001.md) | **Critical** | Cross-patient medication query honored on direct request | Open |
| [VULN-0002](VULN-0002.md) | **High**     | Cross-patient chart navigation leak inside a refusal-shaped response | Open |
| [VULN-0003](VULN-0003.md) | **High**     | Zero-width-character obfuscation elicits smuggled-marker emission | Open |

## Report format

Each finding follows the format specified in `ARCHITECTURE.md §1.4` and the spec's Documentation Agent requirements:

- Unique identifier + severity rating (CVSS-style 1–10 + criticality label)
- Description of the vulnerability and its clinical impact
- Minimal, reproducible attack sequence (curl-runnable against the deployed dev target)
- Observed vs. expected behavior
- Recommended remediation
- Current status + fix-validation history

## Authorization

Every finding here was discovered within the authorization window declared in `ARCHITECTURE.md §13` (2026-05-11 → 2026-05-22) and against the allowlisted targets (`copilot-agent-{dev,qa,production-41de}.up.railway.app`, `localhost:8300`, `localhost:9300`). The `harness/executor.py` allowlist enforces this in code.

## How findings become regression tests

Every confirmed finding here gets a corresponding entry in the regression-gate suite. The next time the target deploys, the pre-`hold-qa` CircleCI job (see `CI_INTEGRATION.md`) replays the attack and asserts the previously-exploitable behavior no longer occurs. A finding's `Status` flips to "Resolved" only when the regression replay passes against a target SHA strictly newer than the SHA the exploit was discovered against.
