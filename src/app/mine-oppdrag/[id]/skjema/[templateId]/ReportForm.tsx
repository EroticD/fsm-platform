"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import FieldInput, { type TemplateField } from "./FieldInput";
import MarkdownEditor from "@/components/MarkdownEditor";
import SignaturePad from "@/components/SignaturePad";
import ErrorBanner from "@/components/ErrorBanner";
import ConfirmDialog from "@/components/ConfirmDialog";
import { parseImageUrls, readLineComment, REPORT_STATUS_UNASSESSED } from "@/lib/report-answers";
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
import { canSubmitReport, useOnlineStatus } from "./submit-connectivity";
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

/** Et sjekkpunkt teller som besvart når feltet har en faktisk verdi. */
function hasAnswer(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

/**
 * Lagre-knapp som viser at skjemaet sendes, og hindrer dobbeltklikk.
 *
 * Uten nett er knappen grå og deaktivert, og forklaringen ligger rett over den
 * (se `report-offline-notice`), slik at montøren ikke tror rapporten ble sendt.
 */
function SubmitButton({
  isEditing,
  disabled = false,
  offline = false,
  descriptionIds = [],
}: {
  isEditing: boolean;
  disabled?: boolean;
  offline?: boolean;
  /** Forklaringene som hører til den deaktiverte knappen. */
  descriptionIds?: string[];
}) {
  const { pending } = useFormStatus();
  const t = useTranslations("common");
  const describedBy =
    [offline ? "report-offline-notice" : null, ...descriptionIds]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <button
      type="submit"
      disabled={pending || disabled || offline}
      aria-disabled={pending || disabled || offline}
      aria-describedby={describedBy}
      className={`w-full transition disabled:opacity-80! disabled:cursor-not-allowed ${
        offline
          ? "flex min-h-14 items-center justify-center gap-2 rounded-xl bg-white/10 py-4 font-black text-paper/80 shadow-none"
          : "field-cta shadow-[0_16px_36px_rgba(217,255,67,0.18)]"
      }`}
    >
      {pending
        ? t("orders.reportForm.saving")
        : offline
          ? t("orders.reportForm.submitOffline")
          : isEditing
            ? t("orders.reportForm.saveChanges")
            : t("orders.reportForm.saveReport")}
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
  workOrderStatus,
  technicianName,
  defaultCustomerName,
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
  /** Oppdragets status, så fullføring bare tilbys på åpne oppdrag. */
  workOrderStatus?: string;
  technicianName?: string;
  /** Oppdragets kontaktperson – forhåndsutfyller kundens signaturnavn. */
  defaultCustomerName?: string;
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
  // Fullføring er standardvalget når oppdraget fortsatt er åpent. Valget
  // sendes først med ved en vellykket innsending til serveren.
  const [completeWorkOrder, setCompleteWorkOrder] = useState(true);
  const t = useTranslations("common");
  const locale = useLocale();
  const formId = useId();
  // Hydreringssikker nettstatus: antar online på serveren og oppdateres rett
  // etterpå i nettleseren. Endres automatisk når nettet forsvinner/kommer
  // tilbake, så innsendingen låses opp uten reload.
  const online = useOnlineStatus();

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

  // Samlet resultat er bare godkjent når hver enhet er eksplisitt godkjent.
  // Så lenge noen enhet er uvurdert, er resultatet nøytralt – ikke godkjent.
  const overallStatus =
    !requiresUnits || units.length === 0
      ? REPORT_STATUS_UNASSESSED
      : units.some((unit) => unit.status === "AVVIK")
        ? "AVVIK"
        : units.every((unit) => unit.status === "GODKJENT")
          ? "GODKJENT"
          : REPORT_STATUS_UNASSESSED;

  // En rapport med enheter kan ikke sendes uten minst én enhet. Serveren
  // avviser den også med `mangler-enhet`, men knappen skal aldri invitere til det.
  const missingUnits = requiresUnits && units.length === 0;

  // Hver enhet må være vurdert som Godkjent eller Avvik før innsending. En
  // uvurdert enhet skal aldri kunne bli en stille godkjenning.
  const missingAssessment =
    requiresUnits &&
    units.some(
      (unit) => unit.status !== "GODKJENT" && unit.status !== "AVVIK",
    );

  // Fullføring tilbys bare når oppdraget ikke allerede er avsluttet.
  const showCompleteWorkOrderOption =
    workOrderStatus !== "COMPLETED" && workOrderStatus !== "CANCELLED";

  const overallStatusClass =
    overallStatus === "AVVIK"
      ? "bg-risk/10 border-risk/40 text-risk"
      : overallStatus === "GODKJENT"
        ? "bg-signal/10 border-signal/40 text-signal"
        : "field-card text-paper/70";
  const overallStatusLabel =
    overallStatus === "AVVIK"
      ? t("orders.reportForm.overallDeviation")
      : overallStatus === "GODKJENT"
        ? t("orders.reportForm.overallApproved")
        : t("orders.reportForm.overallUnassessed");

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

  // Forsvinner nettet mens forhåndskontrollen står åpen, skal rapporten ikke
  // sendes. Vi lukker dialogen og skriver siste endring lokalt, slik at
  // montøren kan fortsette der han slapp når nettet er tilbake.
  useEffect(() => {
    const onOffline = () => {
      setReviewOpen(false);
      void writeLocalDraft();
    };
    window.addEventListener("offline", onOffline);
    return () => window.removeEventListener("offline", onOffline);
  }, [writeLocalDraft]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    // Innsending krever nett. Knappen er deaktivert, men Enter i et felt kan
    // fortsatt utløse submit i noen nettlesere.
    if (!online) {
      event.preventDefault();
      bypassReview.current = false;
      setReviewOpen(false);
      return;
    }
    if (bypassReview.current) {
      bypassReview.current = false;
      return;
    }
    event.preventDefault();
    if (missingUnits || missingAssessment) return;

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
    if (
      !canSubmitReport({ online, missingUnits, missingAssessment }) ||
      !formRef.current
    )
      return;
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

  // Stegstripen viser hvor langt montøren er, uten å måtte lese hele skjemaet.
  const checkpointProgress = units.reduce(
    (progress, unit) => {
      for (const field of fields) {
        if (!isFieldVisible(field, unit.answers)) continue;
        progress.total += 1;
        if (hasAnswer(unit.answers[field.id])) progress.answered += 1;
      }
      return progress;
    },
    { answered: 0, total: 0 },
  );
  const deviationCount = units.filter((unit) => unit.status === "AVVIK").length;
  const firstImageFieldId = fields.find((field) => field.type === "IMAGE")?.id;
  const photosHref = firstImageFieldId ? "#bilder" : "#sjekkpunkter";
  const draftProgressLabel =
    draftStatus === "saving"
      ? t("orders.reportForm.stepDraftSaving")
      : draftStatus === "error"
        ? t("orders.reportForm.stepDraftError")
        : draftStatus === "offline"
          ? t("orders.reportForm.stepDraftOffline")
          : draftStatus === "saved"
            ? t("orders.reportForm.stepDraftSaved")
            : t("orders.reportForm.stepDraftIdle");

  const submitErrorMessages: Record<string, string> = {
    "ugyldig-data": t("orders.reportForm.errorInvalidData"),
    "mangler-enhet": t("orders.reportForm.errorMissingUnit"),
    "mangler-vurdering": t("orders.reportForm.errorMissingAssessment"),
    signatur: t("orders.reportForm.errorSignature"),
    "ugyldig-signaturnavn": t("orders.reportForm.errorInvalidSignerName"),
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
      className="report-form space-y-5"
    >
      <input type="hidden" name="workOrderId" value={workOrderId} />
      <input type="hidden" name="templateId" value={templateId} />
      <input type="hidden" name="unitsJson" value={unitsJson} />
      <input type="hidden" name="status" value={overallStatus} />
      {showCompleteWorkOrderOption && (
        <input
          type="hidden"
          name="completeWorkOrder"
          value={completeWorkOrder ? "1" : "0"}
        />
      )}
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}

      <ErrorBanner message={submitErrorMessage} />

      {/* Status for autolagret kladd */}
      <section className="field-card p-4 shadow-[0_18px_40px_rgba(0,0,0,0.2)]">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-bold">
          <span
            className={`inline-flex items-center gap-2 ${
              draftStatus === "error"
                ? "text-risk"
                : draftStatus === "saving"
                  ? "text-signal"
                  : draftStatus === "offline"
                    ? "text-signal"
                    : "text-paper/70"
            }`}
          >
            <span
              aria-hidden
              className={`h-2 w-2 rounded-full ${
                draftStatus === "error"
                  ? "bg-risk"
                  : draftStatus === "saving"
                    ? "bg-signal"
                    : draftStatus === "offline"
                      ? "bg-signal"
                      : "bg-success"
              }`}
            />
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
            className="min-h-11 rounded-xl border border-[#2a3328] bg-white/5 px-3 py-1.5 text-xs font-bold text-paper transition hover:border-signal/60 hover:bg-white/10"
          >
            {t("orders.reportForm.saveDraftNow")}
          </button>
        </div>
      </section>

      {/* Tydelig 3-stegsstripe: sjekkpunkter, bilder og signering. */}
      <nav
        aria-label={t("orders.reportForm.stepsLabel")}
        className="field-card p-3 shadow-[0_18px_40px_rgba(0,0,0,0.2)] sm:p-4"
      >
        <div className="grid grid-cols-3 gap-2">
          <a
            href="#sjekkpunkter"
            className="rounded-xl border border-[#2a3328] bg-field p-3 transition hover:border-signal/60 hover:bg-white/[0.08]"
          >
            <span className="block text-[10px] font-black uppercase tracking-[0.16em] text-paper/55">
              {t("orders.reportForm.stepNumber", { number: 1 })}
            </span>
            <span className="mt-1 flex items-center gap-1.5 text-sm font-black text-paper">
              <span className="text-signal" aria-hidden>✓</span>
              <span className="truncate">{t("orders.reportForm.stepCheckpoints")}</span>
            </span>
          </a>
          <a
            href={photosHref}
            className="rounded-xl border border-[#2a3328] bg-field p-3 transition hover:border-signal/60 hover:bg-white/[0.08]"
          >
            <span className="block text-[10px] font-black uppercase tracking-[0.16em] text-paper/55">
              {t("orders.reportForm.stepNumber", { number: 2 })}
            </span>
            <span className="mt-1 flex items-center gap-1.5 text-sm font-black text-paper">
              <span aria-hidden>📷</span>
              <span className="truncate">{t("orders.reportForm.stepPhotos")}</span>
            </span>
          </a>
          <a
            href="#signer"
            className="rounded-xl border border-[#2a3328] bg-field p-3 transition hover:border-signal/60 hover:bg-white/[0.08]"
          >
            <span className="block text-[10px] font-black uppercase tracking-[0.16em] text-paper/55">
              {t("orders.reportForm.stepNumber", { number: 3 })}
            </span>
            <span className="mt-1 flex items-center gap-1.5 text-sm font-black text-paper">
              <span aria-hidden>✍️</span>
              <span className="truncate">{t("orders.reportForm.stepSignatures")}</span>
            </span>
          </a>
        </div>
        <div
          className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-paper/70"
          aria-live="polite"
        >
          <span>
            {t("orders.reportForm.stepProgress", {
              answered: checkpointProgress.answered,
              total: checkpointProgress.total,
            })}
          </span>
          {deviationCount > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="text-risk">
                {t("orders.reportForm.stepDeviations", {
                  count: deviationCount,
                })}
              </span>
            </>
          )}
          <span aria-hidden>·</span>
          <span
            className={
              draftStatus === "error"
                ? "text-risk"
                : draftStatus === "offline"
                  ? "text-signal"
                  : "text-paper/70"
            }
          >
            {draftProgressLabel}
          </span>
        </div>
        {checkpointProgress.total > 0 && (
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={checkpointProgress.total}
            aria-valuenow={checkpointProgress.answered}
            aria-label={t("orders.reportForm.stepProgress", {
              answered: checkpointProgress.answered,
              total: checkpointProgress.total,
            })}
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"
          >
            <div
              className="h-full rounded-full bg-signal transition-[width]"
              style={{
                width: `${Math.round(
                  (checkpointProgress.answered / checkpointProgress.total) * 100,
                )}%`,
              }}
            />
          </div>
        )}
      </nav>

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
        <div className={`p-4 rounded-2xl border-2 shadow-[0_18px_40px_rgba(0,0,0,0.16)] ${overallStatusClass}`}>
          <p className="text-[10px] font-black uppercase tracking-wider opacity-70 mb-1">{t("orders.reportForm.overallResult")}</p>
          <p className="font-black">
            {overallStatusLabel}
          </p>
          <p className="text-[11px] opacity-70 mt-1">{t("orders.reportForm.overallHint")}</p>
        </div>
      )}

      {/* ENHETER – eller sjekkpunkter for en rapport uten enheter */}
      <div
        id="sjekkpunkter"
        className="scroll-mt-24 space-y-4 py-2"
      >
        {requiresUnits ? (
          <div className="flex flex-wrap justify-between items-start gap-3">
            <div>
              <h2 className="text-lg font-black text-paper">{t("orders.reportForm.unitsTitle")}</h2>
              <p className="text-[11px] text-paper/70">{t("orders.reportForm.unitsHint")}</p>
            </div>
            <button
              type="button"
              onClick={addUnit}
              className="bg-signal text-ink px-4 py-2 rounded-xl text-sm font-black hover:brightness-95 transition shadow-sm whitespace-nowrap"
            >
              {t("orders.reportForm.addUnit")}
            </button>
          </div>
        ) : (
          <div>
            <h2 className="text-lg font-black text-paper">{t("orders.reportForm.checkpoints")}</h2>
            <p className="text-[11px] text-paper/70">{t("orders.reportForm.reportNoUnitsHint")}</p>
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

        {missingAssessment && (
          <p
            id="report-missing-assessment"
            role="alert"
            className="text-sm font-bold text-amber-900 bg-amber-50 border-2 border-amber-300 rounded-xl p-4"
          >
            {t("orders.reportForm.missingAssessment")}
          </p>
        )}

        {units.map((unit, index) => (
          <div
            key={unit.key}
            className="field-sheet p-4 shadow-[0_18px_40px_rgba(0,0,0,0.18)] sm:p-5 space-y-4"
          >
            {requiresUnits && (
              <div className="flex justify-between items-center gap-3">
                <h3 className="font-black text-ink">{t("orders.reportForm.unitTitle", { number: index + 1 })}</h3>
                <button
                  type="button"
                  onClick={() => setUnitToRemove(unit.key)}
                  className="text-[11px] font-bold text-risk bg-risk/10 hover:bg-risk/15 px-3 py-1.5 rounded-lg border border-risk/30 transition whitespace-nowrap"
                >
                  {t("orders.reportForm.removeUnit")}
                </button>
              </div>
            )}

            {/* RESULTAT – enhetsstatus finnes bare når malen bruker enheter. */}
            {visibility.showUnitResult && (
              <fieldset>
                <legend className={statusLabel}>{t("orders.reportForm.unitResult")}</legend>
                {unit.status === REPORT_STATUS_UNASSESSED && (
                  <p className="mb-3 text-xs font-bold text-amber-800">
                    {t("orders.reportForm.unassessed")}
                  </p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label
                    className={`flex items-center gap-3 p-4 border-2 rounded-xl cursor-pointer transition bg-white ${
                      unit.status === "GODKJENT" ? "border-green-600 bg-green-50" : "border-line hover:bg-success/10"
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
                    <span className="font-bold text-ink">{t("orders.reportForm.approved")}</span>
                  </label>

                  <label
                    className={`flex items-center gap-3 p-4 border-2 rounded-xl cursor-pointer transition bg-white ${
                      unit.status === "AVVIK" ? "border-red-600 bg-red-50" : "border-line hover:bg-risk/10"
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
                    <span className="font-bold text-ink">{t("orders.reportForm.deviation")}</span>
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
                      anchorId={
                        field.type === "IMAGE" && field.id === firstImageFieldId
                          ? "bilder"
                          : undefined
                      }
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
                      className="signal-button text-xs"
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

            {/* Enhetsmetadata er sjelden i felt. På mobil ligger den derfor
                sammenklappet under sjekkpunktene, mens den er synlig på desktop. */}
            {requiresUnits && (
              <details className="group rounded-xl border border-line bg-white/40">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-bold text-gray-800 sm:hidden [&::-webkit-details-marker]:hidden">
                  <span>🔧 {t("orders.reportForm.unitDetails")}</span>
                  <span aria-hidden className="text-xs text-gray-500 group-open:hidden">＋</span>
                  <span aria-hidden className="hidden text-xs text-gray-500 group-open:inline">−</span>
                </summary>
                <div className="hidden space-y-3 border-t border-line p-3 group-open:block sm:block sm:border-0 sm:p-0">
                  {customerUnits.length > 0 && (
                    <div>
                      <label htmlFor={`${formId}-${unit.key}-product`} className={statusLabel}>{t("orders.reportForm.fromCustomerEquipment")}</label>
                      <select
                        id={`${formId}-${unit.key}-product`}
                        value={unit.productId}
                        onChange={(e) => linkRegisteredUnit(unit.key, e.target.value)}
                        className="w-full border-2 border-line p-2.5 rounded-xl text-base sm:text-sm font-bold text-ink bg-white outline-none focus:border-success"
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
                        onInvalid={(e) => {
                          // Åpne enhetsdetaljene når et påkrevd felt skjuler seg
                          // bak den sammenklappede seksjonen på mobil.
                          const details =
                            e.currentTarget.closest<HTMLDetailsElement>("details");
                          if (details) details.open = true;
                        }}
                        placeholder={t("orders.reportForm.labelPlaceholder")}
                        className="w-full border-2 border-line p-2.5 rounded-xl text-base sm:text-sm font-bold text-ink bg-white outline-none focus:border-success"
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
                        className="w-full border-2 border-line p-2.5 rounded-xl text-base sm:text-sm font-bold text-ink bg-white outline-none focus:border-success"
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
                        className="w-full border-2 border-line p-2.5 rounded-xl text-base sm:text-sm font-bold text-ink bg-white outline-none focus:border-success"
                      />
                    </div>
                  </div>

                  {unit.productId ? (
                    <p className="text-[11px] font-bold text-green-700">{t("orders.reportForm.linkedUnit")}</p>
                  ) : (
                    unit.label.trim() !== "" && (
                      <p className="text-[11px] font-bold text-success">{t("orders.reportForm.newUnitSaved")}</p>
                    )
                  )}
                </div>
              </details>
            )}
          </div>
        ))}
      </div>

      {/* GENERELLE NOTATER */}
      <div className="field-sheet p-4 shadow-[0_18px_40px_rgba(0,0,0,0.18)] sm:p-5">
        <label htmlFor={`${formId}-notes`} className="block text-sm font-black text-ink mb-2 uppercase tracking-wider">
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
      <div
        id="signer"
        className="field-sheet scroll-mt-24 p-4 shadow-[0_18px_40px_rgba(0,0,0,0.18)] sm:p-5 space-y-6"
      >
        <div>
          <h2 className="text-lg font-black text-ink">{t("orders.reportForm.signatures")}</h2>
          <p className="text-[11px] text-muted">
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
            defaultName={
              seed?.customerName?.trim() ? seed.customerName : defaultCustomerName
            }
            label={t("orders.reportForm.customerSignature")}
            helperText={t("orders.reportForm.customerHelper")}
            existingUrl={seed?.customerSignatureUrl}
            initialDataUrl={seed?.customerSignatureUrl ?? undefined}
          />
        </div>
      </div>
      </div>

      {/* Sticky lagreknapp på mobil, så skjemaet kan fylles ut med én hånd.
          CSS-en skjuler den mens et felt har fokus, se globals.css. */}
      <div className="report-sticky-submit sticky bottom-0 z-20 -mx-4 border-t border-[#2a3328] bg-field/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        {!online && (
          <p
            id="report-offline-notice"
            role="status"
            aria-live="polite"
            className="mb-2 rounded-xl border border-signal/40 bg-signal/10 px-3 py-2 text-sm font-bold text-signal"
          >
            {t("orders.reportForm.offlineNotice")}
          </p>
        )}
        <SubmitButton
          isEditing={isEditing}
          disabled={missingUnits || missingAssessment}
          offline={!online}
          descriptionIds={[
            missingUnits ? "report-no-units-error" : "",
            missingAssessment ? "report-missing-assessment" : "",
          ]}
        />
      </div>

      <ConfirmDialog
        open={reviewOpen && online}
        title={t("orders.reportForm.reviewTitle")}
        description={reviewDescription}
        confirmLabel={t("orders.reportForm.reviewConfirm")}
        cancelLabel={t("orders.reportForm.reviewCancel")}
        danger
        onCancel={() => setReviewOpen(false)}
        onConfirm={confirmSubmit}
      >
        {showCompleteWorkOrderOption && (
          <label className="flex items-start gap-3 rounded-xl border-2 border-line bg-white/50 p-3 text-sm text-ink">
            <input
              type="checkbox"
              checked={completeWorkOrder}
              onChange={(event) => setCompleteWorkOrder(event.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-blue-700"
            />
            <span>
              <span className="block font-bold">
                {t("orders.reportForm.completeWorkOrder")}
              </span>
              <span className="block text-xs text-gray-600">
                {t("orders.reportForm.completeWorkOrderHint")}
              </span>
            </span>
          </label>
        )}
      </ConfirmDialog>

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
