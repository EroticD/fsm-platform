import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const translate = (
      key: string,
      values?: Record<string, string | number>,
    ) => (values ? `${key} ${JSON.stringify(values)}` : key);
    return translate;
  },
}));

import ImageUploadField from "./ImageUploadField";

function render(initialUrls: string[] = [], required = true) {
  return renderToStaticMarkup(
    createElement(ImageUploadField, {
      name: "answer__unit-0__f_image",
      label: "Dokumentasjon",
      required,
      initialUrls,
      workOrderId: "wo-1",
    }),
  );
}

describe("ImageUploadField – kø og påkrevd bilde", () => {
  it("lar kamera og galleri være to veier til samme påkrevde felt", () => {
    const html = render();

    expect(html).toContain('aria-required="true"');
    expect(html).not.toContain('required=""');
    expect(html).toContain('capture="environment"');
    expect(html).toContain('accept="image/*"');
  });

  it("sender ferdig opplastede bilder som en JSON-liste og teller dem", () => {
    const html = render(["/uploads/bilde-1.jpg"]);

    expect(html).toContain('src="/uploads/bilde-1.jpg"');
    expect(html).toContain(
      'name="answer__unit-0__f_image" value="[&quot;/uploads/bilde-1.jpg&quot;]"',
    );
    expect(html).toContain(
      'orders.imageUpload.uploaded {&quot;count&quot;:1}',
    );
    expect(html).toContain('aria-required="false"');
  });
});
