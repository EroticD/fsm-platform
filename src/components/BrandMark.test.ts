import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BRAND_CHECK_PATH,
  BRAND_COLORS,
  BRAND_PIN_PATH,
} from "@/lib/brand";
import BrandMark, { type BrandMarkProps } from "./BrandMark";

function render(props: BrandMarkProps = {}) {
  return renderToStaticMarkup(createElement(BrandMark, props));
}

describe("BrandMark", () => {
  it("er dekorativt som standard", () => {
    const html = render();

    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role="img"');
    expect(html).not.toContain("<title");
    expect(html).toContain('width="36" height="36"');
  });

  it("tegner nål og hake fra den felles merkevaregeometrien", () => {
    const html = render();

    expect(html).toContain(`d="${BRAND_PIN_PATH}"`);
    expect(html).toContain(`d="${BRAND_CHECK_PATH}"`);
    expect(html).toContain(`fill="${BRAND_COLORS.signal}"`);
    expect(html).toContain(`stroke="${BRAND_COLORS.signal}"`);
  });

  it("kan bruke blekkflate med signalnål på lyse flater", () => {
    const html = render({ tone: "ink", size: 24 });

    expect(html).toContain('data-tone="ink"');
    expect(html).toContain('width="24" height="24"');
    expect(html).toContain(`fill="${BRAND_COLORS.ink}"`);
    expect(html).toContain(`fill="${BRAND_COLORS.signal}"`);
  });

  it("får tilgjengelig navn når title er satt", () => {
    const html = render({ title: "FSM System" });

    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="FSM System"');
    expect(html).toContain("<title>FSM System</title>");
    expect(html).not.toContain('aria-hidden="true"');
  });
});
