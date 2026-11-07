"use client";

import { useState } from "react";
import Icon from "@/components/icons";

export type EditableLine = {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  vatRate: string;
};

const EMPTY_LINE: EditableLine = {
  description: "",
  quantity: "1",
  unit: "stk",
  unitPrice: "",
  vatRate: "25",
};

const INPUT =
  "min-h-11 w-full rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 text-sm";

/**
 * Redigerbare linjer for tilbud og fakturaer. Komponenten sender én skjult
 * JSON-verdi til server-handlingen; tjenestelaget regner alltid beløpene på
 * nytt og stoler ikke på det klienten viser.
 */
export type LineEditorLabels = {
  /** Mal med «§» der linjenummeret skal inn, f.eks. «Linje §». */
  lineFormat: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  vatRate: string;
  add: string;
  remove: string;
};

export default function LineItemsEditor({
  labels,
  initialLines,
  vatRate = "25",
}: {
  labels: LineEditorLabels;
  initialLines: EditableLine[];
  vatRate?: string;
}) {
  const [lines, setLines] = useState<EditableLine[]>(
    initialLines.length > 0
      ? initialLines
      : [{ ...EMPTY_LINE, vatRate }],
  );

  const update = (index: number, key: keyof EditableLine, value: string) => {
    setLines((current) =>
      current.map((line, i) => (i === index ? { ...line, [key]: value } : line)),
    );
  };

  const add = () => {
    setLines((current) => [...current, { ...EMPTY_LINE, vatRate }]);
  };

  const remove = (index: number) => {
    setLines((current) =>
      current.length === 1 ? current : current.filter((_, i) => i !== index),
    );
  };

  return (
    <div className="space-y-3">
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      {lines.map((line, index) => (
        <fieldset
          key={index}
          className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-3"
        >
          <legend className="px-1 text-xs font-black uppercase tracking-wide text-[var(--muted,#62685f)]">
            {labels.lineFormat.replace("§", String(index + 1))}
          </legend>
          <div className="grid gap-2 sm:grid-cols-12">
            <label className="sm:col-span-5">
              <span className="mb-1 block text-xs font-bold">
                {labels.description}
              </span>
              <input
                value={line.description}
                onChange={(event) => update(index, "description", event.target.value)}
                className={INPUT}
                maxLength={200}
                required
              />
            </label>
            <label className="sm:col-span-2">
              <span className="mb-1 block text-xs font-bold">
                {labels.quantity}
              </span>
              <input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={line.quantity}
                onChange={(event) => update(index, "quantity", event.target.value)}
                className={INPUT}
                required
              />
            </label>
            <label className="sm:col-span-2">
              <span className="mb-1 block text-xs font-bold">{labels.unit}</span>
              <input
                value={line.unit}
                onChange={(event) => update(index, "unit", event.target.value)}
                className={INPUT}
                maxLength={120}
              />
            </label>
            <label className="sm:col-span-2">
              <span className="mb-1 block text-xs font-bold">
                {labels.unitPrice}
              </span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={line.unitPrice}
                onChange={(event) => update(index, "unitPrice", event.target.value)}
                className={INPUT}
                required
              />
            </label>
            <label className="sm:col-span-1">
              <span className="mb-1 block text-xs font-bold">{labels.vatRate}</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                step="0.01"
                value={line.vatRate}
                onChange={(event) => update(index, "vatRate", event.target.value)}
                className={INPUT}
                required
              />
            </label>
          </div>
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => remove(index)}
              disabled={lines.length === 1}
              className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-[var(--line,#dedcd1)] px-3 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="trash" className="h-4 w-4" />
              {labels.remove}
            </button>
          </div>
        </fieldset>
      ))}
      <button
        type="button"
        onClick={add}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] px-3 py-2 text-xs font-bold"
      >
        <Icon name="plus" className="h-4 w-4" />
        {labels.add}
      </button>
    </div>
  );
}
