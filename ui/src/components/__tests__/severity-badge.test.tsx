import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SeverityBadge } from "@/components/severity-badge";

describe("SeverityBadge", () => {
  it("renders each severity with the right testid + label", () => {
    const severities = ["critical", "high", "medium", "low"] as const;
    for (const s of severities) {
      const { unmount } = render(<SeverityBadge severity={s} />);
      const badge = screen.getByTestId(`severity-badge-${s}`);
      expect(badge).toBeInTheDocument();
      expect(badge.textContent?.toLowerCase()).toBe(s);
      unmount();
    }
  });

  it("applies the critical color class", () => {
    render(<SeverityBadge severity="critical" />);
    const badge = screen.getByTestId("severity-badge-critical");
    expect(badge.className).toContain("text-red-700");
    expect(badge.className).toContain("bg-red-100");
  });

  it("passes through className for composition", () => {
    render(<SeverityBadge severity="high" className="ml-4" />);
    expect(screen.getByTestId("severity-badge-high").className).toContain("ml-4");
  });
});
