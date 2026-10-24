"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import FieldInput, { type TemplateField } from "./FieldInput";
import MarkdownEditor from "@/components/MarkdownEditor";
import SignaturePad from "@/components/SignaturePad";
import { readLineComment } from "@/lib/report-answers";
import { saveDraft, submitReport } from "./actions";

export type CustomerUnit = {
  id: string;
  model: string;
  serialNumber: string | null;
  location: string | null;
};

type UnitEntry = {
  key: string;
  productId: string;
  label: string;
  serialNumber: string;
  location: string;
  status: "GODKJENT" | "AVVIK";
  comment: string;
  answers: Record<string, unknown>;
};

export type InitialReport = {
  notes: string;
  technicianSignatureUrl: string | null;
  technicianName: string | null;
  customerSignatureUrl: string | null;
  customerName: string | null;
  units: Omit<UnitEntry, "key">[];
};

function makeUnit(key: string, from?: Partial<UnitEntry> | null): UnitEntry {
  return {
    key,
    productId: from?.productId ?? "",
    label: from?.label ?? "",
    serialNumber: from?.serialNumber ?? "",
    location: from?.location ?? "",
    status: from?.status === "AVVIK" ? "AVVIK" : "GODKJENT",
    comment: from?.comment ?? "",
    answers: from?.answers ?? {},
  };
}

/** Lagre-knapp som viser at skjemaet sendes, og hindrer dobbeltklikk. */
function SubmitButton({ isEditing }: { isEditing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full bg-blue-700 text-white py-4 rounded-xl font-black text-lg hover:bg-blue-800 transition shadow-md flex justify-center items-center gap-2 disabled:opacity-60 disabled:cursor-wait"
    >
      {pending ? "Lagrer …" : isEditing ? "💾 Lagre endringer" : "💾 Lagre rapport"}
    </button>
  );
}

