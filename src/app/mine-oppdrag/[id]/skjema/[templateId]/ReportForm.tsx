"use client";

import {
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
} from "react";
import { useFormStatus } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import FieldInput, { type TemplateField } from "./FieldInput";
import UnitCompletionHeader from "./UnitCompletionHeader";
import MarkdownEditor from "@/components/MarkdownEditor";
import SignaturePad from "@/components/SignaturePad";
import ErrorBanner from "@/components/ErrorBanner";
import ConfirmDialog from "@/components/ConfirmDialog";
import Icon from "@/components/icons";
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
  countDuplicateUnitProductIds,
  dedupeUnitProductIds,
  linkUnitToProduct,
  selectableCustomerUnits,
} from "./unit-selection";
import {
  completionUndoReducer,
  evaluateUnitCompletion,
  hasAnswer,
  isFieldVisible,
  undoUnitStatus,
  type UnitCompletionNotice,
  type UnitStatusUndo,
} from "./unit-completion";
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

    return {
      counter: startUnits.length,
      units: dedupeUnitProductIds(startUnits).units,
    };
  });

  const { units } = state;
  // En rapport skrevet før enhetsregelen kan ha samme registrerte enhet i
  // flere rader. Da er duplikatene alt ryddet i startstate-en, og montøren får
  // en tydelig melding om at raden må kobles på nytt.
  const [duplicateProductsCleared, setDuplicateProductsCleared] = useState(
    () => (requiresUnits ? countDuplicateUnitProductIds(seed?.units ?? []) : 0),
  );
  // Raden som sist prøvde å velge en enhet som alt er brukt. Vises som en
  // tilgjengelig feilmelding under riktig select.
  const [duplicateProductUnitKey, setDuplicateProductUnitKey] = useState<
    string | null
  >(null);
  const imageFields = fields.filter((field) => field.type === "IMAGE");

  // Bildeantallet oppdateres av bildefeltene etter hvert som opplastinger
  // fullføres. Nøkkelen er enhet + felt, slik at to enheter med samme mal
  // ikke overskriver hverandres telling.
  const [photoCounts, setPhotoCounts] = useState<Record<string, number>>(() => {
    const counts: Record<string, number> = {};
    for (const unit of state.units) {
      for (const field of imageFields) {
        counts[`${unit.key}:${field.id}`] = parseImageUrls(
          unit.answers[field.id],
        ).length;
      }
    }
    return counts;
  });
  const registerPhotoCount = useCallback((key: string, count: number) => {
    setPhotoCounts((current) =>
      current[key] === count ? current : { ...current, [key]: count },
    );
  }, []);
  const photoCount = units.reduce(
    (total, unit) =>
      total +
      imageFields.reduce(
        (unitTotal, field) =>
          unitTotal +
          (photoCounts[`${unit.key}:${field.id}`] ??
            parseImageUrls(unit.answers[field.id]).length),
        0,
      ),
    0,
  );

  // Signaturene er ukontrollerte bildefelt. Padene melder fra om de har en
  // signatur, slik at stegstripen og forhåndskontrollen viser faktisk status.
  const initialSeedSignatures = seed ?? initialSeed;
  const [signed, setSigned] = useState({
    technician: Boolean(initialSeedSignatures?.technicianSignatureUrl),
    customer: Boolean(initialSeedSignatures?.customerSignatureUrl),
  });
  const handleTechnicianSigned = useCallback((value: boolean) => {
    setSigned((current) =>
      current.technician === value
        ? current
        : { ...current, technician: value },
    );
  }, []);
  const handleCustomerSigned = useCallback((value: boolean) => {
    setSigned((current) =>
      current.customer === value ? current : { ...current, customer: value },
    );
  }, []);
  const signedCount = Number(signed.technician) + Number(signed.customer);

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
      // Den lokale kladden er skrevet selv om serveren ikke nås. Vis tiden
      // den ble lagret på, slik at montøren ser at endringen ikke er tapt.
      setDraftSavedAt(new Date());
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
        setDuplicateProductsCleared(restored.duplicateProductsCleared);
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
  // Mobil hurtigfullføring: inline forklaring per enhet og én angre-toast.
  const [completionNotices, setCompletionNotices] = useState<
    Record<string, UnitCompletionNotice>
  >({});
  const [undoState, dispatchUndo] = useReducer(completionUndoReducer, {
    undo: null,
  });
  const [announcement, setAnnouncement] = useState("");
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const clearUndoTimer = () => {
    if (undoTimer.current) {
      clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
  };

  const clearCompletionNotice = (key: string) => {
    setCompletionNotices((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  /**
   * Fullfører en enhet fra mobilhodet (sveip eller fallback-knapp).
   *
   * Samme kontroll som skjemaet ellers krever: alle synlige, påkrevde
   * sjekkpunkter må være besvart, og ingen synlig tilstand må kreve oppfølging.
   * En enhet med avvik overskrives aldri – der må radioknappen brukes.
   */
  const completeUnit = (unit: UnitEntry, unitNumber: number) => {
    const imageCounts: Record<string, number> = {};
    for (const field of fields) {
      if (field.type !== "IMAGE") continue;
      imageCounts[field.id] =
        photoCounts[`${unit.key}:${field.id}`] ??
        parseImageUrls(unit.answers[field.id]).length;
    }

    const check = evaluateUnitCompletion({ unit, fields, imageCounts });
    if (!check.ok) {
      if (check.blocker.kind === "status-approved") return;
      if (check.blocker.kind === "status-deviation") {
        setCompletionNotices((prev) => ({
          ...prev,
          [unit.key]: { kind: "deviation" },
        }));
        return;
      }

      const { missing, triggers } = check.blocker;
      const notice: UnitCompletionNotice =
        triggers.length > 0
          ? {
              kind: "trigger",
              field: triggers[0].label,
              value: triggers[0].value,
              missingCount: missing.length,
              missingFields: missing.map((entry) => entry.label),
            }
          : {
              kind: "missing",
              count: missing.length,
              fields: missing.map((entry) => entry.label),
            };
      setCompletionNotices((prev) => ({ ...prev, [unit.key]: notice }));
      return;
    }

    clearCompletionNotice(unit.key);
    const undo: UnitStatusUndo = {
      unitKey: unit.key,
      previousStatus: unit.status,
    };
    dispatchUndo({ type: "offer", undo });
    patchUnit(unit.key, { status: "GODKJENT" });
    setAnnouncement(t("orders.reportForm.undoAnnouncement", { number: unitNumber }));
    clearUndoTimer();
    undoTimer.current = setTimeout(() => {
      undoTimer.current = null;
      dispatchUndo({ type: "expire" });
    }, 3000);
  };

  /** Gjenoppretter nøyaktig statusen enheten hadde før hurtigfullføringen. */
  const undoCompletion = () => {
    const undo = undoState.undo;
    if (!undo) return;
    clearUndoTimer();
    setState((s) => ({ ...s, units: undoUnitStatus(s.units, undo) }));
    scheduleSave();
    dispatchUndo({ type: "clear" });
    setAnnouncement(t("orders.reportForm.undoDone"));
  };

  /** Vanlig radiovalg skal alltid vinne over en pågående angre-toast. */
  const changeUnitStatus = (key: string, status: UnitEntry["status"]) => {
    if (undoState.undo?.unitKey === key) {
      clearUndoTimer();
      dispatchUndo({ type: "clear" });
    }
    clearCompletionNotice(key);
    patchUnit(key, { status });
  };

  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );

  const addUnit = () => {
    setState((s) => ({ counter: s.counter + 1, units: [...s.units, makeUnit(`unit-${s.counter}`)] }));
    scheduleSave();
  };

  const removeUnit = (key: string) => {
    if (undoState.undo?.unitKey === key) {
      clearUndoTimer();
      dispatchUndo({ type: "clear" });
    }
    clearCompletionNotice(key);
    setState((s) => ({ ...s, units: s.units.filter((u) => u.key !== key) }));
    scheduleSave();
  };

  /**
   * Velger en registrert enhet fra kundekortet og fyller inn feltene.
   *
   * En registrert enhet skal bare brukes én gang i rapporten. Valget avvises
   * hvis en annen rad alt bruker den – også hvis to valg skulle komme i samme
   * render. Kontrollen kjøres derfor både mot fersk state og inne i updateren.
   */
  const linkRegisteredUnit = (key: string, productId: string) => {
    const found = customerUnits.find((u) => u.id === productId) ?? null;
    const linked = linkUnitToProduct(stateRef.current.units, key, found);
    if (linked.duplicate) {
      setDuplicateProductUnitKey(key);
      return;
    }

    setDuplicateProductUnitKey(null);
    if (!linked.changed) return;

    setState((s) => {
      const latest = linkUnitToProduct(s.units, key, found);
      // En samtidig endring kan ha tatt enheten mens denne raden ventet.
      // Da står begge radene urørt og enheten forblir unik.
      if (latest.duplicate || !latest.changed) return s;
      return { ...s, units: latest.units };
    });
    scheduleSave();
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
    const imageFieldIds = new Set(imageFields.map((field) => field.id));
    let photos = 0;
    for (const [key, value] of Object.entries(payload)) {
      // Bare bildefelt teller som foto. Signaturene ligger i egne felt.
      if (!key.startsWith("answer__")) continue;
      const fieldId = key.slice(key.lastIndexOf("__") + 2);
      if (imageFieldIds.has(fieldId)) photos += parseImageUrls(value).length;
    }

    setReviewSummary({
      units: units.length,
      deviations: units.filter((unit) => unit.status === "AVVIK").length,
      photos,
      // En opplåst rapport beholder en eksisterende signatur når feltet står
      // tomt ved innsending. Review må derfor regne den lagrede signaturen som
      // signert, mens en nytegnet signatur kommer fra skjemaet.
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
  // Hver rad får bare de registrerte enhetene som ikke er valgt i en annen rad.
  const selectableUnitsByKey = new Map(
    units.map((unit) => [
      unit.key,
      selectableCustomerUnits(customerUnits, units, unit.key),
    ]),
  );

  // Stegstripen viser hvor langt montøren er, uten å måtte lese hele skjemaet.
  const checkpointProgress = units.reduce(
    (progress, unit) => {
      for (const field of fields) {
        if (!isFieldVisible(field, unit.answers)) continue;
        progress.total += 1;
        const answered =
          field.type === "IMAGE"
            ? (photoCounts[`${unit.key}:${field.id}`] ??
                parseImageUrls(unit.answers[field.id]).length) > 0
            : hasAnswer(unit.answers[field.id]);
        if (answered) progress.answered += 1;
      }
      return progress;
    },
    { answered: 0, total: 0 },
  );
  const deviationCount = units.filter((unit) => unit.status === "AVVIK").length;
  const firstImageFieldId = imageFields[0]?.id;
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
  const draftTimeLabel =
    (draftStatus === "saved" || draftStatus === "offline") && draftSavedAt
      ? draftSavedAt.toLocaleTimeString(locale, {
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;
  const draftIcon =
    draftStatus === "error"
      ? "alert"
      : draftStatus === "saving" || draftStatus === "offline"
        ? "sync"
        : draftStatus === "saved"
          ? "check"
          : "clock";

  // Aktivt steg følger faktisk rulleposisjon. Bildesteget finnes bare når
  // malen har et bildefelt; ellers hopper det til sjekkpunktene.
  const [activeStep, setActiveStep] = useState<
    "sjekkpunkter" | "bilder" | "signer"
  >("sjekkpunkter");
  const hasPhotosSection = imageFields.length > 0;
  useEffect(() => {
    const ids = hasPhotosSection
      ? (["sjekkpunkter", "bilder", "signer"] as const)
      : (["sjekkpunkter", "signer"] as const);
    let frame = 0;

    const update = () => {
      frame = 0;
      // Den faste stegstripen dekker toppen av visningen. Et punkt regnes som
      // aktivt når overskriften har passert denne linjen. Terskelen ligger litt
      // under scroll-margin (160 px), slik at avrunding ikke holder steget igjen.
      const threshold = 200;
      let current: (typeof ids)[number] = "sjekkpunkter";
      for (const id of ids) {
        const section = document.getElementById(id);
        if (section && section.getBoundingClientRect().top <= threshold) {
          current = id;
        }
      }
      setActiveStep(current);
    };

    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [hasPhotosSection]);

  const stepItems = [
    {
      id: "sjekkpunkter" as const,
      href: "#sjekkpunkter",
      number: 1,
      label: t("orders.reportForm.stepCheckpoints"),
      icon: "check" as const,
      count: `${checkpointProgress.answered}/${checkpointProgress.total}`,
      countLabel: t("orders.reportForm.stepProgress", {
        answered: checkpointProgress.answered,
        total: checkpointProgress.total,
      }),
    },
    {
      id: "bilder" as const,
      href: photosHref,
      number: 2,
      label: t("orders.reportForm.stepPhotos"),
      icon: "camera" as const,
      count: `${photoCount}`,
      countLabel: t("orders.imageUpload.uploaded", { count: photoCount }),
    },
    {
      id: "signer" as const,
      href: "#signer",
      number: 3,
      label: t("orders.reportForm.stepSignatures"),
      icon: "pen" as const,
      count: `${signedCount}/2`,
      countLabel: t("orders.reportForm.stepSignatures"),
    },
  ];

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

      {/* Skjermlesere får beskjed om fullføring og angre uten at fokus flyttes. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {/* Fast 3-stegsstripe med levende telling, kladdestatus og tid. */}
      <nav
        aria-label={t("orders.reportForm.stepsLabel")}
        className="field-card sticky top-0 z-30 p-3 shadow-[0_18px_40px_rgba(0,0,0,0.35)] sm:top-2 sm:p-4"
      >
        <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
          {stepItems.map((step) => {
            const active = activeStep === step.id;
            return (
              <a
                key={step.id}
                href={step.href}
                aria-current={active ? "step" : undefined}
                className={`min-h-14 rounded-xl border p-2.5 transition sm:p-3 ${
                  active
                    ? "border-signal bg-signal text-ink shadow-sm"
                    : "border-[#2a3328] bg-field text-paper hover:border-signal/60 hover:bg-white/[0.08]"
                }`}
              >
                <span
                  className={`flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.14em] ${
                    active ? "text-ink/60" : "text-paper/55"
                  }`}
                >
                  <Icon name={step.icon} className="h-3.5 w-3.5 shrink-0" />
                  {t("orders.reportForm.stepNumber", {
                    number: step.number,
                  })}
                </span>
                <span className="mt-1 block text-[11px] font-black leading-tight sm:text-sm">
                  {step.label}
                </span>
                <span
                  title={step.countLabel}
                  aria-label={step.countLabel}
                  className={`mt-1 block text-[11px] font-black ${
                    active ? "text-ink/75" : "text-signal"
                  }`}
                >
                  {step.count}
                </span>
              </a>
            );
          })}
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[#2a3328] pt-2">
          <div className="min-w-0 flex-1">
            <p
              className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-bold text-paper/70"
              aria-live="polite"
            >
              <span className="inline-flex items-center gap-1.5">
                <Icon
                  name={draftIcon}
                  className={`h-3.5 w-3.5 ${
                    draftStatus === "error" ? "text-risk" : "text-signal"
                  }`}
                />
                {draftProgressLabel}
                {draftTimeLabel ? (
                  <span className="font-black text-paper/90">
                    · {draftTimeLabel}
                  </span>
                ) : null}
              </span>
              <span aria-hidden className="text-paper/30">
                ·
              </span>
              <span
                className={`inline-flex items-center gap-1.5 ${
                  deviationCount > 0 ? "text-risk" : "text-paper/55"
                }`}
              >
                <Icon name="alert" className="h-3.5 w-3.5" />
                {t("orders.reportForm.stepDeviations", {
                  count: deviationCount,
                })}
              </span>
            </p>
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
                className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10"
              >
                <div
                  className="h-full rounded-full bg-signal transition-[width]"
                  style={{
                    width: `${Math.round(
                      (checkpointProgress.answered /
                        checkpointProgress.total) *
                        100,
                    )}%`,
                  }}
                />
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => void saveDraftNow()}
            className="inline-flex min-h-12 shrink-0 items-center gap-1.5 rounded-xl border border-[#2a3328] bg-white/5 px-3 py-1.5 text-xs font-bold text-paper transition hover:border-signal/60 hover:bg-white/10"
          >
            <Icon name="sync" className="h-3.5 w-3.5" />
            {t("orders.reportForm.saveDraftNow")}
          </button>
        </div>
      </nav>

      {(initialDraft || localDraftRestored) && (
        <div className="bg-blue-50 border-2 border-blue-200 text-blue-900 rounded-xl px-4 py-3 text-sm font-medium">
          {t("orders.reportForm.draftRestored")}
        </div>
      )}

      {duplicateProductsCleared > 0 && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-2 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900"
        >
          <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t("orders.reportForm.duplicateProductsCleared", {
              count: duplicateProductsCleared,
            })}
          </span>
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
        className="scroll-mt-48 space-y-4 py-2"
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
              className="min-h-12 bg-signal text-ink px-4 py-2 rounded-xl text-sm font-black hover:brightness-95 transition shadow-sm whitespace-nowrap"
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
              <>
                {/* Mobil: sveip høyre eller bruk den vanlige knappen. Begge
                    går gjennom samme kontroll og gir samme angre. */}
                <UnitCompletionHeader
                  unitNumber={index + 1}
                  status={unit.status}
                  notice={completionNotices[unit.key]}
                  undoAvailable={undoState.undo?.unitKey === unit.key}
                  onComplete={() => completeUnit(unit, index + 1)}
                  onUndo={undoCompletion}
                  onRemove={() => setUnitToRemove(unit.key)}
                />
                <div className="hidden justify-between items-center gap-3 sm:flex">
                  <h3 className="font-black text-ink">{t("orders.reportForm.unitTitle", { number: index + 1 })}</h3>
                  <button
                    type="button"
                    onClick={() => setUnitToRemove(unit.key)}
                    className="inline-flex min-h-12 items-center text-[11px] font-bold text-risk bg-risk/10 hover:bg-risk/15 px-3 py-1.5 rounded-lg border border-risk/30 transition whitespace-nowrap"
                  >
                    {t("orders.reportForm.removeUnit")}
                  </button>
                </div>
              </>
            )}

            {/* Enhetsvalg og metadata ligger øverst i hver sjekkliste, slik
                at montøren vet hvilken enhet som kontrolleres før resultatet. */}
            {requiresUnits && (
              <details open className="group rounded-xl border border-line bg-white/40">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-bold text-gray-800 sm:hidden [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center gap-2">
                    <Icon name="wrench" className="h-4 w-4" />
                    {t("orders.reportForm.unitDetails")}
                  </span>
                  <span aria-hidden className="text-gray-500 group-open:hidden">
                    <Icon name="plus" className="h-4 w-4" />
                  </span>
                  <span aria-hidden className="hidden text-gray-500 group-open:inline">
                    <Icon name="close" className="h-4 w-4" />
                  </span>
                </summary>
                <div className="hidden space-y-3 border-t border-line p-3 group-open:block sm:block sm:border-0 sm:p-0">
                  {customerUnits.length > 0 && (
                    <div>
                      <label htmlFor={`${formId}-${unit.key}-product`} className={statusLabel}>{t("orders.reportForm.fromCustomerEquipment")}</label>
                      <select
                        id={`${formId}-${unit.key}-product`}
                        value={unit.productId}
                        onChange={(e) => linkRegisteredUnit(unit.key, e.target.value)}
                        aria-describedby={`${formId}-${unit.key}-product-hint${
                          duplicateProductUnitKey === unit.key
                            ? ` ${formId}-${unit.key}-product-error`
                            : ""
                        }`}
                        aria-invalid={
                          duplicateProductUnitKey === unit.key || undefined
                        }
                        className={`min-h-12 w-full rounded-xl border-2 p-2.5 text-base font-bold text-ink outline-none focus:border-success sm:text-sm ${
                          duplicateProductUnitKey === unit.key
                            ? "border-red-600 bg-red-50"
                            : "border-line bg-white"
                        }`}
                      >
                        <option value="">{t("orders.reportForm.newUnit")}</option>
                        {(selectableUnitsByKey.get(unit.key) ?? []).map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.model}
                            {u.serialNumber ? ` (SN: ${u.serialNumber})` : ""}
                            {u.location ? ` – ${u.location}` : ""}
                          </option>
                        ))}
                      </select>
                      <p
                        id={`${formId}-${unit.key}-product-hint`}
                        className="mt-1.5 text-[11px] font-medium text-gray-600"
                      >
                        {t("orders.reportForm.unitUniqueHint")}
                      </p>
                      {duplicateProductUnitKey === unit.key && (
                        <p
                          id={`${formId}-${unit.key}-product-error`}
                          role="alert"
                          className="mt-1.5 flex items-start gap-1.5 text-xs font-bold text-red-700"
                        >
                          <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>{t("orders.reportForm.unitAlreadyUsed")}</span>
                        </p>
                      )}
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
                        className="min-h-12 w-full border-2 border-line p-2.5 rounded-xl text-base sm:text-sm font-bold text-ink bg-white outline-none focus:border-success"
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
                        className="min-h-12 w-full border-2 border-line p-2.5 rounded-xl text-base sm:text-sm font-bold text-ink bg-white outline-none focus:border-success"
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
                        className="min-h-12 w-full border-2 border-line p-2.5 rounded-xl text-base sm:text-sm font-bold text-ink bg-white outline-none focus:border-success"
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
                      onChange={() => changeUnitStatus(unit.key, "GODKJENT")}
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
                      onChange={() => changeUnitStatus(unit.key, "AVVIK")}
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
                      onValueChange={(value) => {
                        // Et svar som retter opp en manglende verdi gjør den
                        // gamle forklaringen utdatert.
                        clearCompletionNotice(unit.key);
                        patchUnit(unit.key, {
                          answers: { ...unit.answers, [field.id]: value },
                        });
                      }}
                      onImageCountChange={(count) => {
                        clearCompletionNotice(unit.key);
                        registerPhotoCount(`${unit.key}:${field.id}`, count);
                      }}
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
                  <p className="flex items-start gap-2">
                    <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      {pending.length === 1
                        ? t("orders.reportForm.followUpOne")
                        : t("orders.reportForm.followUpMany", { count: pending.length })}
                      {unit.status === "GODKJENT" &&
                        t("orders.reportForm.followUpConfirm")}
                    </span>
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
        className="field-sheet scroll-mt-48 p-4 shadow-[0_18px_40px_rgba(0,0,0,0.18)] sm:p-5 space-y-6"
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
            onSignedChange={handleTechnicianSigned}
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
            onSignedChange={handleCustomerSigned}
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
