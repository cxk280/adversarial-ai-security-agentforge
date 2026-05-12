import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TopBar } from "@/components/top-bar";

describe("TopBar", () => {
  it("renders the breadcrumb and the target label", () => {
    render(<TopBar crumb="Dashboard" target="copilot-agent-dev" />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("copilot-agent-dev")).toBeInTheDocument();
  });

  it("has a Run campaign CTA linking to /run", () => {
    render(<TopBar crumb="X" target="dev" />);
    const link = screen.getByRole("link", { name: /run campaign/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/run");
  });
});
