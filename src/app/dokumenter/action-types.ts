import type {
  DocumentBulkMutationResult,
  DocumentBulkResult,
} from "@/server/documents";

/** Konteksten alle skjemaer sender med, slik at feil ikke mister plasseringen. */
export type DocumentFormContext = {
  folderId: string | null;
  searchQuery: string;
  tagFilter: string;
  page: number;
  onlyFolder: boolean;
};

export type DocumentActionResult =
  | { ok: true }
  | { ok: false; reason: string };

export type DocumentBulkActionResult =
  | ({ ok: true } & DocumentBulkResult)
  | { ok: false; reason: string };

export type DocumentBulkMutationActionResult =
  | ({ ok: true } & DocumentBulkMutationResult)
  | { ok: false; reason: string };

export type DocumentDiscardUploadsResult =
  | { ok: true; deleted: number }
  | { ok: false; reason: string };
