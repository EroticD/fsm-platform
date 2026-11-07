import { describe, expect, it } from "vitest";
import { formatDurationMinutes } from "./duration";

describe("formatDurationMinutes", () => {
  it("viser minutter under en time", () => {
    expect(formatDurationMinutes(30, "nb")).toBe("30 min");
  });

  it("viser hele timer uten minutter", () => {
    expect(formatDurationMinutes(120, "nb")).toBe("2 t");
  });

  it("viser timer og minutter sammen", () => {
    expect(formatDurationMinutes(130, "nb")).toBe("2 t 10 min");
  });

  it("viser null som null minutter, ikke som ukjent", () => {
    expect(formatDurationMinutes(0, "nb")).toBe("0 min");
  });

  it("bruker tankestrek når verdien mangler", () => {
    expect(formatDurationMinutes(null, "nb")).toBe("–");
    expect(formatDurationMinutes(undefined, "nb")).toBe("–");
  });
});
