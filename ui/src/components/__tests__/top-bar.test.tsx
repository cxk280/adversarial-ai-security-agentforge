import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TopBar } from "@/components/top-bar";
import { TargetProvider } from "@/lib/target-context";

// TopBar now reads the selected target from TargetProvider context.
// Wrap every render in the provider so useTarget() finds it.
function renderWithProvider(ui: React.ReactElement) {
  return render(<TargetProvider>{ui}</TargetProvider>);
}

describe("TopBar", () => {
  it("renders the breadcrumb and the default target label (dev)", () => {
    renderWithProvider(<TopBar crumb="Dashboard" />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    // Default selection from TargetProvider is "dev".
    expect(screen.getByText("dev")).toBeInTheDocument();
  });

  it("does not render a Run campaign CTA (sidebar's Ad Hoc Run covers it)", () => {
    renderWithProvider(<TopBar crumb="X" />);
    expect(screen.queryByText(/run campaign/i)).toBeNull();
  });
});
