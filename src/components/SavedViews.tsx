"use client";

/**
 * Lagrede visninger og listetastatur for oppdrags- og kundelisten.
 *
 * Listene styres av query-parametere (status, søk, side, avdeling …), men det
 * fantes ingen måte å lagre en kombinasjon på. Komponenten her holder seg til
 * localStorage: ingen server-handling, ingen brukerdata ut av nettleseren.
 *
 * Alt som kan leses eller skrives er trukket ut som rene funksjoner, slik at
 * lagringsfeil (privat modus, full disk, korrupt JSON) kan testes uten DOM.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Icon from "@/components/icons";

/** Flere enn åtte chips gjør filterraden uleselig på mobil. */
export const SAVED_VIEWS_LIMIT = 8;

/** Lengste navn som får plass i en chip uten å dytte ut filterraden. */
export const SAVED_VIEW_NAME_LIMIT = 40;

/** Samme fane lytter på denne; `storage`-eventet treffer bare andre faner. */
const CHANGE_EVENT = "fsm:saved-views-change";

export type SavedView = { navn: string; query: string };

export type SavedViewsLabels = {
  heading: string;
  save: string;
  nameLabel: string;
  namePlaceholder: string;
  cancel: string;
  nameRequired: string;
  /** Malfeil med `{name}` som byttes ut med visningens navn. */
  deleteView: string;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const EMPTY: SavedView[] = [];

/** Godtar både `?a=b` og `a=b`, og gir alltid en ledende `?` (eller tom). */
export function normalizeQuery(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("?") ? trimmed : `?${trimmed}`;
}

/**
 * Leser listen tolerant. Korrupt JSON, feil form eller delvise oppføringer
 * skal gi en tom liste, ikke en krasjende listeside.
 */
export function parseSavedViews(raw: string | null): SavedView[] {
  if (!raw) return EMPTY;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (!Array.isArray(parsed)) return EMPTY;

  const views: SavedView[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const { navn, query } = entry as { navn?: unknown; query?: unknown };
    if (typeof navn !== "string" || typeof query !== "string") continue;
    const name = navn.trim().slice(0, SAVED_VIEW_NAME_LIMIT);
    if (!name) continue;
    views.push({ navn: name, query: normalizeQuery(query) });
    if (views.length >= SAVED_VIEWS_LIMIT) break;
  }
  return views.length === 0 ? EMPTY : views;
}

/**
 * Nyeste først. Samme navn erstatter den gamle oppføringen, slik at en
 * oppdatert visning havner øverst i stedet for å ligge der dobbelt.
 */
export function addSavedView(
  views: SavedView[],
  navn: string,
  query: string,
): SavedView[] {
  const name = navn.trim().slice(0, SAVED_VIEW_NAME_LIMIT);
  if (!name) return views;

  const rest = views.filter(
    (view) => view.navn.toLowerCase() !== name.toLowerCase(),
  );
  return [{ navn: name, query: normalizeQuery(query) }, ...rest].slice(
    0,
    SAVED_VIEWS_LIMIT,
  );
}

export function removeSavedView(
  views: SavedView[],
  navn: string,
): SavedView[] {
  const remaining = views.filter((view) => view.navn !== navn);
  return remaining.length === views.length ? views : remaining;
}

export function readSavedViews(
  storage: StorageLike | null,
  storageKey: string,
): SavedView[] {
  if (!storage) return EMPTY;
  try {
    return parseSavedViews(storage.getItem(storageKey));
  } catch {
    return EMPTY;
  }
}

/** `false` betyr at nettleseren ikke ville lagre – kalleren skal ikke juble. */
export function writeSavedViews(
  storage: StorageLike | null,
  storageKey: string,
  views: SavedView[],
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(storageKey, JSON.stringify(views));
    return true;
  } catch {
    return false;
  }
}

/**
 * En lagret visning er et komplett utvalg. `side` følger med bare når den ble
 * lagret sammen med visningen; vi arver aldri siden brukeren står på nå, slik
 * at en lagret «forfalte»-visning alltid åpner der den ble laget.
 */
export function savedViewHref(pathname: string, savedQuery: string): string {
  const query = normalizeQuery(savedQuery);
  if (!query) return pathname;
  const params = new URLSearchParams(query.slice(1));
  const search = params.toString();
  return search ? `${pathname}?${search}` : pathname;
}

type SavedViewsState = { available: boolean; views: SavedView[] };

const UNAVAILABLE: SavedViewsState = { available: false, views: EMPTY };

