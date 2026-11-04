import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values?.name ? `${key}:${values.name}` : key,
}));
vi.mock("./actions", () => ({
  moveEquipmentToCustomerAction: async () => undefined,
}));
vi.mock("@/components/SubmitButton", async () => {
  const React = await import("react");
  return {
    default: (props: { children?: unknown; disabled?: boolean }) =>
      React.createElement(
        "button",
        { type: "submit", disabled: props.disabled },
        props.children as never,
      ),
  };
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import EquipmentMoveForm from "./EquipmentMoveForm";

const counts = {
  products: 2,
  workOrders: 1,
  visits: 1,
  reports: 1,
  reportRevisions: 0,
  reportUnits: 1,
  meterReadings: 4,
  plans: 1,
  planOccurrences: 0,
  documents: 1,
  documentVersions: 0,
  uploads: 2,
  qrCodes: 1,
  comments: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EquipmentMoveForm", () => {
  it("viser bare kundesøk, aldri en full kundeliste", () => {
    const html = renderToStaticMarkup(
      createElement(EquipmentMoveForm, {
        equipmentId: "p1",
        equipmentModel: "Rotpumpe",
        currentCustomerName: "Gammel kunde",
        initialCounts: counts,
      }),
    );

    expect(html).toContain("assets.move.searchLabel");
    expect(html).toContain('type="search"');
    expect(html).toContain("assets.move.noSelection");
    expect(html).toContain("assets.move.counts.products");
    expect(html).toContain("assets.move.counts.meterReadings");
    expect(html).not.toContain("assets.move.selectedCustomer");
  });

  it("holder bekreftelsen deaktivert til en kunde er valgt og forhåndsvisning er klar", () => {
    const html = renderToStaticMarkup(
      createElement(EquipmentMoveForm, {
        equipmentId: "p1",
        equipmentModel: "Rotpumpe",
        currentCustomerName: "Gammel kunde",
        initialCounts: counts,
      }),
    );

    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
    expect(html).toContain("assets.move.confirmCheckbox");
    expect(html).toContain("assets.move.confirmHint");
  });
});
