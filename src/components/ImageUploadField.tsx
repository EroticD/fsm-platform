"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { uploadErrorMessage } from "@/lib/upload-error";
import { currentOfflineUserId } from "@/lib/offline/draft-outbox";
import {
  flushOfflineImages,
  listOfflineImages,
  offlineReportId,
  queueOfflineImage,
  removeOfflineImage,
} from "@/lib/offline/image-outbox";
import Icon from "@/components/icons";

/**
 * Bildefelt for rapport-skjemaet.
 *
 * Man kan velge flere bilder i én og samme opplasting. Hvert bilde lastes opp
 * til /api/upload med en gang det velges, og de ferdige fil-URLene sendes med
 * skjemaet i et skjult felt (som en JSON-liste). Da slipper server action-en å
 * håndtere filer, og rapporten lagrer bare små tekstverdier (URL-er).
 *
 * Uten nett – eller når opplastingen feiler med en nettverksfeil – havner
 * bildet i den lokale bildekøen (`@/lib/offline/image-outbox`) i stedet for
 * bare i React-state. Køen ligger i IndexedDB og overlever refresh, at OS-et
 * dreper PWA-en og nettleserkrasj. Ved mount leses køen inn igjen som
 * ventende miniatyrer, og ved `online` lastes den opp på nytt gjennom samme
 * `/api/upload`-vei som før. Først når serveren har svart med en URL, fjernes
 * bildet fra køen og feltet viser den ferdige URL-en.
 *
 * Eldre rapporter har én enkelt URL som ren tekst. Leserne godtar begge deler
 * (se src/lib/report-answers.ts).
 *
 * Viktig for kladdene: det skjulte feltet inneholder alltid de opplastede
 * URL-ene. Rapportskjemaet snapshooter hele FormData (se ReportForm), så
 * bildene følger med i både lokal og serverlagret kladd uten egne felter.
 */

type UploadStatus = "pending" | "queued" | "uploading" | "done" | "error";

type UploadItem = {
  id: string;
  name: string;
  /** Finnes bare for filer som ennå ikke er lastet opp eller køet. */
  file?: File;
  status: UploadStatus;
  url?: string;
  error?: string;
  /** Id i den lokale bildekøen når bildet venter på nett. */
  queuedId?: string;
  /** Objekt-URL til en miniatyr av et køet bilde. Frigis ved unmount. */
  previewUrl?: string;
};

/**
 * Rapportens identitet for bildekøen.
 *
 * `ReportForm` eier `templateId`, men `FieldInput` – som rendrer dette feltet –
 * får den ikke i dag. En liten context lar feltet bygge samme rapport-id som
 * oppryddingen etter innsending bruker, uten å endre felt-API-et eller
 * opplastingskallet.
 */
type ReportScope = { workOrderId: string; templateId: string };

const ReportScopeContext = createContext<ReportScope | null>(null);

export function ReportImageScope({
  workOrderId,
  templateId,
  children,
}: {
  workOrderId: string;
  templateId: string;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ workOrderId, templateId }),
    [workOrderId, templateId],
  );
  return (
    <ReportScopeContext.Provider value={value}>
      {children}
    </ReportScopeContext.Provider>
  );
}

/**
 * Feltets adresse i skjemaet: `answer__<unitKey>__<fieldId>` (se FieldInput).
 * Køen trenger enheten og feltet for å kunne vise bildene igjen i riktig
 * bildefelt etter en remount.
 */
function fieldAddress(name: string): { unitKey: string; fieldId: string } {
  const prefix = "answer__";
  const rest = name.startsWith(prefix) ? name.slice(prefix.length) : name;
  const separator = rest.indexOf("__");
  return separator === -1
    ? { unitKey: "", fieldId: rest }
    : { unitKey: rest.slice(0, separator), fieldId: rest.slice(separator + 2) };
}

/**
 * `fetch` avviser med TypeError når nettet svikter. En HTTP-feil (413, 415,
 * 500) er derimot et svar fra serveren og blir ikke bedre av å vente på nett.
 */
function isNetworkFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  return (
    Boolean(error) &&
    typeof error === "object" &&
    (error as { network?: unknown }).network === true
  );
}

/** Miniatyr for et køet bilde. Returnerer undefined uten objekt-URL-støtte. */
function createPreview(blob: Blob): string | undefined {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return undefined;
  }
  try {
    return URL.createObjectURL(blob);
  } catch {
    return undefined;
  }
}


/** Mobilbilder er store; 1600 px er rikelig for servicebilder. */
const MAX_IMAGE_DIMENSION = 1600;
const JPEG_QUALITY = 0.8;
/** Små filer komprimeres ikke – da er vinningen minimal. */
const COMPRESS_THRESHOLD = 600 * 1024;

function itemId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Krymper et bilde i nettleseren før opplasting. Feiler komprimeringen (f.eks.
 * for HEIC i en nettleser som ikke kan dekode det), sendes originalfilen.
 */
async function compressImage(file: File): Promise<File> {
  if (
    !file.type.startsWith("image/") ||
    file.type === "image/gif" ||
    file.type === "image/svg+xml" ||
    file.size < COMPRESS_THRESHOLD ||
    typeof createImageBitmap !== "function"
  ) {
    return file;
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(
      1,
      MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height),
    );
    // Allerede lite nok – unngå unødvendig omkoding.
    if (scale === 1 && file.size < 1.2 * 1024 * 1024) return file;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;

    // Hvit bakgrunn, slik at gjennomsiktige PNG-er ikke blir svarte i JPEG.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
    });
    if (!blob) return file;

    const name = `${file.name.replace(/\.[^.]+$/, "")}.jpg`;
    return new File([blob], name, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}

