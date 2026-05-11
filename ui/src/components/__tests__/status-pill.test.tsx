import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusPill } from "@/components/status-pill";

describe("StatusPill", () => {
  it("uppercases the label", () => {
    render(<StatusPill status="open" />);
    expect(screen.getByText("OPEN")).toBeInTheDocument();
  });

  it("renders all 4 statuses with the right testids and colors", () => {
    const cases = [
      { status: "open" as const, color: "text-red-700" },
      { status: "in_progress" as const, color: "text-yellow-700" },
      { status: "resolved" as const, color: "text-green-700" },
      { status: "draft" as const, color: "text-slate-700" },
    ];
    for (const { status, color } of cases) {
      const { unmount } = render(<StatusPill status={status} />);
      expect(screen.getByTestId(`status-pill-${status}`).className).toContain(color);
      unmount();
    }
  });

  it("renders 'IN PROGRESS' with a space (not 'IN_PROGRESS')", () => {
    render(<StatusPill status="in_progress" />);
    expect(screen.getByText("IN PROGRESS")).toBeInTheDocument();
  });
});
