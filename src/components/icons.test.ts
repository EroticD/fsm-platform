import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BRAND_CHECK_PATH, BRAND_PIN_PATH } from "@/lib/brand";
import GoogleMapsLink from "./GoogleMapsLink";
import Icon, { ICON_NAMES, isIconName } from "./icons";

describe("Icon", () => {
  it.each([...ICON_NAMES])("renders %s as an svg", (name) => {
    const html = renderToStaticMarkup(createElement(Icon, { name }));

    expect(html).toMatch(/^<svg[\s>]/);
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('aria-hidden="true"');
  });

  it("exposes the branded pin variants", () => {
    expect(ICON_NAMES).toContain("brandPin");
    expect(ICON_NAMES).toContain("brandNav");
    expect(isIconName("brandPin")).toBe(true);
    expect(isIconName("brandNav")).toBe(true);
  });

  it("draws brandPin with the shared brand geometry", () => {
    const html = renderToStaticMarkup(
      createElement(Icon, { name: "brandPin" }),
    );

    expect(html).toContain(BRAND_PIN_PATH);
    expect(html).toContain(BRAND_CHECK_PATH);
  });

  it("draws navigation and brandNav with the same pin-and-arrow silhouette", () => {
    const navigation = renderToStaticMarkup(
      createElement(Icon, { name: "navigation" }),
    );
    const brandNav = renderToStaticMarkup(
      createElement(Icon, { name: "brandNav" }),
    );

    expect(navigation).toBe(brandNav);
    expect(navigation).toContain(BRAND_PIN_PATH);
    expect(navigation).not.toContain(BRAND_CHECK_PATH);
  });

  it("keeps the accessible title behaviour", () => {
    const html = renderToStaticMarkup(
      createElement(Icon, { name: "brandPin", title: "Kart" }),
    );

    expect(html).toContain('role="img"');
    expect(html).toContain("<title>Kart</title>");
    expect(html).not.toContain('aria-hidden="true"');
  });
});

describe("GoogleMapsLink", () => {
  const props = {
    address: "Storgata 1",
    postalCode: "0184",
    city: "Oslo",
    label: "Åpne kart",
    newTabLabel: "Åpnes i ny fane",
  };

  it("shows the brandNav icon before the label by default", () => {
    const html = renderToStaticMarkup(createElement(GoogleMapsLink, props));

    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("Åpne kart");
    expect(html).toContain("(Åpnes i ny fane)");
    expect(html).toContain(BRAND_PIN_PATH);
    expect(html.indexOf("<svg")).toBeLessThan(html.indexOf("Åpne kart"));
  });

  it("can hide the icon without changing the rest of the link", () => {
    const html = renderToStaticMarkup(
      createElement(GoogleMapsLink, { ...props, showIcon: false }),
    );

    expect(html).not.toContain("<svg");
    expect(html).toContain("Åpne kart");
    expect(html).toContain('target="_blank"');
    expect(html).toContain("(Åpnes i ny fane)");
  });
});