export default function ImageUploadField({
  name,
  label,
  required,
  initialUrls = [],
  workOrderId,
  onCountChange,
}: {
  name: string;
  label: string;
  required?: boolean;
  /** Bilder som allerede ligger på rapporten (ved redigering av en opplåst rapport). */
  initialUrls?: string[];
  /** Knytter bildene til oppdraget, slik at /uploads kan kreve riktig tilgang. */
  workOrderId?: string;
  /** Antall ferdig opplastede bilder, slik at stegstripen kan telle dem. */
  onCountChange?: (count: number) => void;
}) {
  const t = useTranslations("common");
  const scope = useContext(ReportScopeContext);
  const workOrder = workOrderId ?? scope?.workOrderId ?? "";
  // Rapporten er oppdrag+mal. `templateId` kommer fra ReportImageScope, slik
  // at oppryddingen etter innsending kan treffe nøyaktig samme kø.
  const reportId = workOrder
    ? offlineReportId(workOrder, scope?.templateId ?? "")
    : "";
  // Køen adresserer bildet med enhet og felt, ikke med det tilfeldige
  // useId-et som brukes for DOM-id-er.
  const { unitKey, fieldId: queueFieldId } = fieldAddress(name);
  const fieldRef = useRef({ unitKey, fieldId: queueFieldId });
  fieldRef.current = { unitKey, fieldId: queueFieldId };
  const userId = currentOfflineUserId();
  // Hver køede miniatyr er en objekt-URL som må frigis, ellers lekker
  // nettleseren minne til alle bildene feltet noen gang har vist.
  const previewsRef = useRef(new Set<string>());
  const mountedRef = useRef(true);
  const fieldId = useId();
  const cameraId = `${fieldId}-camera`;
  const galleryId = `${fieldId}-gallery`;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;

  const [items, setItems] = useState<UploadItem[]>(() =>
    initialUrls.filter(Boolean).map((url, index) => ({
      id: `initial-${index}-${url}`,
      name: url.split("/").pop() || url,
      status: "done" as const,
      url,
    })),
  );
  const [online, setOnline] = useState(true);
  const itemsRef = useRef(items);
  const wasOfflineRef = useRef(false);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Opplastingene kjøres sekvensielt. Mobilbilder er store, og flere samtidige
  // opplastinger gjør at trege mobilnett bruker unødvendig lang tid.
  const uploadChain = useRef<Promise<void>>(Promise.resolve());
  const lastIncomingKey = useRef(initialUrls.filter(Boolean).join("\u0000"));

  useEffect(() => {
    const update = () => {
      const next = navigator.onLine;
      setOnline(next);
      if (!next) wasOfflineRef.current = true;
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // En gjenopprettet kladd kan gi feltet nye URL-er etter at det er montert.
  // Da legger vi dem til uten å fjerne bilder brukeren nettopp har valgt.
  const incomingKey = initialUrls.filter(Boolean).join("\u0000");
  useEffect(() => {
    if (incomingKey === lastIncomingKey.current) return;
    lastIncomingKey.current = incomingKey;

    setItems((current) => {
      const known = new Set(
        current.flatMap((item) => (item.url ? [item.url] : [])),
      );
      const additions: UploadItem[] = initialUrls
        .filter((url) => url && !known.has(url))
        .map((url, index) => ({
          id: `incoming-${Date.now()}-${index}-${url}`,
          name: url.split("/").pop() || url,
          status: "done" as const,
          url,
        }));
      return additions.length > 0 ? [...current, ...additions] : current;
    });
  }, [incomingKey, initialUrls]);

  const uploadOne = async (file: File) => {
    const body = new FormData();
    body.append("file", file);
    if (workOrder) body.append("workOrderId", workOrder);
    const res = await fetch("/api/upload", { method: "POST", body });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.fileUrl) {
      throw new Error(
        uploadErrorMessage(
          res,
          json,
          t,
          t("orders.imageUpload.uploadFailedOne", { name: file.name }),
        ),
      );
    }
    return json.fileUrl as string;
  };

  const trackPreview = (blob: Blob): string | undefined => {
    const url = createPreview(blob);
    if (url) previewsRef.current.add(url);
    return url;
  };

  const uploadFailureMessage = (error: unknown, name: string): string =>
    error instanceof Error && error.message
      ? error.message
      : t("orders.imageUpload.uploadFailedOne", { name });

  /**
   * Legger filen i den lokale bildekøen i stedet for å holde den i React-state.
   *
   * Komprimeringen gjøres før lagring: den krever ikke nett, og en køet
   * mobilfil på flere megabyte er unødvendig stor å beholde på enheten.
   */
  const queueItem = async (item: UploadItem, fallbackName: string) => {
    if (!item.file) return;
    if (!reportId) {
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                status: "error",
                error: t("orders.imageUpload.uploadFailedOne", {
                  name: fallbackName,
                }),
              }
            : entry,
        ),
      );
      return;
    }

    let prepared: File = item.file;
    try {
      prepared = await compressImage(item.file);
    } catch {
      prepared = item.file;
    }

    try {
      const result = await queueOfflineImage({
        // Samme id som raden i feltet, slik at URL-en kan settes tilbake på
        // riktig rad når opplastingen lykkes.
        id: item.id,
        reportId,
        unitKey: fieldRef.current.unitKey,
        fieldId: fieldRef.current.fieldId,
        file: prepared,
        userId,
      });
      if (result !== "queued") {
        // IndexedDB er utilgjengelig (privat modus, gamle nettlesere). Da er
        // React-state det eneste vi har: behold filen som ventende, som før.
        setItems((current) =>
          current.map((entry) =>
            entry.id === item.id
              ? { ...entry, status: "pending", error: undefined }
              : entry,
          ),
        );
        return;
      }
      const previewUrl = trackPreview(prepared);
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                name: prepared.name || entry.name,
                status: "queued",
                queuedId: item.id,
                previewUrl,
                file: undefined,
                error: undefined,
              }
            : entry,
        ),
      );
    } catch (error) {
      // Full kvote eller annen IndexedDB-feil: da er bildet ikke sikret, og
      // montøren må se det i stedet for en falsk «lagret lokalt».
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                status: "error",
                error: uploadFailureMessage(error, fallbackName),
              }
            : entry,
        ),
      );
    }
  };

  /**
   * Tømmer køen for rapporten gjennom samme `/api/upload`-vei som vanlig
   * opplasting. Bilder serveren kvitterer for, fjernes fra køen og får URL-en
   * i feltet; resten blir liggende til neste forsøk.
   */
  const flushQueued = async () => {
    if (!reportId) return;
    let result;
    try {
      result = await flushOfflineImages(
        reportId,
        async (image) => {
          const file =
            typeof File === "function"
              ? new File([image.blob], image.name, { type: image.type })
              : (image.blob as File);
          return uploadOne(file);
        },
        // Bare dette feltets bilder: et skjema kan ha flere bildefelter.
        { userId, unitKey, fieldId: queueFieldId },
      );
    } catch {
      // Nettet forsvant under tømmingen. Postene ligger fortsatt i køen.
      return;
    }
    if (result.uploaded.length === 0) return;

    const urls = new Map(result.uploaded.map((entry) => [entry.id, entry.url]));
    setItems((current) =>
      current.map((entry) => {
        if (!entry.queuedId) return entry;
        const url = urls.get(entry.queuedId);
        if (!url) return entry;
        if (entry.previewUrl) {
          URL.revokeObjectURL(entry.previewUrl);
          previewsRef.current.delete(entry.previewUrl);
        }
        return {
          ...entry,
          status: "done" as const,
          url,
          queuedId: undefined,
          previewUrl: undefined,
          error: undefined,
        };
      }),
    );
  };

  /**
   * Leser køen ved mount. Det er dette som gjør at bildene overlever en
   * refresh eller at PWA-en ble drept av OS-et: de ligger i IndexedDB, ikke i
   * React-state, og vises som ventende miniatyrer i riktig felt.
   */
  const loadQueued = async () => {
    if (!reportId) return;
    const images = await listOfflineImages(reportId, {
      userId,
      unitKey,
      fieldId: queueFieldId,
    });
    if (!mountedRef.current) return;
    const known = new Set(
      itemsRef.current.flatMap((item) => (item.queuedId ? [item.queuedId] : [])),
    );
    const additions = images
      .filter((image) => !known.has(image.id))
      .map((image) => ({
        id: `queued-${image.id}`,
        name: image.name,
        status: "queued" as const,
        queuedId: image.id,
        previewUrl: trackPreview(image.blob),
      }));
    if (additions.length === 0) return;
    setItems((current) => {
      const already = new Set(
        current.flatMap((item) => (item.queuedId ? [item.queuedId] : [])),
      );
      const fresh = additions.filter(
        (item) => item.queuedId && !already.has(item.queuedId),
      );
      return fresh.length > 0 ? [...current, ...fresh] : current;
    });
  };

  const uploadItem = async (item: UploadItem) => {
    if (!item.file) return;

    // Offline skal ikke gi en rød feil: bildet sikres i den lokale køen og
    // lastes opp automatisk når nettleseren melder at nettet er tilbake.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      wasOfflineRef.current = true;
      await queueItem(item, item.name);
      return;
    }

    setItems((current) =>
      current.map((entry) =>
        entry.id === item.id
          ? { ...entry, status: "uploading", error: undefined }
          : entry,
      ),
    );

    try {
      const prepared = await compressImage(item.file);
      const url = await uploadOne(prepared);
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? { ...entry, status: "done", url, file: undefined, error: undefined }
            : entry,
        ),
      );
    } catch (error) {
      // Nettet kan forsvinne mellom offline-sjekken og svaret. Da er bildet
      // fortsatt bare i minnet, og skal sikres i køen i stedet for å bli en
      // rød feil montøren må håndtere.
      if (isNetworkFailure(error)) {
        wasOfflineRef.current = true;
        await queueItem(item, item.name);
        return;
      }
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                status: "error",
                error: uploadFailureMessage(error, item.name),
              }
            : entry,
        ),
      );
    }
  };

  const processItems = async (queue: UploadItem[]) => {
    for (const item of queue) {
      await uploadItem(item);
    }
  };

  const enqueue = (queue: UploadItem[]) => {
    if (queue.length === 0) return;
    setItems((current) => [...current, ...queue]);
    uploadChain.current = uploadChain.current.then(() => processItems(queue));
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // Tøm inputen med en gang, slik at man kan velge samme bilde på nytt senere.
    event.target.value = "";
    if (files.length === 0) return;

    enqueue(
      files.map((file) => ({
        id: itemId(),
        name: file.name,
        file,
        status: "pending" as const,
      })),
    );
  };

  const retry = (item: UploadItem) => {
    // Et køet bilde har ingen fil i minnet lenger – det ligger i IndexedDB og
    // lastes opp ved å tømme køen på nytt.
    if (item.queuedId) {
      uploadChain.current = uploadChain.current.then(async () => {
        await flushQueued();
      });
      return;
    }
    if (!item.file) return;
    uploadChain.current = uploadChain.current.then(() => uploadItem(item));
  };

  const retryAll = () => {
    const failed = items.filter(
      (item) =>
        (item.status === "error" || item.status === "pending") && item.file,
    );
    for (const item of failed) retry(item);
    if (items.some((item) => item.queuedId)) {
      uploadChain.current = uploadChain.current.then(async () => {
        await flushQueued();
      });
    }
  };

  // Når nettet kommer tilbake, tømmes bildekøen og filer som ventet i minnet
  // lastes opp. Montøren slipper å trykke «prøv igjen» for hver fil.
  const retryRef = useRef(retry);
  const flushRef = useRef(flushQueued);
  const loadRef = useRef(loadQueued);
  useEffect(() => {
    // Hold siste funksjoner tilgjengelig for effektene uten å registrere
    // nettleserlytteren på nytt for hver rendering.
    retryRef.current = retry;
    flushRef.current = flushQueued;
    loadRef.current = loadQueued;
  });
  useEffect(() => {
    if (!online) return;
    // Køen ligger i IndexedDB, ikke i denne komponenten. Derfor tømmes den
    // også på nytt når feltet er montert på nytt mens nettet er tilbake.
    uploadChain.current = uploadChain.current.then(async () => {
      await flushRef.current();
    });
    if (!wasOfflineRef.current) return;
    wasOfflineRef.current = false;
    const queue = itemsRef.current.filter(
      (item) =>
        (item.status === "error" || item.status === "pending") && item.file,
    );
    for (const item of queue) retryRef.current(item);
  }, [online]);

  // Køen overlever remount: les ventende bilder fra IndexedDB, vis dem som
  // miniatyrer, og tøm køen med en gang hvis vi allerede er online.
  useEffect(() => {
    if (!reportId) return;
    mountedRef.current = true;
    void (async () => {
      await loadRef.current();
      if (!mountedRef.current) return;
      uploadChain.current = uploadChain.current.then(async () => {
        await flushRef.current();
      });
    })();
  }, [reportId, unitKey, queueFieldId]);

  // Frigjør miniatyr-URL-ene når feltet forsvinner fra skjermen.
  useEffect(() => {
    const previews = previewsRef.current;
    return () => {
      mountedRef.current = false;
      for (const url of previews) URL.revokeObjectURL(url);
      previews.clear();
    };
  }, []);

  const removeItem = (id: string) => {
    const entry = itemsRef.current.find((item) => item.id === id);
    if (entry?.queuedId) {
      void removeOfflineImage(entry.queuedId).catch(() => {
        // IndexedDB er utilgjengelig. Raden forsvinner uansett fra feltet, og
        // køen ryddes når rapporten sendes inn.
      });
    }
    if (entry?.previewUrl) {
      URL.revokeObjectURL(entry.previewUrl);
      previewsRef.current.delete(entry.previewUrl);
    }
    setItems((current) => current.filter((item) => item.id !== id));
  };

  const doneUrls = items.flatMap((item) =>
    item.status === "done" && item.url ? [item.url] : [],
  );
  useEffect(() => {
    onCountChange?.(doneUrls.length);
  }, [doneUrls.length, onCountChange]);
  const failedCount = items.filter((item) => item.status === "error").length;
  const busy = items.some(
    (item) => item.status === "pending" || item.status === "uploading",
  );
  const statusText = (item: UploadItem) => {
    switch (item.status) {
      case "pending":
        return t("orders.imageUpload.pendingFile");
      case "queued":
        return t("orders.imageUpload.savedLocally");
      case "uploading":
        return t("orders.imageUpload.uploadingFile");
      case "error":
        // Selve feilårsaken vises under filnavnet, slik at montøren ser hva
        // som faktisk feilet og kan prøve den enkelte filen på nytt.
        return t("orders.imageUpload.failedShort");
      default:
        return "";
    }
  };
  const statusClass = (item: UploadItem) =>
    item.status === "error"
      ? "text-risk"
      : item.status === "done"
        ? "text-success"
        : item.status === "uploading"
          ? "text-success"
          : item.status === "queued"
            ? "text-signal"
            : "text-muted";

  return (
    <div className="field-card space-y-3 p-4">
      <p className="flex items-center gap-2 text-sm font-black text-paper">
        <Icon name="camera" className="h-4 w-4 shrink-0 text-signal" />
        {label}{" "}
        {required && doneUrls.length === 0 && (
          <span className="text-risk">*</span>
        )}
      </p>

      <div className="flex flex-wrap gap-2">
        <label
          htmlFor={cameraId}
          className="signal-button cursor-pointer gap-2 text-sm shadow-sm"
        >
          <Icon name="camera" className="h-4 w-4" />
          {t("orders.imageUpload.takePhoto")}
        </label>
        <input
          id={cameraId}
          type="file"
          accept="image/*"
          capture="environment"
          aria-describedby={hintId}
          onChange={handleInputChange}
          className="sr-only"
        />

        <label
          htmlFor={galleryId}
          className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-[var(--field-line)] bg-surface/5 px-4 text-sm font-bold text-paper shadow-sm transition hover:border-signal/60 hover:bg-surface/10"
        >
          <Icon name="image" className="h-4 w-4" />
          {t("orders.imageUpload.choosePhoto")}
        </label>
        <input
          id={galleryId}
          type="file"
          accept="image/*"
          multiple
          // Kamera og galleri er to veier til samme bildefelt. HTML `required`
          // på bare galleri ville blokkert innsending når montøren tok bildet
          // med kameraet. Serveren håndhever det påkrevde feltet i stedet.
          aria-required={required && doneUrls.length === 0}
          aria-describedby={`${hintId}${failedCount > 0 ? ` ${errorId}` : ""}`}
          aria-invalid={failedCount > 0 ? true : undefined}
          onChange={handleInputChange}
          className="sr-only"
        />
      </div>

      <p id={hintId} className="text-xs text-paper/70">
        {t("orders.imageUpload.hint")}
      </p>
      <p className="text-xs font-bold text-paper/90">
        {t("orders.imageUpload.networkRequired")}
      </p>

      {!online && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border border-signal/40 bg-signal/10 px-3 py-2 text-xs font-bold text-signal"
        >
          <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t("orders.imageUpload.offline")}
        </p>
      )}

      {items.length > 0 && (
        <div className="space-y-2">
          {doneUrls.length > 0 && (
            <p className="text-xs font-bold text-signal">
              {t("orders.imageUpload.uploaded", { count: doneUrls.length })}
            </p>
          )}

          <ul className="space-y-2">
            {items.map((item, index) => (
              <li
                key={item.id}
                className={`flex flex-col gap-2 rounded-xl border bg-paper p-2.5 text-ink sm:flex-row sm:items-center ${
                  item.status === "error"
                    ? "border-risk/30"
                    : "border-line"
                }`}
              >
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  {item.status === "queued" && item.previewUrl ? (
                    // Miniatyr fra den lokale køen: bildet er ennå ikke lastet
                    // opp, men montøren skal se hva som ligger og venter.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.previewUrl}
                      alt={t("orders.imageUpload.attachmentAlt", {
                        number: index + 1,
                      })}
                      className="h-12 w-12 shrink-0 rounded-lg border border-signal/40 object-cover"
                    />
                  ) : item.status === "done" && item.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.url}
                      alt={t("orders.imageUpload.attachmentAlt", {
                        number: index + 1,
                      })}
                      className="h-12 w-12 shrink-0 rounded-lg border border-line object-cover"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-surface/50"
                    >
                      <Icon
                        name={item.status === "error" ? "alert" : "camera"}
                        className={`h-5 w-5 ${
                          item.status === "error" ? "text-risk" : "text-muted"
                        }`}
                      />
                    </span>
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="break-words text-xs font-bold text-ink">
                      {item.name}
                    </p>
                    <p
                      className={`flex items-center gap-1.5 text-xs font-bold ${statusClass(item)}`}
                    >
                      {item.status === "done" && (
                        <Icon name="check" className="h-3.5 w-3.5" />
                      )}
                      {item.status === "uploading" && (
                        <Icon name="sync" className="h-3.5 w-3.5 animate-spin" />
                      )}
                      {(item.status === "pending" || item.status === "queued") && (
                        <Icon name="clock" className="h-3.5 w-3.5" />
                      )}
                      {item.status === "error" && (
                        <Icon name="alert" className="h-3.5 w-3.5" />
                      )}
                      {statusText(item)}
                      {item.status === "done" && (
                        <span className="sr-only">
                          {t("orders.imageUpload.uploaded", { count: 1 })}
                        </span>
                      )}
                    </p>
                    {item.status === "error" && item.error && (
                      <p className="mt-0.5 break-words text-2xs font-bold text-risk">
                        {item.error}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:shrink-0">
                  {item.status === "done" && item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-bold text-success underline"
                    >
                      <Icon name="image" className="h-3.5 w-3.5" />
                      {t("orders.imageUpload.viewImage")}
                    </a>
                  )}

                  {(item.status === "error" ||
                    item.status === "pending" ||
                    item.status === "queued") &&
                    (item.file || item.queuedId) && (
                      <button
                        type="button"
                        onClick={() => retry(item)}
                        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-signal/40 bg-signal/10 px-3 text-xs font-bold text-signal transition hover:bg-signal/15"
                      >
                        <Icon name="sync" className="h-3.5 w-3.5" />
                        {t("orders.imageUpload.retry")}
                      </button>
                    )}

                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    aria-label={t("orders.imageUpload.removeFile", {
                      name: item.name,
                    })}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-risk/30 bg-risk/10 px-2 text-sm font-bold text-risk transition hover:bg-risk/15"
                  >
                    <Icon name="close" className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {busy && (
            <p
              className="flex items-center gap-1.5 text-xs font-bold text-signal"
              aria-live="polite"
            >
              <Icon name="sync" className="h-3.5 w-3.5 animate-spin" />
              {t("orders.imageUpload.uploadingShort")}
            </p>
          )}

          {failedCount > 0 && (
            <div
              id={errorId}
              role="alert"
              className="flex flex-col gap-2 rounded-xl border border-risk/50 bg-risk/10 p-3 text-xs font-bold text-risk sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="flex min-w-0 items-start gap-1.5 break-words">
                <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t("orders.imageUpload.uploadFailedMany", {
                  count: failedCount,
                  names: items
                    .filter((item) => item.status === "error")
                    .map((item) => item.name)
                    .join(", "),
                })}
              </p>
              <button
                type="button"
                onClick={retryAll}
                className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-risk/50 bg-paper px-3 text-xs font-bold text-risk transition hover:bg-risk/15"
              >
                <Icon name="sync" className="h-3.5 w-3.5" />
                {t("orders.imageUpload.retryAll")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Verdien som sendes med skjemaet: en JSON-liste med URL-er. */}
      <input
        type="hidden"
        name={name}
        value={doneUrls.length > 0 ? JSON.stringify(doneUrls) : ""}
      />
    </div>
  );
}
