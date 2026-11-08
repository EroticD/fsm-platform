import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key}:${Object.values(values).join(",")}` : key,
}));

import ModulesTab, { type ModuleRowView } from "./ModulesTab";

const modules: ModuleRowView[] = [
  {
    key: "core",
    enabled: true,
    core: true,
    status: "active",
    dependencies: [],
    dependents: [],
    missingDependencies: [],
    enabledDependents: [],
  },
  {
    key: "booking",
    enabled: false,
    core: false,
    status: "active",
    dependencies: ["portal", "calendar"],
    dependents: [],
    missingDependencies: ["calendar"],
    enabledDependents: [],
  },
  {
    key: "contracts",
    enabled: true,
    core: false,
    status: "active",
    dependencies: [],
    dependents: ["quotes"],
    missingDependencies: [],
    enabledDependents: ["quotes"],
  },
];

const labels = {
  core: { label: "Kjerne", description: "Alltid på" },
  booking: { label: "Bestillinger", description: "Krever portal" },
  contracts: { label: "Avtaler", description: "SLA" },
  calendar: { label: "Kalender", description: "Kalender" },
  quotes: { label: "Tilbud", description: "Tilbud og godkjenning" },
};

describe("ModulesTab", () => {
  it("viser kjerne, avhengighetsvarsel og at data beholdes", () => {
    const html = renderToStaticMarkup(
      createElement(ModulesTab, {
        modules,
        labels,
        action: () => undefined,
        canManage: true,
      }),
    );

    expect(html).toContain("settings.modules.dataPreserved");
    expect(html).toContain("Kjerne");
    expect(html).toContain("settings.modules.coreLocked");
    expect(html).toContain(
      "settings.modules.missingDependencies:Kalender",
    );
    expect(html).toContain("settings.modules.hasDependents:Tilbud");
  });

  it("deaktiverer knappen for kjerne og blokkerte kombinasjoner", () => {
    const html = renderToStaticMarkup(
      createElement(ModulesTab, {
        modules,
        labels,
        action: () => undefined,
        canManage: true,
      }),
    );

    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("viser lagret og feilmelding", () => {
    const html = renderToStaticMarkup(
      createElement(ModulesTab, {
        modules: [],
        labels,
        action: () => undefined,
        ok: true,
        error: "hasDependents",
        canManage: false,
      }),
    );
    expect(html).toContain("settings.modules.saved");
    expect(html).toContain("settings.modules.errors.hasDependents");
  });
});
