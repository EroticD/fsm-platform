import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() =>
  vi.fn((url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  }),
);

vi.mock("next/navigation", () => ({ redirect }));

import LegacyUnitsPage from "./page";

describe("/enheter", () => {
  it("omdirigerer til kundeoversikten der enhetene faktisk bor", () => {
    expect(() => LegacyUnitsPage()).toThrow("REDIRECT:/kunder");
    expect(redirect).toHaveBeenCalledWith("/kunder");
  });
});
