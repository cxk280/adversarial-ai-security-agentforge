"""Documentation Agent (ARCHITECTURE.md §1.3).

Watches for confirmed exploits at end-of-campaign and writes polished
VULN-NNNN-shape markdown via Claude Sonnet 4.6. Output is stored in
the documentation_agent_outputs SQLite table; GET /findings serves
it as the body of the corresponding AUTO-<seed_id> entry, so the
dashboard shows the full curated writeup without waiting on the
manual VULN-NNNN.md PR workflow.

Trust level: low. The output is AI-generated; humans review before
promoting AUTO-* findings to hand-authored VULN-NNNN.md commits.
"""

from agents.documentation.sonnet_writer import DocumentationAgent, DocAgentError

__all__ = ["DocumentationAgent", "DocAgentError"]
