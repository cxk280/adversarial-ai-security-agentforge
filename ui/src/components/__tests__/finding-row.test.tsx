import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FindingRow } from "@/components/finding-row";
import type { FindingSummary } from "@/lib/api";

const FINDING: FindingSummary = {
  id: "VULN-0001",
  title: "Cross-patient medication query honored",
  severity: "critical",
  status: "open",
  category: "data_exfiltration",
  subcategory: "cross_patient_leakage",
  discovered: "2026-05-11T17:14:16Z",
  repro_summary: "test",
  attack_id: "xpat-001",
};

describe("FindingRow", () => {
  it("renders the severity, ID, title, category, and timestamp", () => {
    render(<FindingRow finding={FINDING} when="14m ago" />);
    expect(screen.getByTestId("severity-badge-critical")).toBeInTheDocument();
    expect(screen.getByText("VULN-0001")).toBeInTheDocument();
    expect(screen.getByText(/Cross-patient medication query honored/)).toBeInTheDocument();
    expect(screen.getByText(/data_exfiltration \/ cross_patient_leakage/)).toBeInTheDocument();
    expect(screen.getByText("14m ago")).toBeInTheDocument();
  });

  it("links to the finding detail page", () => {
    render(<FindingRow finding={FINDING} when="14m ago" />);
    const link = screen.getByTestId(`finding-row-${FINDING.id}`);
    expect(link.tagName.toLowerCase()).toBe("a");
    expect(link.getAttribute("href")).toBe(`/findings/${FINDING.id}`);
  });

  it("respects severity prop — high finding shows the high badge", () => {
    const high: FindingSummary = { ...FINDING, severity: "high" };
    render(<FindingRow finding={high} when="1h" />);
    expect(screen.getByTestId("severity-badge-high")).toBeInTheDocument();
    expect(screen.queryByTestId("severity-badge-critical")).toBeNull();
  });
});