export default function ReportForm({
  workOrderId,
  templateId,
  fields,
  customerUnits,
  defaultUnitId,
  technicianName,
  initialReport,
  initialDraft,
  draftUpdatedAt,
  returnTo,
}: {
  workOrderId: string;
  templateId: string;
  fields: TemplateField[];
  customerUnits: CustomerUnit[];
  defaultUnitId?: string | null;
  technicianName?: string;
  initialReport?: InitialReport;
  /** Autolagret kladd – brukes hvis den finnes, ellers den lagrede rapporten. */
  initialDraft?: InitialReport;
  draftUpdatedAt?: string;
  /** Siden skjemaet ble åpnet fra, så vi kan sende brukeren tilbake dit. */
  returnTo?: string;
}) {
  const isEditing = Boolean(initialReport);
  const seed = initialDraft ?? initialReport;

  const [state, setState] = useState(() => {
    // Gjenopprett kladd/opplåst rapport: vis de lagrede enhetene og svarene.
    const startUnits =
      seed && seed.units.length > 0
        ? seed.units.map((unit, index) => makeUnit(`unit-${index}`, unit))
        : (() => {
            const from = customerUnits.find((u) => u.id === defaultUnitId) ?? null;
            return [
              makeUnit("unit-0", from
                ? {
                    productId: from.id,
                    label: from.model,
                    serialNumber: from.serialNumber ?? "",
                    location: from.location ?? "",
                  }
                : null),
            ];
          })();

    return { counter: startUnits.length, units: startUnits };
  });

  const { units } = state;

  // --- Autolagring av kladd -------------------------------------------------
  // Skjemaet er i stor grad ukontrollert (defaultValue), så vi leser feltene
  // med `new FormData(form)` når vi lagrer. Endringer i skjemaet utløser en
  // debounced lagring, slik at kladden oppdateres etter hvert som enhetene
  // fylles ut.
  const formRef = useRef<HTMLFormElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [draftStatus, setDraftStatus] = useState<"idle" | "saving" | "saved" | "error">(
    initialDraft ? "saved" : "idle",
  );
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(
    draftUpdatedAt ? new Date(draftUpdatedAt) : null,
  );

  const saveDraftNow = useCallback(async () => {
    const form = formRef.current;
    if (!form) return;
    setDraftStatus("saving");
    try {
      const result = await saveDraft(new FormData(form));
      if (result.ok) {
        setDraftStatus("saved");
        setDraftSavedAt(result.savedAt ? new Date(result.savedAt) : new Date());
      } else {
        setDraftStatus("error");
      }
    } catch {
      setDraftStatus("error");
    }
  }, []);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveDraftNow();
    }, 1200);
  }, [saveDraftNow]);

  // Lagre når fanen skjules eller lukkes, så siste endring ikke går tapt.
  useEffect(() => {
    const flush = () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        void saveDraftNow();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [saveDraftNow]);

  // Sjekkpunkter som krever oppfølging (f.eks. «Utbedres»), gruppert per enhet.
  // Brukes til å advare hvis enheten likevel er satt til «Godkjent».
  const [followUps, setFollowUps] = useState<Record<string, string[]>>({});

  const setFieldNeedsComment = (unitKey: string, fieldId: string, needs: boolean) =>
    setFollowUps((prev) => {
      const current = prev[unitKey] ?? [];
      const next = needs
        ? current.includes(fieldId)
          ? current
          : [...current, fieldId]
        : current.filter((id) => id !== fieldId);
      if (next === current || (next.length === current.length && next.every((v, i) => v === current[i]))) {
        return prev;
      }
      return { ...prev, [unitKey]: next };
    });

  const patchUnit = (key: string, patch: Partial<UnitEntry>) => {
    setState((s) => ({ ...s, units: s.units.map((u) => (u.key === key ? { ...u, ...patch } : u)) }));
    scheduleSave();
  };

  const addUnit = () => {
    setState((s) => ({ counter: s.counter + 1, units: [...s.units, makeUnit(`unit-${s.counter}`)] }));
    scheduleSave();
  };

  const removeUnit = (key: string) => {
    setState((s) => ({ ...s, units: s.units.filter((u) => u.key !== key) }));
    scheduleSave();
  };

  /** Velger en registrert enhet fra kundekortet og fyller inn feltene. */
  const linkRegisteredUnit = (key: string, productId: string) => {
    const found = customerUnits.find((u) => u.id === productId);
    if (!found) {
      patchUnit(key, { productId: "" });
      return;
    }
    patchUnit(key, {
      productId: found.id,
      label: found.model,
      serialNumber: found.serialNumber ?? "",
      location: found.location ?? "",
    });
  };

  const overallStatus = units.some((u) => u.status === "AVVIK") ? "AVVIK" : "GODKJENT";

  // Enhetslisten sendes som JSON, mens svarene sendes som vanlige felt
  // (answer__<enhetsnøkkel>__<feltId>) slik at de blir enkle å lese på serveren.
  const unitsJson = JSON.stringify(
    units.map(({ key, productId, label, serialNumber, location }) => ({
      key,
      productId,
      label,
      serialNumber,
      location,
    })),
  );

  const statusLabel = "block text-xs font-black uppercase tracking-wider text-gray-600 mb-2";

  return (
    <form
      ref={formRef}
      action={submitReport}
      onChange={scheduleSave}
      onInput={scheduleSave}
      className="bg-white p-5 sm:p-8 rounded-2xl shadow-sm border-2 border-gray-200 space-y-8"
    >
      <input type="hidden" name="workOrderId" value={workOrderId} />
      <input type="hidden" name="templateId" value={templateId} />
      <input type="hidden" name="unitsJson" value={unitsJson} />
      <input type="hidden" name="status" value={overallStatus} />
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}

      {/* Status for autolagret kladd */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold">
        <span
          className={
            draftStatus === "error"
              ? "text-red-700"
              : draftStatus === "saving"
                ? "text-blue-700"
                : "text-gray-500"
          }
        >
          {draftStatus === "saving" && "💾 Lagrer kladd …"}
          {draftStatus === "saved" &&
            `✅ Kladd lagret${draftSavedAt ? ` ${draftSavedAt.toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" })}` : ""}`}
          {draftStatus === "error" && "⚠️ Kunne ikke lagre kladd – sjekk nettet"}
          {draftStatus === "idle" && "Kladd lagres automatisk mens du fyller ut"}
        </span>
        <button
          type="button"
          onClick={() => void saveDraftNow()}
          className="bg-gray-100 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-200 transition"
        >
          Lagre kladd nå
        </button>
      </div>

      {initialDraft && (
        <div className="bg-blue-50 border-2 border-blue-200 text-blue-900 rounded-xl px-4 py-3 text-sm font-medium">
          📝 En lagret kladd er gjenopprettet. Fortsett der du slapp – eller lagre rapporten når du er ferdig.
        </div>
      )}

      {isEditing && (
        <div className="bg-amber-50 border-2 border-amber-300 text-amber-900 rounded-xl px-4 py-3 text-sm font-medium">
          ⚠️ Denne rapporten var låst, men er låst opp av en administrator. Endringer på en
          signert rapport bør bare gjøres hvis det er absolutt nødvendig. Rapporten låses
          automatisk igjen når du lagrer.
        </div>
      )}

      {/* SAMLET RESULTAT */}
      <div className={`p-4 rounded-xl border-2 ${overallStatus === "AVVIK" ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"}`}>
        <p className="text-[10px] font-black uppercase tracking-wider text-gray-500 mb-1">Samlet resultat for jobben</p>
        <p className={`font-black ${overallStatus === "AVVIK" ? "text-red-800" : "text-green-800"}`}>
          {overallStatus === "AVVIK" ? "❌ Avvik funnet på en eller flere enheter" : "✅ Godkjent / utført"}
        </p>
        <p className="text-[11px] text-gray-600 mt-1">Settes automatisk ut fra resultatet på hver enhet.</p>
      </div>

      {/* ENHETER */}
      <div className="space-y-4 border-t-2 border-b-2 border-gray-200 py-6">
        <div className="flex flex-wrap justify-between items-start gap-3">
          <div>
            <h2 className="text-lg font-black text-gray-900">Enheter som er kontrollert</h2>
            <p className="text-[11px] text-gray-500">Én rad per enhet. Legg til flere, eller fjern rader du ikke trenger.</p>
          </div>
          <button
            type="button"
            onClick={addUnit}
            className="bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-blue-800 transition shadow-sm whitespace-nowrap"
          >
            ＋ Legg til enhet
          </button>
        </div>

        {units.length === 0 && (
          <p className="text-sm text-gray-500 italic bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl p-4">
            Ingen enheter er lagt til. Rapporten lagres med notater og signaturer.
          </p>
        )}

        {units.map((unit, index) => (
          <div key={unit.key} className="border-2 border-gray-200 rounded-2xl p-4 sm:p-5 bg-white space-y-4">
            <div className="flex justify-between items-center gap-3">
              <h3 className="font-black text-gray-900">🔧 Enhet {index + 1}</h3>
              <button
                type="button"
                onClick={() => removeUnit(unit.key)}
                className="text-[11px] font-bold text-red-600 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg border border-red-200 transition whitespace-nowrap"
              >
                🗑 Fjern enhet
              </button>
            </div>

            {customerUnits.length > 0 && (
              <div>
                <label className={statusLabel}>Hent fra kundens utstyr</label>
                <select
                  value={unit.productId}
                  onChange={(e) => linkRegisteredUnit(unit.key, e.target.value)}
                  className="w-full border-2 border-gray-300 p-2.5 rounded-xl text-sm font-bold text-gray-900 bg-white outline-none focus:border-blue-700"
                >
                  <option value="">– Ny enhet (ikke registrert fra før) –</option>
                  {customerUnits.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.model}
                      {u.serialNumber ? ` (SN: ${u.serialNumber})` : ""}
                      {u.location ? ` – ${u.location}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={statusLabel}>Betegnelse *</label>
                <input
                  type="text"
                  required
                  value={unit.label}
                  onChange={(e) => patchUnit(unit.key, { label: e.target.value })}
                  placeholder="F.eks. Port Nord"
                  className="w-full border-2 border-gray-300 p-2.5 rounded-xl text-sm font-bold text-gray-900 bg-gray-50 outline-none focus:border-blue-700"
                />
              </div>
              <div>
                <label className={statusLabel}>Serienummer</label>
                <input
                  type="text"
                  value={unit.serialNumber}
                  onChange={(e) => patchUnit(unit.key, { serialNumber: e.target.value })}
                  placeholder="F.eks. 12-3456"
                  className="w-full border-2 border-gray-300 p-2.5 rounded-xl text-sm font-bold text-gray-900 bg-gray-50 outline-none focus:border-blue-700"
                />
              </div>
              <div>
                <label className={statusLabel}>Plassering</label>
                <input
                  type="text"
                  value={unit.location}
                  onChange={(e) => patchUnit(unit.key, { location: e.target.value })}
                  placeholder="F.eks. Bygg A, plan 2"
                  className="w-full border-2 border-gray-300 p-2.5 rounded-xl text-sm font-bold text-gray-900 bg-gray-50 outline-none focus:border-blue-700"
                />
              </div>
            </div>

            {unit.productId ? (
              <p className="text-[11px] font-bold text-green-700">🔗 Koblet til registrert enhet på kundekortet</p>
            ) : (
              unit.label.trim() !== "" && (
                <p className="text-[11px] font-bold text-blue-700">＋ Lagres som ny enhet på kunden</p>
              )
            )}

            {/* RESULTAT PER ENHET */}
            <div>
              <label className={statusLabel}>Resultat for denne enheten *</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label
                  className={`flex items-center gap-3 p-4 border-2 rounded-xl cursor-pointer transition bg-white ${
                    unit.status === "GODKJENT" ? "border-green-600 bg-green-50" : "border-gray-300 hover:bg-green-50"
                  }`}
                >
                  <input
                    type="radio"
                    name={`status__${unit.key}`}
                    value="GODKJENT"
                    checked={unit.status === "GODKJENT"}
                    onChange={() => patchUnit(unit.key, { status: "GODKJENT" })}
                    className="w-5 h-5 text-green-600"
                  />
                  <span className="font-bold text-gray-900">✅ Godkjent / utført</span>
                </label>

                <label
                  className={`flex items-center gap-3 p-4 border-2 rounded-xl cursor-pointer transition bg-white ${
                    unit.status === "AVVIK" ? "border-red-600 bg-red-50" : "border-gray-300 hover:bg-red-50"
                  }`}
                >
                  <input
                    type="radio"
                    name={`status__${unit.key}`}
                    value="AVVIK"
                    checked={unit.status === "AVVIK"}
                    onChange={() => patchUnit(unit.key, { status: "AVVIK" })}
                    className="w-5 h-5 text-red-600"
                  />
                  <span className="font-bold text-gray-900">❌ Avvik funnet</span>
                </label>
              </div>
            </div>

            {/* SJEKKPUNKTER PER ENHET */}
            {fields.length > 0 && (
              <div className="space-y-4 border-t-2 border-gray-100 pt-4">
                <h4 className={statusLabel}>Sjekkpunkter</h4>
                {fields.map((field) => (
                  <FieldInput
                    key={field.id}
                    field={field}
                    name={`answer__${unit.key}__${field.id}`}
                    commentName={`linecomment__${unit.key}__${field.id}`}
                    defaultValue={unit.answers[field.id]}
                    defaultComment={readLineComment(unit.answers, field.id)}
                    onNeedsComment={(needs) => setFieldNeedsComment(unit.key, field.id, needs)}
                    workOrderId={workOrderId}
                  />
                ))}
              </div>
            )}

            {(() => {
              const pending = followUps[unit.key] ?? [];
              if (pending.length === 0) return null;
              return (
                <div className="bg-amber-50 border-2 border-amber-300 text-amber-900 rounded-xl px-4 py-3 text-sm font-bold space-y-2">
                  <p>
                    ⚠️ {pending.length === 1
                      ? "Ett sjekkpunkt krever oppfølging"
                      : `${pending.length} sjekkpunkter krever oppfølging`}
                    {unit.status === "GODKJENT" &&
                      ". Enheten er satt til «Godkjent / utført» – stemmer det?"}
                  </p>
                  {unit.status === "GODKJENT" && (
                    <button
                      type="button"
                      onClick={() => patchUnit(unit.key, { status: "AVVIK" })}
                      className="bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-black hover:bg-amber-700 transition"
                    >
                      Sett resultatet til «Avvik funnet»
                    </button>
                  )}
                </div>
              );
            })()}

            {/* KOMMENTAR PER ENHET */}
            <div>
              <label className={statusLabel}>Kommentar for denne enheten</label>
              <MarkdownEditor
                name={`comment__${unit.key}`}
                defaultValue={unit.comment}
                rows={2}
                placeholder="Avvik, utbedringer eller annet som gjelder denne enheten ..."
              />
            </div>
          </div>
        ))}
      </div>

      {/* GENERELLE NOTATER */}
      <div>
        <label className="block text-sm font-black text-gray-900 mb-2 uppercase tracking-wider">
          Generelle notater for jobben
        </label>
        <MarkdownEditor
          name="notes"
          rows={4}
          defaultValue={seed?.notes ?? ""}
          placeholder="Skriv inn eventuelle generelle merknader ..."
        />
      </div>

      {/* SIGNATURER */}
      <div className="border-t-2 border-b-2 border-gray-200 py-6 space-y-6">
        <div>
          <h2 className="text-lg font-black text-gray-900">Signaturer</h2>
          <p className="text-[11px] text-gray-500">
            Signer med finger eller mus. Det er valgfritt hvem som signerer – tekniker, kunde eller begge.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <SignaturePad
            name="technicianSignature"
            nameFieldName="technicianName"
            defaultName={seed?.technicianName ?? technicianName}
            label="✍️ Montør / tekniker"
            helperText="Den som utførte jobben."
            existingUrl={seed?.technicianSignatureUrl}
          />
          <SignaturePad
            name="customerSignature"
            nameFieldName="customerName"
            defaultName={seed?.customerName ?? undefined}
            label="✍️ Kunde"
            helperText="Kundens representant på stedet."
            existingUrl={seed?.customerSignatureUrl}
          />
        </div>
      </div>

      {/* Sticky lagreknapp på mobil, så skjemaet kan fylles ut med én hånd. */}
      <div className="sticky bottom-0 z-20 -mx-4 border-t border-gray-200 bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <SubmitButton isEditing={isEditing} />
      </div>
    </form>
  );
}
