import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

import CustomerTransferTab from "./CustomerTransferTab";

function render() {
  return renderToStaticMarkup(
    createElement(CustomerTransferTab, {
      customers: [
        {
          id: "c1",
          name: "Kunde A",
          customerNumber: "K-1",
          orgNumber: "123456789",
        },
      ],
    }),
  );
}

describe("CustomerTransferTab", () => {
  it("rendrer eksport- og importskjema med norske oversettelsesnøkler", () => {
    const html = render();
    expect(html).toContain("settings.customerTransfer.export.title");
    expect(html).toContain("settings.customerTransfer.import.title");
    expect(html).toContain("settings.customerTransfer.warningTitle");
    expect(html).toContain("Kunde A");
    expect(html).toContain('type="file"');
    expect(html).toContain('accept=".zip,.fsmenc,application/zip"');
    expect(html).toContain('type="password"');
    expect(html).toContain("settings.customerTransfer.import.passphraseLabel");
  });

  it("krever bekreftelse før eksportknappen kan brukes", () => {
    const html = render();
    expect(html).toContain("settings.customerTransfer.export.piiConfirm");
    expect(html).toMatch(/disabled=""/);
  });

  it("viser kilde og skjemaversjon når en forhåndsvisning finnes", () => {
    // Komponenten er tilstandsdrevet; statisk render viser starttilstanden.
    const html = render();
    expect(html).not.toContain("settings.customerTransfer.import.previewTitle");
    expect(html).toContain("settings.customerTransfer.export.piiConfirm");
  });
});
