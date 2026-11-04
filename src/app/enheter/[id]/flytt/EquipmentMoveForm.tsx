"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Icon from "@/components/icons";
import SubmitButton from "@/components/SubmitButton";
import type {
  EquipmentMoveCounts,
  EquipmentMoveCustomerOption,
  EquipmentMoveSiteOption,
  EquipmentMoveSummary,
} from "@/server/equipment-move";
import { moveEquipmentToCustomerAction } from "./actions";

const CARD = "office-card min-w-0 space-y-4 p-4 sm:p-5";
const LABEL =
  "text-2xs font-bold uppercase tracking-[0.12em] text-[var(--muted,#62685f)]";
const CONTROL =
  "mt-1 min-h-11 w-full rounded-[10px] border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-sm text-[var(--ink,#101310)] focus:border-[var(--ink,#101310)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink,#101310)]";
const SIGNAL_BUTTON =
  "signal-button inline-flex min-h-11 items-center justify-center gap-1.5 border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] px-4 text-sm text-[var(--ink,#101310)] disabled:cursor-not-allowed disabled:opacity-50";

const COUNT_KEYS: Array<keyof EquipmentMoveCounts> = [
  "products",
  "workOrders",
  "visits",
  "reports",
  "reportRevisions",
  "reportUnits",
  "meterReadings",
  "plans",
  "planOccurrences",
  "documents",
  "documentVersions",
  "uploads",
  "qrCodes",
  "comments",
];

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

