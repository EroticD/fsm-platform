import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() =>
  vi.fn((url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  }),
);

vi.mock("next/navigation", () => ({ redirect }));

import LegacyUnitsPage from "./page";

describe("/enheter", () => {
  it("omdirigerer til kundeoversikten med en forklarende melding", () => {
    expect(() => LegacyUnitsPage()).toThrow("REDIRECT:/kunder?varsel=enheter");
    expect(redirect).toHaveBeenCalledWith("/kunder?varsel=enheter");
  });
});
