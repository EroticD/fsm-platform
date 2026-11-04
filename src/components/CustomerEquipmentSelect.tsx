"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

export type CustomerEquipmentOption = {
  id: string;
  customerId: string;
  model: string;
  serialNumber: string | null;
  location: string | null;
};

type EquipmentResponse = {
  equipment?: CustomerEquipmentOption[];
  error?: string;
};

type CustomerEquipmentSelectProps = {
  customerId: string;
  initialEquipment?: CustomerEquipmentOption[];
  initialEquipmentId?: string | null;
  excludeId?: string | null;
  id: string;
  name?: string;
  label: string;
  noEquipmentLabel: string;
  hint?: string;
  className: string;
};

/**
 * Velger for overordnet enhet, avgrenset til den valgte kunden.
 *
 * Enhetene hentes fra et autentisert endepunkt som på nytt kontrollerer
 * `equipment.view` og alltid filtrerer på `customerId`. Ingen hele-register-
 * liste ligger i sidens payload.
 */
export default function CustomerEquipmentSelect({
  customerId,
  initialEquipment = [],
  initialEquipmentId = null,
  excludeId = null,
  id,
  name = "parentId",
  label,
  noEquipmentLabel,
  hint,
  className,
}: CustomerEquipmentSelectProps) {
  const t = useTranslations("common");
  const [equipment, setEquipment] =
    useState<CustomerEquipmentOption[]>(initialEquipment);
  const [equipmentId, setEquipmentId] = useState(initialEquipmentId ?? "");
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const loadedFor = useRef<string>(initialEquipment.length > 0 ? customerId : "");
  const requestRef = useRef(0);

  useEffect(() => {
    if (!customerId || loadedFor.current === customerId) return;

    let active = true;
    const request = ++requestRef.current;
    const controller = new AbortController();
    const params = new URLSearchParams({ customerId });
    if (excludeId) params.set("excludeId", excludeId);

    const timer = window.setTimeout(async () => {
      setLoading(true);
      setFailed(false);
      try {
        const response = await fetch(
          `/api/kunder/enheter?${params.toString()}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("enheter-feilet");
        const data = (await response.json()) as EquipmentResponse;
        if (!active || request !== requestRef.current) return;
        const next = data.equipment ?? [];
        setEquipment(next);
        setEquipmentId((current) =>
          next.some((item) => item.id === current) ? current : "",
        );
        loadedFor.current = customerId;
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        if (!active || request !== requestRef.current) return;
        setEquipment([]);
        setEquipmentId("");
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
  }, [customerId, excludeId]);

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted,#62685f)]">
        {label}
      </label>
      <select
        id={id}
        name={name}
        value={equipmentId}
        onChange={(event) => setEquipmentId(event.target.value)}
        disabled={!customerId || loading}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={className}
      >
        <option value="">{noEquipmentLabel}</option>
        {equipment.map((item) => (
          <option key={item.id} value={item.id}>
            {item.model}
            {item.serialNumber ? ` (${item.serialNumber})` : ""}
            {item.location ? ` · ${item.location}` : ""}
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
