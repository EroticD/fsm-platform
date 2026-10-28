"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import FieldInput, { type TemplateField } from "./FieldInput";
import MarkdownEditor from "@/components/MarkdownEditor";
import SignaturePad from "@/components/SignaturePad";
import ErrorBanner from "@/components/ErrorBanner";
import ConfirmDialog from "@/components/ConfirmDialog";
import { parseImageUrls, readLineComment } from "@/lib/report-answers";
import { reportFormSections } from "./report-form-sections";
import {
  makeUnit,
  REPORT_WITHOUT_UNITS_KEY,
  restoreLocalDraft,
  type LocalDraftSnapshot,
  type ReportSeed,
  type UnitEntry,
} from "./draft-restore";
import { saveDraft, submitReport } from "./actions";
import {
  loadDraftLocally,
  queueDraftForRetry,
  removeOutboxForReport,
  saveDraftLocally,
} from "@/lib/offline/draft-outbox";

export type CustomerUnit = {
  id: string;
  model: string;
  serialNumber: string | null;
  location: string | null;
};

export type InitialReport = ReportSeed;

/** Sammenligner et svar med malens betingelsesverdi, uten hensyn til case. */
function answerMatches(value: unknown, expected: string | undefined): boolean {
  if (expected === undefined) return true;
  const raw = (value === undefined || value === null ? "" : String(value))
    .trim()
    .toLowerCase();
  const wanted = expected.trim().toLowerCase();
  if (raw === wanted) return true;
  // Avkrysningsfelt lagres som «true»/«false», men malbyggeren kan ha skrevet
  // «Ja»/«Nei» som betingelse. Godta begge skrivemåtene.
  const truthy = ["true", "ja", "yes", "1"];
  const falsy = ["false", "nei", "no", "0"];
  return (
    (truthy.includes(raw) && truthy.includes(wanted)) ||
    (falsy.includes(raw) && falsy.includes(wanted))
  );
}

/**
 * Er feltet synlig ut fra svarene i samme enhet? Betingede felt blir først
 * vist når kildefeltet har verdien malen krever.
 */
function isFieldVisible(
  field: TemplateField,
  answers: Record<string, unknown>,
): boolean {
  if (!field.conditionalFieldId) return true;
  return answerMatches(answers[field.conditionalFieldId], field.conditionalValue);
}

/** Lagre-knapp som viser at skjemaet sendes, og hindrer dobbeltklikk. */
function SubmitButton({
  isEditing,
  disabled = false,
}: {
  isEditing: boolean;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  const t = useTranslations("common");
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-describedby={disabled ? "report-no-units-error" : undefined}
      className="w-full bg-blue-700 text-white py-4 rounded-xl font-black text-lg hover:bg-blue-800 transition shadow-md flex justify-center items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {pending ? t("orders.reportForm.saving") : isEditing ? t("orders.reportForm.saveChanges") : t("orders.reportForm.saveReport")}
    </button>
  );
}

