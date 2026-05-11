import { describe, it, expect } from "vitest";
import { relativeTime, usd, pct, prettySnake } from "@/lib/format";

describe("relativeTime", () => {
  const NOW = new Date("2026-05-11T18:00:00Z");
  it("returns minutes when < 1 hour ago", () => {
    expect(relativeTime("2026-05-11T17:40:00Z", NOW)).toBe("20m ago");
  });
  it("returns hours when 1h–24h ago", () => {
    expect(relativeTime("2026-05-11T08:00:00Z", NOW)).toBe("10h ago");
  });
  it("returns 'yesterday' for 1 day ago", () => {
    expect(relativeTime("2026-05-10T18:00:00Z", NOW)).toBe("yesterday");
  });
  it("returns 'just now' for <1m", () => {
    expect(relativeTime("2026-05-11T17:59:50Z", NOW)).toBe("just now");
  });
});

describe("usd", () => {
  it("formats zero", () => expect(usd(0)).toBe("$0.00"));
  it("formats whole dollars", () => expect(usd(1.5)).toBe("$1.50"));
  it("formats sub-cent with 4 digits", () => expect(usd(0.0023)).toBe("$0.0023"));
});

describe("pct", () => {
  it("formats 0", () => expect(pct(0)).toBe("0.0%"));
  it("formats 0.947", () => expect(pct(0.947)).toBe("94.7%"));
  it("respects digits arg", () => expect(pct(0.947, 2)).toBe("94.70%"));
});

describe("prettySnake", () => {
  it("capitalizes underscore segments", () => {
    expect(prettySnake("data_exfiltration")).toBe("Data Exfiltration");
    expect(prettySnake("prompt_injection")).toBe("Prompt Injection");
  });
});
