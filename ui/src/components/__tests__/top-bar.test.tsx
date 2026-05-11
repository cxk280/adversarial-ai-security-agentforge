import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TopBar } from "@/components/top-bar";

describe("TopBar", () => {
  it("renders the breadcrumb and the target label", () => {
    render(<TopBar crumb="Dashboard" target="copilot-agent-dev" />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("copilot-agent-dev")).toBeInTheDocument();
  });

  it("has a Run campaign CTA", () => {
    render(<TopBar crumb="X" target="dev" />);
    expect(
      screen.getByRole("button", { name: /run campaign/i }),
    ).toBeInTheDocument();
  });
});