export default function ReportForm({
  workOrderId,
  userId,
  templateId,
  fields,
  customerUnits,
  defaultUnitId,
  requiresUnits = true,
  technicianName,
  initialReport,
  initialDraft,
  draftUpdatedAt,
  returnTo,
  submitError,
}: {
  workOrderId: string;
  userId: string;
  templateId: string;
  fields: TemplateField[];
  customerUnits: CustomerUnit[];
  defaultUnitId?: string | null;
  /** Når false brukes én anonym oppføring uten enhetsfelter. */
  requiresUnits?: boolean;
  technicianName?: string;
  initialReport?: InitialReport;
  /** Autolagret kladd – brukes hvis den finnes, ellers den lagrede rapporten. */
  initialDraft?: InitialReport;
  draftUpdatedAt?: string;
  /** Siden skjemaet ble åpnet fra, så vi kan sende brukeren tilbake dit. */
  returnTo?: string;
  /** Feilkode fra server-handlingen etter en avvist innsending. */
  submitError?: string;
}) {
  const isEditing = Boolean(initialReport);
  const initialSeed = initialDraft ?? initialReport;
  // Startobjektet skal bare brukes ved første gjenoppretting. Uten denne ref-en
  // ville en ny objektidentitet fra router.refresh startet restaureringen på nytt.
  const initialSeedRef = useRef(initialSeed);
  // Startobjektet kan oppdateres når en nyere lokal kladd gjenopprettes.
  // Skjemaet er delvis ukontrollert, så `formVersion` tvinger feltene til å
  // rendres på nytt med de gjenopprettede verdiene.
  const [seed, setSeed] = useState<InitialReport | undefined>(
    () => initialSeed,
  );
  const [formVersion, setFormVersion] = useState(0);
  const [localDraftRestored, setLocalDraftRestored] = useState(false);
  const t = useTranslations("common");
  const locale = useLocale();
  const formId = useId();

  const [state, setState] = useState(() => {
    // Rapport uten enheter: én anonym oppføring med fast nøkkel. Svarene
    // gjenopprettes fra kladden/den opplåste rapporten, men enhetsmetadata
    // ignoreres.
    if (!requiresUnits) {
      const previous = seed?.units[0];
      return {
        counter: 1,
        units: [
          makeUnit(REPORT_WITHOUT_UNITS_KEY, {
            status: previous?.status,
            comment: previous?.comment,
            answers: previous?.answers,
          }),
        ],
      };
    }

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
  // med `new FormData(form)` når vi lagrer. Den lokale kladden skrives kort
  // etter hver endring, uavhengig av om serverlagringen lykkes. Serverkladden
  // sendes med lengre pause, så vi ikke hamrer på API-et for hvert tastetrykk.
  const formRef = useRef<HTMLFormElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Restaureringen skal maksimalt kjøre én gang per kladdidentitet. En ny
  // render fra router.refresh må ikke remontere feltene mens montøren skriver.
  const restoreAttemptedKey = useRef<string | null>(null);
  const restoreSettledKey = useRef<string | null>(null);
  const userEditedRef = useRef(false);
  // Skriver lokale kladder sekvensielt, så en senere (nyere) snapshot alltid
  // havner etter en eldre – også om to lagringer skulle overlappe.
  const localWriteChain = useRef<Promise<void>>(Promise.resolve());
  const [draftStatus, setDraftStatus] = useState<
    "idle" | "saving" | "saved" | "error" | "offline"
  >(initialDraft ? "saved" : "idle");
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(
    draftUpdatedAt ? new Date(draftUpdatedAt) : null,
  );

  // Holder siste state tilgjengelig i autolagringen uten å gjenskape callbacken
  // på hver tastetrykk.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Hold fallbacken fersk dersom serverkladden endrer seg, uten å starte en ny
  // gjenoppretting (den styres av kladdidentiteten lenger ned).
  useEffect(() => {
    initialSeedRef.current = initialSeed;
  }, [initialSeed]);

  /** Leser hele skjemaet som strenger – samme format som serverkladden. */
  const readFormPayload = (form: HTMLFormElement): Record<string, string> => {
    const formData = new FormData(form);
    return Object.fromEntries(
      [...formData.entries()].filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  };

  /**
   * Skriver kladden til IndexedDB. Inneholder både React-state (enheter,
   * svar og betingelser) og hele FormData (notater, navn og signaturer), slik
   * at alle felter kan gjenopprettes nøyaktig slik de ble vist.
   */
  const writeLocalDraft = useCallback(async (): Promise<boolean> => {
    const form = formRef.current;
    if (!form) return false;
    const payload = readFormPayload(form);
    const snapshot: LocalDraftSnapshot = {
      state: stateRef.current,
      form: payload,
      notes: payload.notes ?? "",
    };
    const write = localWriteChain.current
      .catch(() => undefined)
      .then(() =>
        saveDraftLocally({
          userId,
          workOrderId,
          templateId,
          payload: snapshot,
        }),
      )
      .then(() => true)
      .catch(() => {
        // IndexedDB utilgjengelig – serverlagringen kan fortsatt lykkes.
        return false;
      });
    localWriteChain.current = write.then(
      () => undefined,
      () => undefined,
    );
    return write;
  }, [templateId, userId, workOrderId]);

  const saveDraftNow = useCallback(async () => {
    const form = formRef.current;
    if (!form) return;

    const formData = new FormData(form);

    setDraftStatus("saving");

    // Lokal først: kladden overlever nettbrudd og fanelukkinger.
    await writeLocalDraft();

    // Kladder som er lagret lokalt etter dette tidspunktet kom inn mens
    // serverkallet pågikk, og skal ikke ryddes bort av svaret.
    const saveCutoff = Date.now();

    try {
      const result = await saveDraft(formData);
      if (result.ok) {
        // Serverkladden er nå nyere enn alt som måtte ligge i outboxen fra
        // tidligere nettbrudd. Fjern de gamle oppføringene, så de ikke senere
        // replayer over den ferske kladden.
        await removeOutboxForReport(
          { workOrderId, templateId, before: saveCutoff },
          userId,
        );
        setDraftStatus("saved");
        setDraftSavedAt(result.savedAt ? new Date(result.savedAt) : new Date());
      } else {
        setDraftStatus("error");
      }
    } catch {
      setDraftStatus("offline");
      try {
        await queueDraftForRetry(readFormPayload(form));
      } catch {
        // Outbox er også utilgjengelig; den lokale kladden er likevel skrevet.
      }
    }
  }, [writeLocalDraft, templateId, userId, workOrderId]);

  const scheduleSave = useCallback(() => {
    userEditedRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveDraftNow();
    }, 1200);

    // Lokal kladd lagres raskere enn serverkladden, og uten nettavhengighet.
    if (localSaveTimer.current) clearTimeout(localSaveTimer.current);
    localSaveTimer.current = setTimeout(() => {
      localSaveTimer.current = null;
      void writeLocalDraft();
    }, 200);
  }, [saveDraftNow, writeLocalDraft]);

  // Lagre når fanen skjules eller lukkes, så siste endring ikke går tapt.
  useEffect(() => {
    const flush = () => {
      if (localSaveTimer.current) {
        clearTimeout(localSaveTimer.current);
        localSaveTimer.current = null;
        void writeLocalDraft();
      }
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
      if (localSaveTimer.current) clearTimeout(localSaveTimer.current);
    };
  }, [saveDraftNow, writeLocalDraft]);

  // Gjenopprett en nyere lokal kladd (f.eks. laget offline) når serverkladden
  // er eldre. En signert rapport skal aldri overskrives av en lokal kladd.
  // Kjører bare én gang per kladdidentitet, og aldri etter at montøren har
  // begynt å skrive – ellers ville en refresh remontert feltene midt i utfyllingen.
  useEffect(() => {
    if (initialReport) return;

    const draftIdentity = [userId, workOrderId, templateId, draftUpdatedAt ?? ""].join("|");
    if (restoreAttemptedKey.current === draftIdentity) return;
    restoreAttemptedKey.current = draftIdentity;
    if (userEditedRef.current) return;

    let active = true;
    void loadDraftLocally({ userId, workOrderId, templateId })
      .then((local) => {
        // Marker at oppslaget er fullført, også når det ikke finnes en kladd.
        restoreSettledKey.current = draftIdentity;
        if (!active || !local) return;
        const serverTime = draftUpdatedAt
          ? new Date(draftUpdatedAt).getTime()
          : 0;
        if (local.updatedAt <= serverTime) return;
        const restored = restoreLocalDraft({
          snapshot: local.payload as LocalDraftSnapshot,
          requiresUnits,
          fallback: initialSeedRef.current,
        });
        if (!restored) return;
        // State og startobjekt oppdateres i samme render, og `formVersion`
        // remonterer de ukontrollerte feltene med de gjenopprettede verdiene.
        setState(restored.state);
        setSeed(restored.seed);
        setFormVersion((version) => version + 1);
        setLocalDraftRestored(true);
        setDraftStatus("saved");
        setDraftSavedAt(new Date(local.updatedAt));
      })
      .catch(() => {
        restoreSettledKey.current = draftIdentity;
      });
    return () => {
      active = false;
      // React StrictMode kjører effekten på nytt etter en umiddelbar cleanup.
      // Slipp derfor identiteten fri igjen når oppslaget ikke rakk å fullføre,
      // slik at neste kjøring kan gjenopprette kladden.
      if (
        restoreSettledKey.current !== draftIdentity &&
        restoreAttemptedKey.current === draftIdentity
      ) {
        restoreAttemptedKey.current = null;
      }
    };
  }, [draftUpdatedAt, initialReport, requiresUnits, templateId, userId, workOrderId]);

  // Sjekkpunkter som krever oppfølging (f.eks. «Utbedres»), gruppert per enhet.
  // Brukes til å advare hvis enheten likevel er satt til «Godkjent».
  const [followUps, setFollowUps] = useState<Record<string, string[]>>({});
  const [unitToRemove, setUnitToRemove] = useState<string | null>(null);

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

  // En rapport med enheter kan ikke sendes uten minst én enhet. Serveren
  // avviser den også med `mangler-enhet`, men knappen skal aldri invitere til det.
  const missingUnits = requiresUnits && units.length === 0;

  // --- Forhåndskontroll før innsending --------------------------------------
  // Rapporten låses når den sendes, så montøren får se en oppsummering og et
  // eksplisitt låsevarsel før server-handlingen kjøres.
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewSummary, setReviewSummary] = useState<{
    units: number;
    deviations: number;
    photos: number;
    technicianSigned: boolean;
    customerSigned: boolean;
  } | null>(null);
  const bypassReview = useRef(false);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    if (bypassReview.current) {
      bypassReview.current = false;
      return;
    }
    event.preventDefault();
    if (missingUnits) return;

    const payload = formRef.current ? readFormPayload(formRef.current) : {};
    const imageFields = new Set(
      fields.filter((field) => field.type === "IMAGE").map((field) => field.id),
    );
    let photos = 0;
    for (const [key, value] of Object.entries(payload)) {
      // Bare bildefelt teller som foto. Signaturene ligger i egne felt.
      if (!key.startsWith("answer__")) continue;
      const fieldId = key.slice(key.lastIndexOf("__") + 2);
      if (imageFields.has(fieldId)) photos += parseImageUrls(value).length;
    }

    setReviewSummary({
      units: units.length,
      deviations: units.filter((unit) => unit.status === "AVVIK").length,
      photos,
      technicianSigned:
        Boolean(payload.technicianSignature) ||
        Boolean(seed?.technicianSignatureUrl),
      customerSigned:
        Boolean(payload.customerSignature) ||
        Boolean(seed?.customerSignatureUrl),
    });
    setReviewOpen(true);
  };

  const confirmSubmit = () => {
    setReviewOpen(false);
    if (!formRef.current) return;
    bypassReview.current = true;
    formRef.current.requestSubmit();
    // Hvis nettleservalideringen stopper innsendingen, må neste klikk igjen
    // åpne forhåndskontrollen i stedet for å sende direkte.
    window.setTimeout(() => {
      bypassReview.current = false;
    }, 0);
  };

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
  const visibility = reportFormSections(requiresUnits);

  const submitErrorMessages: Record<string, string> = {
    "ugyldig-data": t("orders.reportForm.errorInvalidData"),
    "mangler-enhet": t("orders.reportForm.errorMissingUnit"),
    signatur: t("orders.reportForm.errorSignature"),
    locked: t("orders.reportForm.errorLocked"),
    "legal-hold": t("orders.reportForm.errorLegalHold"),
  };
  const submitErrorMessage = submitError
    ? (submitErrorMessages[submitError] ?? t("orders.reportForm.errorGeneric"))
    : undefined;

  const signedLabel = t("orders.reportForm.reviewSigned");
  const notSignedLabel = t("orders.reportForm.reviewNotSigned");
  const reviewDescription = reviewSummary
    ? [
        requiresUnits
          ? t("orders.reportForm.reviewUnits", { count: reviewSummary.units })
          : t("orders.reportForm.reviewWithoutUnits"),
        t("orders.reportForm.reviewDeviations", {
          count: reviewSummary.deviations,
        }),
        t("orders.reportForm.reviewPhotos", { count: reviewSummary.photos }),
        t("orders.reportForm.reviewSignatures", {
          technician: reviewSummary.technicianSigned
            ? signedLabel
            : notSignedLabel,
          customer: reviewSummary.customerSigned ? signedLabel : notSignedLabel,
        }),
        t("orders.reportForm.reviewLockWarning"),
      ].join(" · ")
    : undefined;

  return (
    <form
      ref={formRef}
      action={submitReport}
      onChange={scheduleSave}
      onInput={scheduleSave}
      onSubmit={handleSubmit}
      className="bg-white p-5 sm:p-8 rounded-2xl shadow-sm border-2 border-gray-200 space-y-8"
    >
      <input type="hidden" name="workOrderId" value={workOrderId} />
      <input type="hidden" name="templateId" value={templateId} />
      <input type="hidden" name="unitsJson" value={unitsJson} />
      <input type="hidden" name="status" value={overallStatus} />
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}

      <ErrorBanner message={submitErrorMessage} />

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
          {draftStatus === "saving" && t("orders.reportForm.draftSaving")}
          {draftStatus === "saved" &&
            (draftSavedAt
              ? t("orders.reportForm.draftSavedAt", {
                  time: draftSavedAt.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
                })
              : t("orders.reportForm.draftSaved"))}
          {draftStatus === "error" && t("orders.reportForm.draftError")}
          {draftStatus === "offline" && t("orders.reportForm.draftOffline")}
          {draftStatus === "idle" && t("orders.reportForm.draftIdle")}
        </span>
        <button
          type="button"
          onClick={() => void saveDraftNow()}
          className="bg-gray-100 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-200 transition"
        >
          {t("orders.reportForm.saveDraftNow")}
        </button>
      </div>

      {(initialDraft || localDraftRestored) && (
        <div className="bg-blue-50 border-2 border-blue-200 text-blue-900 rounded-xl px-4 py-3 text-sm font-medium">
          {t("orders.reportForm.draftRestored")}
        </div>
      )}

      {isEditing && (
        <div className="bg-amber-50 border-2 border-amber-300 text-amber-900 rounded-xl px-4 py-3 text-sm font-medium">
          {t("orders.reportForm.editingWarning")}
        </div>
      )}

      {/* SAMLET RESULTAT – bare for maler som bruker enheter. */}
      <div key={formVersion}>
      {visibility.showOverallResult && (
        <div className={`p-4 rounded-xl border-2 ${overallStatus === "AVVIK" ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"}`}>
          <p className="text-[10px] font-black uppercase tracking-wider text-gray-500 mb-1">{t("orders.reportForm.overallResult")}</p>
          <p className={`font-black ${overallStatus === "AVVIK" ? "text-red-800" : "text-green-800"}`}>
            {overallStatus === "AVVIK" ? t("orders.reportForm.overallDeviation") : t("orders.reportForm.overallApproved")}
          </p>
          <p className="text-[11px] text-gray-600 mt-1">{t("orders.reportForm.overallHint")}</p>
        </div>
      )}

      {/* ENHETER – eller sjekkpunkter for en rapport uten enheter */}
      <div className="space-y-4 border-t-2 border-b-2 border-gray-200 py-6">
        {requiresUnits ? (
          <div className="flex flex-wrap justify-between items-start gap-3">
            <div>
              <h2 className="text-lg font-black text-gray-900">{t("orders.reportForm.unitsTitle")}</h2>
              <p className="text-[11px] text-gray-500">{t("orders.reportForm.unitsHint")}</p>
            </div>
            <button
              type="button"
              onClick={addUnit}
              className="bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-blue-800 transition shadow-sm whitespace-nowrap"
            >
              {t("orders.reportForm.addUnit")}
            </button>
          </div>
        ) : (
          <div>
            <h2 className="text-lg font-black text-gray-900">{t("orders.reportForm.checkpoints")}</h2>
            <p className="text-[11px] text-gray-500">{t("orders.reportForm.reportNoUnitsHint")}</p>
          </div>
        )}

        {missingUnits && (
          <p
            id="report-no-units-error"
            role="alert"
            className="text-sm font-bold text-red-700 bg-red-50 border-2 border-red-200 rounded-xl p-4"
          >
            {t("orders.reportForm.noUnits")}
          </p>
        )}

        {units.map((unit, index) => (
          <div
            key={unit.key}
            className={
              requiresUnits
                ? "border-2 border-gray-200 rounded-2xl p-4 sm:p-5 bg-white space-y-4"
                : "bg-white space-y-4"
            }
          >
            {requiresUnits && (
              <>
                <div className="flex justify-between items-center gap-3">
                  <h3 className="font-black text-gray-900">{t("orders.reportForm.unitTitle", { number: index + 1 })}</h3>
                  <button
                    type="button"
                    onClick={() => setUnitToRemove(unit.key)}
                    className="text-[11px] font-bold text-red-600 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg border border-red-200 transition whitespace-nowrap"
                  >
                    {t("orders.reportForm.removeUnit")}
                  </button>
                </div>

                {customerUnits.length > 0 && (
                  <div>
                    <label htmlFor={`${formId}-${unit.key}-product`} className={statusLabel}>{t("orders.reportForm.fromCustomerEquipment")}</label>
                    <select
                      id={`${formId}-${unit.key}-product`}
                      value={unit.productId}
                      onChange={(e) => linkRegisteredUnit(unit.key, e.target.value)}
                      className="w-full border-2 border-gray-300 p-2.5 rounded-xl text-sm font-bold text-gray-900 bg-white outline-none focus:border-blue-700"
                    >
                      <option value="">{t("orders.reportForm.newUnit")}</option>
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
                    <label htmlFor={`${formId}-${unit.key}-label`} className={statusLabel}>{t("orders.reportForm.labelField")}</label>
                    <input
                      id={`${formId}-${unit.key}-label`}
                      type="text"
                      required
                      value={unit.label}
                      onChange={(e) => patchUnit(unit.key, { label: e.target.value })}
                      placeholder={t("orders.reportForm.labelPlaceholder")}
                      className="w-full border-2 border-gray-300 p-2.5 rounded-xl text-sm font-bold text-gray-900 bg-gray-50 outline-none focus:border-blue-700"
                    />
                  </div>
                  <div>
                    <label htmlFor={`${formId}-${unit.key}-serial`} className={statusLabel}>{t("orders.reportForm.serialNumber")}</label>
                    <input
                      id={`${formId}-${unit.key}-serial`}
                      type="text"
                      value={unit.serialNumber}
                      onChange={(e) => patchUnit(unit.key, { serialNumber: e.target.value })}
                      placeholder={t("orders.reportForm.serialNumberPlaceholder")}
                      className="w-full border-2 border-gray-300 p-2.5 rounded-xl text-sm font-bold text-gray-900 bg-gray-50 outline-none focus:border-blue-700"
                    />
                  </div>
                  <div>
                    <label htmlFor={`${formId}-${unit.key}-location`} className={statusLabel}>{t("orders.reportForm.location")}</label>
                    <input
                      id={`${formId}-${unit.key}-location`}
                      type="text"
                      value={unit.location}
                      onChange={(e) => patchUnit(unit.key, { location: e.target.value })}
                      placeholder={t("orders.reportForm.locationPlaceholder")}
                      className="w-full border-2 border-gray-300 p-2.5 rounded-xl text-sm font-bold text-gray-900 bg-gray-50 outline-none focus:border-blue-700"
                    />
                  </div>
                </div>

                {unit.productId ? (
                  <p className="text-[11px] font-bold text-green-700">{t("orders.reportForm.linkedUnit")}</p>
                ) : (
                  unit.label.trim() !== "" && (
                    <p className="text-[11px] font-bold text-blue-700">{t("orders.reportForm.newUnitSaved")}</p>
                  )
                )}
              </>
            )}

            {/* RESULTAT – enhetsstatus finnes bare når malen bruker enheter. */}
            {visibility.showUnitResult && (
              <fieldset>
                <legend className={statusLabel}>{t("orders.reportForm.unitResult")}</legend>
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
                    <span className="font-bold text-gray-900">{t("orders.reportForm.approved")}</span>
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
                    <span className="font-bold text-gray-900">{t("orders.reportForm.deviation")}</span>
                  </label>
                </div>
              </fieldset>
            )}

            {/* SJEKKPUNKTER */}
            {fields.length > 0 && (
              <div className="space-y-4 border-t-2 border-gray-100 pt-4">
                {requiresUnits && (
                  <h4 className={statusLabel}>{t("orders.reportForm.checkpoints")}</h4>
                )}
                {fields
                  .filter((field) => isFieldVisible(field, unit.answers))
                  .map((field) => (
                    <FieldInput
                      key={field.id}
                      field={field}
                      name={`answer__${unit.key}__${field.id}`}
                      commentName={`linecomment__${unit.key}__${field.id}`}
                      defaultValue={unit.answers[field.id]}
                      defaultComment={readLineComment(unit.answers, field.id)}
                      onNeedsComment={(needs) =>
                        setFieldNeedsComment(unit.key, field.id, needs)
                      }
                      onValueChange={(value) =>
                        patchUnit(unit.key, {
                          answers: { ...unit.answers, [field.id]: value },
                        })
                      }
                      workOrderId={workOrderId}
                    />
                  ))}
              </div>
            )}

            {(() => {
              if (!visibility.showFollowUpWarning) return null;
              const pending = followUps[unit.key] ?? [];
              if (pending.length === 0) return null;
              return (
                <div className="bg-amber-50 border-2 border-amber-300 text-amber-900 rounded-xl px-4 py-3 text-sm font-bold space-y-2">
                  <p>
                    ⚠️ {pending.length === 1
                      ? t("orders.reportForm.followUpOne")
                      : t("orders.reportForm.followUpMany", { count: pending.length })}
                    {unit.status === "GODKJENT" &&
                      t("orders.reportForm.followUpConfirm")}
                  </p>
                  {unit.status === "GODKJENT" && (
                    <button
                      type="button"
                      onClick={() => patchUnit(unit.key, { status: "AVVIK" })}
                      className="bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-black hover:bg-amber-700 transition"
                    >
                      {t("orders.reportForm.setDeviation")}
                    </button>
                  )}
                </div>
              );
            })()}

            {/* KOMMENTAR – per-enhet bare når malen bruker enheter. Generelle
                notater under dekker rapporter uten enheter. */}
            {visibility.showUnitComment && (
              <div>
                <label htmlFor={`${formId}-${unit.key}-comment`} className={statusLabel}>{t("orders.reportForm.unitComment")}</label>
                <MarkdownEditor
                  id={`${formId}-${unit.key}-comment`}
                  name={`comment__${unit.key}`}
                  defaultValue={unit.comment}
                  rows={2}
                  placeholder={t("orders.reportForm.unitCommentPlaceholder")}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* GENERELLE NOTATER */}
      <div>
        <label htmlFor={`${formId}-notes`} className="block text-sm font-black text-gray-900 mb-2 uppercase tracking-wider">
          {t("orders.reportForm.generalNotes")}
        </label>
        <MarkdownEditor
          id={`${formId}-notes`}
          name="notes"
          rows={4}
          defaultValue={seed?.notes ?? ""}
          placeholder={t("orders.reportForm.generalNotesPlaceholder")}
        />
      </div>

      {/* SIGNATURER */}
      <div className="border-t-2 border-b-2 border-gray-200 py-6 space-y-6">
        <div>
          <h2 className="text-lg font-black text-gray-900">{t("orders.reportForm.signatures")}</h2>
          <p className="text-[11px] text-gray-500">
            {t("orders.reportForm.signaturesHint")}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <SignaturePad
            name="technicianSignature"
            nameFieldName="technicianName"
            defaultName={seed?.technicianName ?? technicianName}
            label={t("orders.reportForm.technicianSignature")}
            helperText={t("orders.reportForm.technicianHelper")}
            existingUrl={seed?.technicianSignatureUrl}
            initialDataUrl={seed?.technicianSignatureUrl ?? undefined}
          />
          <SignaturePad
            name="customerSignature"
            nameFieldName="customerName"
            defaultName={seed?.customerName ?? undefined}
            label={t("orders.reportForm.customerSignature")}
            helperText={t("orders.reportForm.customerHelper")}
            existingUrl={seed?.customerSignatureUrl}
            initialDataUrl={seed?.customerSignatureUrl ?? undefined}
          />
        </div>
      </div>
      </div>

      {/* Sticky lagreknapp på mobil, så skjemaet kan fylles ut med én hånd. */}
      <div className="sticky bottom-0 z-20 -mx-4 border-t border-gray-200 bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <SubmitButton isEditing={isEditing} disabled={missingUnits} />
      </div>

      <ConfirmDialog
        open={reviewOpen}
        title={t("orders.reportForm.reviewTitle")}
        description={reviewDescription}
        confirmLabel={t("orders.reportForm.reviewConfirm")}
        cancelLabel={t("orders.reportForm.reviewCancel")}
        danger
        onCancel={() => setReviewOpen(false)}
        onConfirm={confirmSubmit}
      />

      <ConfirmDialog
        open={unitToRemove !== null}
        title={t("orders.reportForm.removeUnitTitle")}
        description={t("orders.reportForm.removeUnitConfirm")}
        confirmLabel={t("orders.reportForm.removeUnit")}
        danger
        onCancel={() => setUnitToRemove(null)}
        onConfirm={() => {
          if (unitToRemove) removeUnit(unitToRemove);
          setUnitToRemove(null);
        }}
      />
    </form>
  );
}
