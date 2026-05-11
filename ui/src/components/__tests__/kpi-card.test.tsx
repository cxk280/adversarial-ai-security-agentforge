import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KpiCard } from "@/components/kpi-card";

describe("KpiCard", () => {
  it("renders label, value, unit, and delta when all provided", () => {
    render(
      <KpiCard label="OPEN FINDINGS" value="3" unit=" total" delta="+3 today" tone="red" />,
    );
    expect(screen.getByText("OPEN FINDINGS")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText(/total/)).toBeInTheDocument();
    expect(screen.getByTestId("kpi-delta")).toHaveTextContent("+3 today");
  });

  it("omits delta when not provided", () => {
    render(<KpiCard label="X" value="1" tone="green" />);
    expect(screen.queryByTestId("kpi-delta")).toBeNull();
  });

  it("omits unit when not provided", () => {
    render(<KpiCard label="X" value="42" tone="muted" />);
    // value should appear once; no unit span exists alongside it
    const value = screen.getByText("42");
    expect(value.nextElementSibling).toBeNull();
  });

  it("applies the right tone class to the delta", () => {
    const { unmount } = render(
      <KpiCard label="X" value="1" delta="up" tone="green" />,
    );
    expect(screen.getByTestId("kpi-delta").className).toContain("text-green-700");
    unmount();
    render(<KpiCard label="Y" value="1" delta="down" tone="red" />);
    expect(screen.getByTestId("kpi-delta").className).toContain("text-red-600");
  });
});