/**
 * Liten localStorage-butikk med `useSyncExternalStore`. Server-render får
 * `UNAVAILABLE`, slik at markupen er tom før hydrering og først da fylles med
 * brukerens egne visninger.
 */
export function createSavedViewsStore(storageKey: string) {
  let available: boolean | null = null;
  let cachedRaw: string | null | undefined;
  let cached: SavedViewsState = UNAVAILABLE;

  function resolveStorage(): StorageLike | null {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  function probe(storage: StorageLike | null): boolean {
    if (!storage) return false;
    try {
      const probeKey = `${storageKey}:probe`;
      storage.setItem(probeKey, "1");
      storage.removeItem(probeKey);
      return true;
    } catch {
      return false;
    }
  }

  function getSnapshot(): SavedViewsState {
    if (available === null) available = probe(resolveStorage());

    const storage = resolveStorage();
    if (!available || !storage) {
      cached = UNAVAILABLE;
      return cached;
    }

    let raw: string | null = null;
    try {
      raw = storage.getItem(storageKey);
    } catch {
      // Privat modus kan nekte lesing etter at proben slapp gjennom.
      available = false;
      cached = UNAVAILABLE;
      return cached;
    }

    if (raw === cachedRaw) return cached;
    cachedRaw = raw;
    cached = { available: true, views: parseSavedViews(raw) };
    return cached;
  }

  function notify() {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return {
    subscribe(callback: () => void) {
      window.addEventListener("storage", callback);
      window.addEventListener(CHANGE_EVENT, callback);
      return () => {
        window.removeEventListener("storage", callback);
        window.removeEventListener(CHANGE_EVENT, callback);
      };
    },
    getSnapshot,
    getServerSnapshot: (): SavedViewsState => UNAVAILABLE,
    save(navn: string, query: string): boolean {
      const storage = resolveStorage();
      const current = getSnapshot();
      if (!current.available || !storage) return false;
      const next = addSavedView(current.views, navn, query);
      if (next === current.views) return false;
      if (!writeSavedViews(storage, storageKey, next)) {
        available = false;
        cached = UNAVAILABLE;
        notify();
        return false;
      }
      notify();
      return true;
    },
    remove(navn: string): void {
      const storage = resolveStorage();
      const current = getSnapshot();
      if (!current.available || !storage) return;
      const next = removeSavedView(current.views, navn);
      if (next === current.views) return;
      if (!writeSavedViews(storage, storageKey, next)) {
        available = false;
        cached = UNAVAILABLE;
      }
      notify();
    },
  };
}

/**
 * Chips for lagrede filterkombinasjoner, pluss et lite navnefelt.
 *
 * Rendres i filterraden på oppdrags- og kundelisten, med samme utseende som
 * sorteringsvalgene rundt seg.
 */
export default function SavedViews({
  storageKey,
  currentQuery,
  labels,
}: {
  storageKey: string;
  /** `window.location.search` for listen, med ledende `?` når den er satt. */
  currentQuery: string;
  labels: SavedViewsLabels;
}) {
  const pathname = usePathname() ?? "";
  const store = useMemo(
    () => createSavedViewsStore(storageKey),
    [storageKey],
  );
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  const [open, setOpen] = useState(false);
  const [navn, setNavn] = useState("");
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const inputId = `${baseId}-name`;

  // Feltet er montert først når brukeren har trykket «Lagre visning»; da skal
  // markøren stå der uten at vi bruker autoFocus (som er upålitelig i Safari).
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    setNavn("");
    setError(false);
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!navn.trim()) {
      setError(true);
      return;
    }
    if (!store.save(navn, currentQuery)) {
      setError(true);
      return;
    }
    close();
  }

  // Uten lagring (privat modus, blokkert tredjepartslagring) finnes det ingen
  // chips å vise, og en «Lagre»-knapp som aldri virker er verre enn ingen.
  if (!state.available) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span
        id={titleId}
        className="type-eyebrow text-[var(--muted,#62685f)]"
      >
        {labels.heading}
      </span>

      <ul
        aria-labelledby={titleId}
        className="flex flex-wrap items-center gap-2"
      >
        {state.views.map((view) => (
          <li key={view.navn}>
            <span className="type-ui inline-flex min-h-9 items-center rounded-full border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] text-[var(--ink,#101310)] transition hover:border-[var(--ink,#101310)]">
              <Link
                href={savedViewHref(pathname, view.query)}
                prefetch={false}
                className="max-w-[16rem] truncate py-1.5 pl-3 pr-1 font-medium"
              >
                {view.navn}
              </Link>
              <button
                type="button"
                onClick={() => store.remove(view.navn)}
                aria-label={labels.deleteView.replace("{name}", view.navn)}
                className="mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--muted,#62685f)] transition hover:bg-[var(--paper,#f2efe6)] hover:text-[var(--ink,#101310)]"
              >
                <Icon name="close" className="h-3.5 w-3.5" />
              </button>
            </span>
          </li>
        ))}
      </ul>

      {open ? (
        <form
          onSubmit={handleSubmit}
          className="flex flex-wrap items-center gap-2"
        >
          <label htmlFor={inputId} className="sr-only">
            {labels.nameLabel}
          </label>
          <input
            id={inputId}
            ref={inputRef}
            type="text"
            value={navn}
            maxLength={SAVED_VIEW_NAME_LIMIT}
            onChange={(event) => {
              setNavn(event.target.value);
              if (error) setError(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                close();
              }
            }}
            aria-invalid={error || undefined}
            aria-describedby={error ? `${baseId}-error` : undefined}
            placeholder={labels.namePlaceholder}
            className="min-h-9 w-[15rem] rounded-full border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-1.5 text-xs font-medium text-[var(--ink,#101310)] outline-none transition placeholder:text-[#6b6559] focus:border-[var(--ink,#101310)] focus:ring-2 focus:ring-[var(--signal,#d8ff3e)]"
          />
          <button
            type="submit"
            className="type-ui inline-flex min-h-9 items-center rounded-full border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] px-3 py-1.5 font-bold text-[var(--ink,#101310)]"
          >
            {labels.save}
          </button>
          <button
            type="button"
            onClick={close}
            className="type-ui inline-flex min-h-9 items-center rounded-full border border-transparent px-2 py-1.5 text-[var(--muted,#62685f)] hover:bg-[var(--paper,#f2efe6)] hover:text-[var(--ink,#101310)]"
          >
            {labels.cancel}
          </button>
          {error ? (
            <span
              id={`${baseId}-error`}
              role="alert"
              className="text-xs font-bold text-[var(--risk-text,#b42318)]"
            >
              {labels.nameRequired}
            </span>
          ) : null}
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="type-ui inline-flex min-h-9 items-center gap-1 rounded-full border border-dashed border-[var(--ink,#101310)] px-3 py-1.5 text-[var(--ink,#101310)] transition hover:bg-[var(--signal,#d8ff3e)]"
        >
          <Icon name="plus" className="h-3.5 w-3.5" />
          {labels.save}
        </button>
      )}
    </div>
  );
}

