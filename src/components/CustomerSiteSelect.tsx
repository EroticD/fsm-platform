"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

export type CustomerSiteOption = {
  id: string;
  customerId: string;
  name: string;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  isPrimary?: boolean;
};

type SitesResponse = {
  sites?: CustomerSiteOption[];
  error?: string;
};

type CustomerSiteSelectProps = {
  customerId: string;
  /** Steder for den valgte kunden, lastet på serveren for samme kunde. */
  initialSites?: CustomerSiteOption[];
  initialSiteId?: string | null;
  id: string;
  name?: string;
  label: string;
  noSiteLabel: string;
  hint?: string;
  className: string;
};

/**
 * Stedsvelger som bare kjenner den valgte kunden.
 *
 * Når kunden endres, hentes kundens steder på nytt fra et autentisert,
 * serveravgrenset endepunkt. Før en kunde er valgt er lista tom, og ingen
 * andre kunders steder finnes i sidens HTML eller JSON.
 */
export default function CustomerSiteSelect({
  customerId,
  initialSites = [],
  initialSiteId = null,
  id,
  name = "siteId",
  label,
  noSiteLabel,
  hint,
  className,
}: CustomerSiteSelectProps) {
  const t = useTranslations("common");
  const [sites, setSites] = useState<CustomerSiteOption[]>(initialSites);
  const [siteId, setSiteId] = useState(initialSiteId ?? "");
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const loadedFor = useRef<string>(initialSites.length > 0 ? customerId : "");
  const requestRef = useRef(0);

  useEffect(() => {
    if (!customerId || loadedFor.current === customerId) return;

    let active = true;
    const request = ++requestRef.current;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setFailed(false);
      try {
        const response = await fetch(
          `/api/kunder/steder?customerId=${encodeURIComponent(customerId)}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("steder-feilet");
        const data = (await response.json()) as SitesResponse;
        if (!active || request !== requestRef.current) return;
        const next = data.sites ?? [];
        setSites(next);
        setSiteId((current) =>
          next.some((site) => site.id === current) ? current : "",
        );
        loadedFor.current = customerId;
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        if (!active || request !== requestRef.current) return;
        setSites([]);
        setSiteId("");
        setFailed(true);
      } finally {
        if (active && request === requestRef.current) setLoading(false);
      }
    }, 0);

    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [customerId]);

  const describedBy = hint ? `${id}-hint` : undefined;

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted,#62685f)]">
        {label}
      </label>
      <select
        id={id}
        name={name}
        value={siteId}
        onChange={(event) => setSiteId(event.target.value)}
        disabled={!customerId || loading}
        aria-describedby={describedBy}
        className={className}
      >
        <option value="">{noSiteLabel}</option>
        {sites.map((site) => (
          <option key={site.id} value={site.id}>
            {site.name}
            {site.address ? ` — ${site.address}` : ""}
            {site.postalCode || site.city
              ? ` · ${[site.postalCode, site.city].filter(Boolean).join(" ")}`
              : ""}
          </option>
        ))}
      </select>
      {loading && (
        <p className="mt-1 text-xs text-[var(--muted,#62685f)]" role="status">
          {t("orders.sitePicker.loading")}
        </p>
      )}
      {failed && (
        <p className="mt-1 text-xs font-bold text-[var(--risk-text,#b42318)]" role="alert">
          {t("orders.sitePicker.loadFailed")}
        </p>
      )}
      {hint && !loading && !failed && (
        <p id={`${id}-hint`} className="mt-1 text-xs leading-5 text-[var(--muted,#62685f)]">
          {hint}
        </p>
      )}
    </div>
  );
}
