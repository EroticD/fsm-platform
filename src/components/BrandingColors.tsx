"use client";

import { useEffect, useState } from "react";

export default function BrandingColors() {
  const [primaryColor, setPrimaryColor] = useState("#2563eb");

  useEffect(() => {
    fetch("/api/branding")
      .then((res) => res.json())
      .then((b) => {
        const color = b.primaryColor || "#2563eb";
        setPrimaryColor(color);
        // Sett CSS-variabelen slik at alle sider kan bruke bg-[var(--primary-color)] osv.
        document.documentElement.style.setProperty("--primary-color", color);
      })
      .catch(() => {
        document.documentElement.style.setProperty("--primary-color", "#2563eb");
      });
  }, []);

  return null;
}