function Counts({ counts }: { counts: EquipmentMoveCounts }) {
  const t = useTranslations("common");
  return (
    <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {COUNT_KEYS.filter((key) => counts[key] > 0).map((key) => (
        <div
          key={key}
          className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2"
        >
          <dt className="text-2xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
            {t(`assets.move.counts.${key}`)}
          </dt>
          <dd className="text-lg font-black tabular-nums text-[var(--ink,#101310)]">
            {counts[key]}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Blockers({ preview }: { preview: EquipmentMoveSummary }) {
  const t = useTranslations("common");
  if (preview.blockers.length === 0) return null;
  return (
    <div
      role="alert"
      className="rounded-2xl border-2 border-[#e7b5ae] bg-[#fbe9e7] px-4 py-3 text-sm font-bold text-[var(--risk-text,#b42318)]"
    >
      <p>{t("assets.move.blocked")}</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 font-medium">
        {preview.blockers.map((blocker, index) => (
          <li key={`${blocker.code}-${index}`}>
            {t(`assets.move.blockers.${blocker.code}`, {
              count: blocker.count ?? 0,
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Warnings({ preview }: { preview: EquipmentMoveSummary }) {
  const t = useTranslations("common");
  if (preview.warnings.length === 0) return null;
  return (
    <ul className="space-y-1 rounded-xl border border-[#e4c98f] bg-[#fdf5e4] px-4 py-3 text-xs font-bold text-[#7a4f0c]">
      {preview.warnings.map((warning, index) => (
        <li key={`${warning.code}-${index}`}>
          {t(`assets.move.warnings.${warning.code}`)}
        </li>
      ))}
    </ul>
  );
}

export default function EquipmentMoveForm({
  equipmentId,
  equipmentModel,
  currentCustomerName,
  initialCounts,
}: {
  equipmentId: string;
  equipmentModel: string;
  currentCustomerName: string;
  initialCounts: EquipmentMoveCounts;
}) {
  const t = useTranslations("common");
  const customerSearchId = useId();
  const siteId = useId();
  const confirmId = useId();
  const checkboxId = useId();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EquipmentMoveCustomerOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [selected, setSelected] = useState<EquipmentMoveCustomerOption | null>(
    null,
  );
  const [sites, setSites] = useState<EquipmentMoveSiteOption[]>([]);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [sitesError, setSitesError] = useState(false);
  const [targetSiteId, setTargetSiteId] = useState("");
  const [preview, setPreview] = useState<EquipmentMoveSummary | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [understood, setUnderstood] = useState(false);
  const previewRequest = useRef(0);

  useEffect(() => {
    if (selected || query.trim().length < 2) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setSearchError(false);
      try {
        const data = await getJson<{ customers: EquipmentMoveCustomerOption[] }>(
          `/api/enheter/${encodeURIComponent(equipmentId)}/flytt/kunder?q=${encodeURIComponent(query.trim())}`,
        );
        if (!controller.signal.aborted) setResults(data.customers);
      } catch {
        if (!controller.signal.aborted) {
          setResults([]);
          setSearchError(true);
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [equipmentId, query, selected]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    getJson<{ sites: EquipmentMoveSiteOption[] }>(
      `/api/enheter/${encodeURIComponent(equipmentId)}/flytt/steder?customerId=${encodeURIComponent(selected.id)}`,
    )
      .then((data) => {
        if (!cancelled) setSites(data.sites);
      })
      .catch(() => {
        if (!cancelled) {
          setSites([]);
          setSitesError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setSitesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [equipmentId, selected]);

  useEffect(() => {
    if (!selected) {
      return;
    }

    const request = ++previewRequest.current;
    const params = new URLSearchParams({ customerId: selected.id });
    if (targetSiteId) params.set("siteId", targetSiteId);
    getJson<EquipmentMoveSummary>(
      `/api/enheter/${encodeURIComponent(equipmentId)}/flytt?${params.toString()}`,
    )
      .then((data) => {
        if (previewRequest.current !== request) return;
        setPreview(data);
        setTypedName("");
        setUnderstood(false);
      })
      .catch(() => {
        if (previewRequest.current !== request) return;
        setPreview(null);
        setPreviewError(true);
      })
      .finally(() => {
        if (previewRequest.current === request) setPreviewLoading(false);
      });
  }, [equipmentId, selected, targetSiteId]);

  const nameConfirmed =
    Boolean(selected) && typedName.trim() === selected?.name.trim();
  const canSubmit = Boolean(
    selected &&
      preview &&
      preview.canMove &&
      !previewLoading &&
      (nameConfirmed || understood),
  );

  return (
    <div className="space-y-4">
      <section className={CARD} aria-labelledby="move-customer">
        <h2
          id="move-customer"
          className="border-b border-[var(--line,#dedcd1)] pb-2 text-xs font-black uppercase tracking-[0.12em]"
        >
          {t("assets.move.targetCustomer")}
        </h2>
        <p className="mt-2 text-sm text-[var(--muted,#62685f)]">
          {t("assets.move.currentCustomer")}:{" "}
          <span className="font-bold text-[var(--ink,#101310)]">
            {currentCustomerName}
          </span>
          {" · "}
          {equipmentModel}
        </p>

        {selected ? (
          <div className="mt-3 rounded-xl border border-[var(--ink,#101310)] bg-[var(--paper,#f2efe6)] p-3">
            <p className={LABEL}>{t("assets.move.selectedCustomer")}</p>
            <p className="mt-1 text-lg font-black text-[var(--ink,#101310)]">
              {selected.name}
            </p>
            <p className="text-xs text-[var(--muted,#62685f)]">
              {[selected.customerNumber, selected.city]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <button
              type="button"
              onClick={() => {
                setSelected(null);
                setQuery("");
                setResults([]);
                setSearching(false);
                setSearchError(false);
                setTargetSiteId("");
                setSites([]);
                setSitesLoading(false);
                setSitesError(false);
                setPreview(null);
                setPreviewLoading(false);
                setPreviewError(false);
              }}
              className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-xs font-bold underline underline-offset-2"
            >
              {t("assets.move.changeCustomer")}
            </button>
          </div>
        ) : (
          <div className="mt-3">
            <label htmlFor={customerSearchId} className={LABEL}>
              {t("assets.move.searchLabel")}
            </label>
            <input
              id={customerSearchId}
              type="search"
              value={query}
              onChange={(event) => {
                const value = event.target.value;
                setQuery(value);
                setSearchError(false);
                if (value.trim().length < 2) {
                  setResults([]);
                  setSearching(false);
                } else {
                  setSearching(true);
                }
              }}
              placeholder={t("assets.move.searchPlaceholder")}
              autoComplete="off"
              className={CONTROL}
            />
            <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
              {t("assets.move.searchHint")}
            </p>
            {searching && (
              <p className="mt-2 text-xs font-bold" role="status">
                {t("assets.move.searching")}
              </p>
            )}
            {searchError && (
              <p className="mt-2 text-xs font-bold text-[var(--risk-text,#b42318)]" role="alert">
                {t("assets.move.searchError")}
              </p>
            )}
            {!searching &&
              !searchError &&
              query.trim().length >= 2 &&
              results.length === 0 && (
                <p className="mt-2 text-xs italic text-[var(--muted,#62685f)]">
                  {t("assets.move.searchEmpty")}
                </p>
              )}
            {results.length > 0 && (
              <ul className="mt-2 divide-y divide-[var(--line,#dedcd1)] rounded-xl border border-[var(--line,#dedcd1)]">
                {results.map((customer) => (
                  <li key={customer.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(customer);
                        setTargetSiteId("");
                        setResults([]);
                        setSearching(false);
                        setSearchError(false);
                        setSites([]);
                        setSitesLoading(true);
                        setSitesError(false);
                        setPreview(null);
                        setPreviewLoading(true);
                        setPreviewError(false);
                      }}
                      className="flex min-h-11 w-full flex-col items-start px-3 py-2 text-left hover:bg-[var(--paper,#f2efe6)]"
                    >
                      <span className="text-sm font-bold">{customer.name}</span>
                      <span className="text-xs text-[var(--muted,#62685f)]">
                        {[customer.customerNumber, customer.city]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {selected && (
          <div className="mt-4">
            <label htmlFor={siteId} className={LABEL}>
              {t("assets.move.targetSite")}
            </label>
            <select
              id={siteId}
              value={targetSiteId}
              onChange={(event) => {
                setTargetSiteId(event.target.value);
                setPreview(null);
                setPreviewLoading(true);
                setPreviewError(false);
              }}
              disabled={sitesLoading}
              className={CONTROL}
            >
              <option value="">{t("assets.move.siteNone")}</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                  {site.address ? ` — ${site.address}` : ""}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
              {sitesLoading
                ? t("assets.move.siteLoading")
                : sitesError
                  ? t("assets.move.siteError")
                  : t("assets.move.targetSiteHint")}
            </p>
          </div>
        )}
      </section>

      <section className={CARD} aria-labelledby="move-preview">
        <h2
          id="move-preview"
          className="border-b border-[var(--line,#dedcd1)] pb-2 text-xs font-black uppercase tracking-[0.12em]"
        >
          {t("assets.move.whatMoves")}
        </h2>
        <p className="mt-2 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2 text-xs font-bold text-[var(--ink,#101310)]">
          {t("assets.move.warning")}
        </p>
        <Counts counts={preview?.counts ?? initialCounts} />

        {!selected && (
          <p className="mt-3 text-xs italic text-[var(--muted,#62685f)]">
            {t("assets.move.noSelection")}
          </p>
        )}
        {previewLoading && (
          <p className="mt-3 text-xs font-bold" role="status">
            {t("assets.move.previewLoading")}
          </p>
        )}
        {previewError && (
          <p className="mt-3 text-xs font-bold text-[var(--risk-text,#b42318)]" role="alert">
            {t("assets.move.previewError")}
          </p>
        )}
        {preview && !previewLoading && (
          <div className="mt-3 space-y-2">
            <Blockers preview={preview} />
            <Warnings preview={preview} />
            {preview.noop && (
              <p
                role="status"
                className="rounded-xl border border-[#a9c96a] bg-[#eef7d6] px-4 py-3 text-sm font-bold text-[#283509]"
              >
                {t("assets.move.noop")}
              </p>
            )}
          </div>
        )}
        <p className="mt-3 text-xs text-[var(--muted,#62685f)]">
          {t("assets.move.contractsNote")}
        </p>
      </section>

      <form action={moveEquipmentToCustomerAction} className={CARD}>
        <input type="hidden" name="id" value={equipmentId} />
        <input type="hidden" name="targetCustomerId" value={selected?.id ?? ""} />
        <input type="hidden" name="targetSiteId" value={targetSiteId} />
        <input type="hidden" name="previewHash" value={preview?.previewHash ?? ""} />

        <h2 className="border-b border-[var(--line,#dedcd1)] pb-2 text-xs font-black uppercase tracking-[0.12em]">
          {t("assets.move.confirm")}
        </h2>
        <p className="mt-2 text-xs text-[var(--muted,#62685f)]">
          {t("assets.move.confirmHint")}
        </p>

        <div className="mt-3">
          <label htmlFor={confirmId} className={LABEL}>
            {t("assets.move.confirmTyping", { name: selected?.name ?? "" })}
          </label>
          <input
            id={confirmId}
            type="text"
            value={typedName}
            onChange={(event) => setTypedName(event.target.value)}
            disabled={!selected || !preview?.canMove}
            autoComplete="off"
            className={CONTROL}
          />
        </div>

        <label
          htmlFor={checkboxId}
          className="mt-3 flex items-start gap-2 text-sm font-bold text-[var(--ink,#101310)]"
        >
          <input
            id={checkboxId}
            type="checkbox"
            checked={understood}
            onChange={(event) => setUnderstood(event.target.checked)}
            disabled={!selected || !preview?.canMove}
            className="mt-0.5 h-5 w-5 rounded border-[var(--line,#dedcd1)]"
          />
          <span>{t("assets.move.confirmCheckbox")}</span>
        </label>

        <div className="mt-4">
          <SubmitButton
            className={SIGNAL_BUTTON}
            disabled={!canSubmit}
            pendingLabel={t("assets.move.submitting")}
          >
            <Icon name="sync" className="h-4 w-4" />
            {t("assets.move.submit")}
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
