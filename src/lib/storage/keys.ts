// i18n-ignore-file: tekniske nøkler, ikke UI-tekst.

/**
 * Lagringsnøkler er relative, bruker `/` og kan ikke peke utenfor roten.
 * Funksjonen er den ene porten alle drivere og tjenestelag bruker, slik at en
 * filsti fra en klient eller en gammel database rad aldri kan bli en vilkårlig
 * filakses.
 */
export function normaliseStorageKey(key: string): string {
  const raw = typeof key === "string" ? key : "";
  if (!raw) throw new Error("Tom lagringsnøkkel");
  if (raw.length > 1024) throw new Error("Lagringsnøkkelen er for lang");
  if (raw.includes("\\")) throw new Error("Lagringsnøkkelen inneholder backslash");
  if (raw.includes("\u0000")) throw new Error("Lagringsnøkkelen inneholder NUL");
  if (raw.startsWith("/")) throw new Error("Lagringsnøkkelen må være relativ");

  const segments = raw.split("/");
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") {
      throw new Error("Lagringsnøkkelen inneholder en utrygg stisegment");
    }
    if (segment.length > 255) {
      throw new Error("Lagringsnøkkelen har et for langt stisegment");
    }
  }
  return segments.join("/");
}

export function tryNormaliseStorageKey(key: string): string | null {
  try {
    return normaliseStorageKey(key);
  } catch {
    return null;
  }
}

/** Filnavnet en `/uploads/<navn>`-URL peker på, eller null. */
export function storedNameFromUploadUrl(url: string | null | undefined): string | null {
  const match = /^\/uploads\/([A-Za-z0-9._-]+)$/.exec((url ?? "").trim());
  return match ? match[1] : null;
}

/** Lagringsnøkkel for en `/uploads/<navn>`-URL. */
export function storageKeyFromUploadUrl(url: string | null | undefined): string | null {
  return storedNameFromUploadUrl(url);
}

/** Den eneste URL-formen appen lager for en rotnøkkel. */
export function uploadUrlForKey(key: string): string {
  const normalised = normaliseStorageKey(key);
  if (normalised.includes("/")) {
    throw new Error("Bare filer i opplastingsroten kan få en /uploads-URL");
  }
  return `/uploads/${normalised}`;
}

/** Sorteringsnøkkel for et prefiks. `a` og `a/b` skal begge matche `a`. */
export function matchesPrefix(key: string, prefix?: string): boolean {
  if (!prefix) return true;
  const normalised = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  return key === normalised || key.startsWith(`${normalised}/`);
}

/** Sant for interne staging-/overføringsnøkler som ikke skal serveres. */
export function isInternalStorageKey(key: string): boolean {
  const first = key.split("/")[0] ?? "";
  return first.startsWith(".");
}

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".json": "application/json",
};

/** Innholdstypen vi svarer med, ut fra filendelsen. */
export function contentTypeForKey(key: string): string {
  const lower = key.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const extension = dot === -1 ? "" : lower.slice(dot);
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}