/**
 * Tastatur for listesøket: «/» fokuserer feltet, «Escape» slipper fokus uten
 * å tømme verdien. Lytteren ligger på `window` fordi listesidene er
 * serverkomponenter og ikke kan henge `onKeyDown` på selve feltet.
 *
 * Hurtigsøket i topplinjen bruker også «/». På listesidene skal tegnet gå til
 * listesøket, så vi lytter i fangstfasen og stopper hendelsen der når
 * snarveien faktisk gjelder. Ctrl/Cmd+K åpner fortsatt hurtigsøket, og
 * skjemafelt, modaler og sammensatte tegn går alltid klar.
 */
export function ListSearchShortcuts({
  selector = "[data-list-search]",
}: {
  selector?: string;
}) {
  useEffect(() => {
    function isTyping(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      return (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT"
      );
    }

    function isBlockingSurfaceOpen(): boolean {
      return Boolean(
        document.querySelector(
          '[aria-modal="true"], dialog[open], [role="dialog"]',
        ),
      );
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.isComposing) return;

      const input = document.querySelector<HTMLInputElement>(selector);
      if (!input) return;

      if (event.key === "Escape") {
        // Bare feltet selv, og aldri med mindre det faktisk har fokus. Da
        // beholder vi verdien og lar nettleserens egne Escape-håndteringer
        // (dialoger, menyer) være i fred.
        if (document.activeElement === input) {
          // Chromium tømmer `type="search"` på Escape. Her skal fokus bare
          // slippes, så standardhandlingen stoppes.
          event.preventDefault();
          input.blur();
        }
        return;
      }

      if (event.key !== "/") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target) || isBlockingSurfaceOpen()) return;

      event.preventDefault();
      event.stopPropagation();
      input.focus();
      input.select();
    }

    // Fangstfasen: hurtigsøket lytter i boblefasen og ville ellers åpnet
    // dialogen sin samtidig som vi flytter fokus til listesøket.
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [selector]);

  return null;
}
