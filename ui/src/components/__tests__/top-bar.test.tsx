import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TopBar } from "@/components/top-bar";

describe("TopBar", () => {
  it("renders the breadcrumb and the target label", () => {
    render(<TopBar crumb="Dashboard" />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("copilot-agent-dev")).toBeInTheDocument();
  });

  it("does not render a Run campaign CTA (sidebar's Ad Hoc Run covers it)", () => {
    render(<TopBar crumb="X" />);
    expect(screen.queryByText(/run campaign/i)).toBeNull();
  });
});
