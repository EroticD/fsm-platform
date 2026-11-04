"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Icon from "@/components/icons";
import { controlClassName } from "@/components/ui/controlStyles";

type CustomerOption = {
  id: string;
  name: string;
  customerNumber: string | null;
  orgNumber: string | null;
};

type Issue = {
  code: string;
  path: string;
  messageKey: string;
  detail?: string;
};

type Preview = {
  jobId: string;
  package: {
    schemaVersion: string;
    sourceInstanceId: string;
    checksum: string;
    exportedAt: string;
    appVersion: string;
  };
  customers: Array<{
    sourceId: string;
    match: string;
    action: string;
    targetId?: string;
  }>;
  entities: Array<{
    type: string;
    sourceId: string;
    action: string;
    targetId?: string;
    reason?: string;
  }>;
  counts: Record<string, number>;
  warnings: Issue[];
  errors: Issue[];
  canImport: boolean;
  previewToken?: string;
  expiresAt?: string;
};

type Job = {
  id: string;
  status: string;
  counts?: Record<string, number> | null;
  checksumPrefix?: string | null;
  expiresAt?: string | null;
  downloadUrl?: string;
  fileName?: string;
  reused?: boolean;
};

type TransferUiError = {
  code: string;
  messageKey: string;
  retryAfterSeconds?: number;
};

type ErrorBody = {
  error?: unknown;
  messageKey?: unknown;
  retryAfterSeconds?: unknown;
};

const FALLBACK_ERROR = "errors.customerTransfer.importFailed";
const EXPORT_FALLBACK_ERROR = "errors.customerTransfer.exportFailed";

const FIELD = controlClassName("min-h-11 text-sm font-medium");
const PRIMARY =
  "signal-button inline-flex min-h-11 items-center justify-center gap-2 text-xs shadow-[2px_2px_0_var(--ink,#101310)] hover:shadow-[1px_1px_0_var(--ink,#101310)] disabled:opacity-50";
const SECONDARY =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] border border-[var(--ink,#101310)] px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)] disabled:opacity-50";

const POLICY_KEYS = [
  "customer",
  "contact",
  "site",
  "equipment",
  "contract",
  "workOrder",
  "report",
  "document",
  "upload",
  "maintenancePlan",
  "meterReading",
  "category",
  "folder",
] as const;

type PolicyKey = (typeof POLICY_KEYS)[number];

const DEFAULT_POLICIES: Record<PolicyKey, string> = {
  customer: "skip",
  contact: "skip",
  site: "skip",
  equipment: "skip",
  contract: "skip",
  workOrder: "skip",
  report: "skip",
  document: "skip",
  upload: "skip",
  maintenancePlan: "skip",
  meterReading: "skip",
  category: "skip",
  folder: "skip",
};

const UPDATE_ALLOWED = new Set<PolicyKey>(["customer", "equipment"]);

async function readTransferError(
  response: Response,
  fallbackMessageKey: string,
): Promise<TransferUiError> {
  let body: ErrorBody = {};
  try {
    body = (await response.json()) as ErrorBody;
  } catch {
    // Ikke-JSON-svar (proxy, 502 osv.) faller tilbake til en stabil kode.
  }
  const headerRetry = Number(response.headers.get("Retry-After"));
  const bodyRetry =
    typeof body.retryAfterSeconds === "number" &&
    Number.isFinite(body.retryAfterSeconds)
      ? body.retryAfterSeconds
      : undefined;
  const retryAfterSeconds =
    bodyRetry ?? (Number.isFinite(headerRetry) && headerRetry > 0 ? headerRetry : undefined);
  return {
    code: typeof body.error === "string" ? body.error : "http_error",
    messageKey:
      typeof body.messageKey === "string" ? body.messageKey : fallbackMessageKey,
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  };
}

function groupActions(entities: Preview["entities"]) {
  const groups = new Map<string, Record<string, number>>();
  for (const entity of entities) {
    const row = groups.get(entity.type) ?? {};
    row[entity.action] = (row[entity.action] ?? 0) + 1;
    groups.set(entity.type, row);
  }
  return [...groups.entries()].sort((left, right) =>
    left[0] < right[0] ? -1 : 1,
  );
}

export default function CustomerTransferTab({
  customers,
}: {
  customers: CustomerOption[];
}) {
  const t = useTranslations("common");
  const fileRef = useRef<HTMLInputElement>(null);
  const exportingRef = useRef(false);

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exportOptions, setExportOptions] = useState({
    includeFiles: true,
    includeDeleted: false,
    includeLegalHold: false,
    includeAudit: true,
    includeSignatures: false,
  });
  const [piiConfirmed, setPiiConfirmed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportJob, setExportJob] = useState<Job | null>(null);
  const [exportError, setExportError] = useState<TransferUiError | null>(null);

  const [importing, setImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importJob, setImportJob] = useState<Job | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<TransferUiError | null>(null);
  const [importError, setImportError] = useState<TransferUiError | null>(null);
  const [importResult, setImportResult] = useState<Record<string, number> | null>(
    null,
  );
  const [policies, setPolicies] =
    useState<Record<PolicyKey, string>>(DEFAULT_POLICIES);
  const [createMissingReferences, setCreateMissingReferences] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const filteredCustomers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return customers.slice(0, 50);
    return customers
      .filter(
        (customer) =>
          customer.name.toLowerCase().includes(query) ||
          (customer.customerNumber ?? "").toLowerCase().includes(query) ||
          (customer.orgNumber ?? "").toLowerCase().includes(query),
      )
      .slice(0, 50);
  }, [customers, search]);

  const actionGroups = preview ? groupActions(preview.entities) : [];

  function toggleCustomer(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function startExport() {
    if (exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true);
    setExportError(null);
    setExportJob(null);
    try {
      const response = await fetch("/api/innstillinger/kunder/eksport", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerIds: [...selected],
          ...exportOptions,
        }),
      });
      if (!response.ok) {
        setExportError(
          await readTransferError(response, EXPORT_FALLBACK_ERROR),
        );
        return;
      }
      setExportJob((await response.json()) as Job);
    } catch {
      setExportError({
        code: "network_error",
        messageKey: EXPORT_FALLBACK_ERROR,
      });
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }

  async function uploadImport(file: File) {
    setImporting(true);
    setImportError(null);
    setPreviewError(null);
    setPreview(null);
    setImportResult(null);
    setImportJob(null);
    try {
      const response = await fetch(
        `/api/innstillinger/kunder/import?filename=${encodeURIComponent(file.name)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/zip" },
          body: file,
        },
      );
      if (!response.ok) {
        setImportError(await readTransferError(response, FALLBACK_ERROR));
        return;
      }
      const job = (await response.json()) as Job;
      setImportJob(job);
      await runDryRun(job.id);
    } catch {
      setImportError({ code: "network_error", messageKey: FALLBACK_ERROR });
    } finally {
      setImporting(false);
    }
  }

  async function runDryRun(jobId: string) {
    return runDryRunWith(jobId, createMissingReferences);
  }

  async function runDryRunWith(jobId: string, missingReferences: boolean) {
    setPreviewError(null);
    try {
      const response = await fetch(
        `/api/innstillinger/kunder/import/${jobId}/dry-run`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ createMissingReferences: missingReferences }),
        },
      );
      if (!response.ok) {
        setPreviewError(await readTransferError(response, FALLBACK_ERROR));
        return;
      }
      const data = (await response.json()) as Preview;
      setPreview(data);
      setImportJob((current) => (current ? { ...current, status: "DRY_RUN" } : current));
    } catch {
      setPreviewError({ code: "network_error", messageKey: FALLBACK_ERROR });
    }
  }

  async function confirmImport() {
    if (!preview?.previewToken || !importJob) return;
    setImporting(true);
    setImportError(null);
    try {
      const response = await fetch(
        `/api/innstillinger/kunder/import/${importJob.id}/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            previewToken: preview.previewToken,
            policies,
            createMissingReferences,
            confirmation: true,
          }),
        },
      );
      if (!response.ok) {
        setImportError(await readTransferError(response, FALLBACK_ERROR));
        return;
      }
      const data = (await response.json()) as { counts: Record<string, number> };
      setImportResult(data.counts);
      setPreview(null);
    } catch {
      setImportError({ code: "network_error", messageKey: FALLBACK_ERROR });
    } finally {
      setImporting(false);
    }
  }

  async function abortImport() {
    if (!importJob) return;
    await fetch(`/api/innstillinger/kunder/import/${importJob.id}/abort`, {
      method: "POST",
    }).catch(() => undefined);
    setImportJob(null);
    setPreview(null);
  }

  function resetImport() {
    setImportFile(null);
    setImportJob(null);
    setPreview(null);
    setPreviewError(null);
    setImportError(null);
    setImportResult(null);
    setConfirmed(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  function issueText(issue: Issue): string {
    try {
      return t(issue.messageKey);
    } catch {
      return issue.code;
    }
  }

  function transferErrorText(error: TransferUiError): string {
    if (error.code === "customer_transfer.rate_limited") {
      const minutes = Math.max(
        1,
        Math.ceil((error.retryAfterSeconds ?? 60 * 60) / 60),
      );
      return t("errors.customerTransfer.rateLimitedRetry", { minutes });
    }
    try {
      return t(error.messageKey);
    } catch {
      return error.code;
    }
  }

  function renderTransferError(error: TransferUiError) {
    return (
      <div role="alert" className="space-y-1 text-sm font-bold text-red-700">
        <p>{transferErrorText(error)}</p>
        <p className="font-mono text-xs font-normal" data-error-code={error.code}>
          {error.code}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="office-card space-y-4 p-5 sm:p-6">
        <div className="flex items-center gap-2 border-b border-[var(--line,#dedcd1)] pb-3">
          <Icon name="folder" className="h-4 w-4 shrink-0" />
          <h2 className="text-base font-extrabold">{t("settings.customerTransfer.title")}</h2>
        </div>
        <p className="text-sm text-[var(--muted,#62685f)]">
          {t("settings.customerTransfer.description")}
        </p>
        <div className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3 text-xs sm:p-4">
          <p className="font-bold">{t("settings.customerTransfer.warningTitle")}</p>
          <p className="mt-1 text-[var(--muted,#62685f)]">
            {t("settings.customerTransfer.warningText")}
          </p>
        </div>
      </section>

      <section className="office-card space-y-4 p-5 sm:p-6" aria-labelledby="ct-export-title">
        <h2 id="ct-export-title" className="text-base font-extrabold">
          {t("settings.customerTransfer.export.title")}
        </h2>
        <p className="text-sm text-[var(--muted,#62685f)]">
          {t("settings.customerTransfer.export.description")}
        </p>

        <label className="flex flex-col gap-1 text-xs font-bold">
          {t("settings.customerTransfer.export.searchLabel")}
          <input
            type="search"
            className={FIELD}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("settings.customerTransfer.export.searchPlaceholder")}
          />
        </label>

        <fieldset className="max-h-64 overflow-auto rounded-xl border border-[var(--line,#dedcd1)] p-3">
          <legend className="px-1 text-xs font-bold">
            {t("settings.customerTransfer.export.selectedCount", { count: selected.size })}
          </legend>
          {filteredCustomers.length === 0 ? (
            <p className="p-2 text-sm text-[var(--muted,#62685f)]">
              {t("settings.customerTransfer.export.noCustomers")}
            </p>
          ) : (
            <ul className="space-y-1">
              {filteredCustomers.map((customer) => (
                <li key={customer.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--paper,#f2efe6)]">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={selected.has(customer.id)}
                      onChange={() => toggleCustomer(customer.id)}
                    />
                    <span className="font-medium">{customer.name}</span>
                    <span className="text-xs text-[var(--muted,#62685f)]">
                      {customer.customerNumber ?? customer.orgNumber ?? ""}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["includeFiles", "includeFiles"],
              ["includeAudit", "includeAudit"],
              ["includeDeleted", "includeDeleted"],
              ["includeLegalHold", "includeLegalHold"],
              ["includeSignatures", "includeSignatures"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={exportOptions[key]}
                onChange={(event) =>
                  setExportOptions((current) => ({
                    ...current,
                    [key]: event.target.checked,
                  }))
                }
              />
              {t(`settings.customerTransfer.export.${label}`)}
            </label>
          ))}
        </div>
        {exportOptions.includeSignatures && (
          <p className="rounded-lg border border-[var(--line,#dedcd1)] p-3 text-xs">
            {t("settings.customerTransfer.export.signaturesWarning")}
          </p>
        )}

        <label className="flex items-start gap-2 text-xs font-bold">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={piiConfirmed}
            onChange={(event) => setPiiConfirmed(event.target.checked)}
          />
          {t("settings.customerTransfer.export.piiConfirm")}
        </label>

        <button
          type="button"
          className={PRIMARY}
          disabled={exporting || selected.size === 0 || !piiConfirmed}
          onClick={startExport}
        >
          <Icon name="file" className="h-4 w-4" />
          {exporting
            ? t("settings.customerTransfer.export.running")
            : t("settings.customerTransfer.export.start")}
        </button>

        {exportError && renderTransferError(exportError)}

        {exportJob && (
          <div className="rounded-xl border border-[var(--line,#dedcd1)] p-3 text-sm sm:p-4">
            <p className="font-bold">{t("settings.customerTransfer.export.resultTitle")}</p>
            {exportJob.reused && (
              <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
                {t("settings.customerTransfer.export.reused")}
              </p>
            )}
            <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
              {t("settings.customerTransfer.export.checksum")}: {exportJob.checksumPrefix}
            </p>
            {exportJob.expiresAt && (
              <p className="text-xs text-[var(--muted,#62685f)]">
                {t("settings.customerTransfer.export.expires", {
                  date: new Date(exportJob.expiresAt).toLocaleString(),
                })}
              </p>
            )}
            <a
              className={`${SECONDARY} mt-2`}
              href={exportJob.downloadUrl}
              download={exportJob.fileName}
            >
              <Icon name="file" className="h-4 w-4" />
              {t("settings.customerTransfer.export.download")}
            </a>
          </div>
        )}
      </section>

      <section className="office-card space-y-4 p-5 sm:p-6" aria-labelledby="ct-import-title">
        <h2 id="ct-import-title" className="text-base font-extrabold">
          {t("settings.customerTransfer.import.title")}
        </h2>
        <p className="text-sm text-[var(--muted,#62685f)]">
          {t("settings.customerTransfer.import.description")}
        </p>

        <label className="flex flex-col gap-1 text-xs font-bold">
          {t("settings.customerTransfer.import.fileLabel")}
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            className={FIELD}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setImportFile(file);
              if (file) void uploadImport(file);
            }}
          />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={createMissingReferences}
            onChange={(event) => {
              const next = event.target.checked;
              setCreateMissingReferences(next);
              // Forhåndsvisningen er bundet til valget; kjør den på nytt slik
              // at bekreftelsen aldri skriver mer enn det administratoren så.
              if (importJob && preview) void runDryRunWith(importJob.id, next);
            }}
          />
          {t("settings.customerTransfer.import.createMissingReferences")}
        </label>
        <p className="text-xs text-[var(--muted,#62685f)]">
          {t("settings.customerTransfer.import.createMissingReferencesHelp")}
        </p>

        {importing && (
          <p role="status" className="text-sm">
            {t("settings.customerTransfer.import.uploading")}
          </p>
        )}
        {importError && renderTransferError(importError)}
        {previewError && renderTransferError(previewError)}

        {preview && (
          <div className="space-y-3">
            <div className="rounded-xl border border-[var(--line,#dedcd1)] p-3 text-sm sm:p-4">
              <p className="font-bold">{t("settings.customerTransfer.import.previewTitle")}</p>
              <dl className="mt-2 grid grid-cols-2 gap-1 text-xs sm:grid-cols-4">
                <div>
                  <dt className="text-[var(--muted,#62685f)]">
                    {t("settings.customerTransfer.import.schemaVersion")}
                  </dt>
                  <dd className="font-bold">{preview.package.schemaVersion}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted,#62685f)]">
                    {t("settings.customerTransfer.import.source")}
                  </dt>
                  <dd className="truncate font-bold">{preview.package.sourceInstanceId}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted,#62685f)]">
                    {t("settings.customerTransfer.import.checksum")}
                  </dt>
                  <dd className="font-bold">{preview.package.checksum.slice(0, 12)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted,#62685f)]">
                    {t("settings.customerTransfer.import.appVersion")}
                  </dt>
                  <dd className="font-bold">{preview.package.appVersion}</dd>
                </div>
              </dl>
            </div>

            <div className="grid gap-2 text-xs sm:grid-cols-5">
              {(["create", "skip", "update", "conflict", "invalid"] as const).map((key) => (
                <div
                  key={key}
                  className="rounded-lg border border-[var(--line,#dedcd1)] p-2 text-center"
                >
                  <p className="font-bold">{preview.counts[key] ?? 0}</p>
                  <p className="text-[var(--muted,#62685f)]">
                    {t(`settings.customerTransfer.import.counts.${key}`)}
                  </p>
                </div>
              ))}
            </div>

            <div className="overflow-auto rounded-xl border border-[var(--line,#dedcd1)]">
              <table className="w-full text-xs">
                <caption className="sr-only">
                  {t("settings.customerTransfer.import.actions")}
                </caption>
                <thead>
                  <tr className="border-b border-[var(--line,#dedcd1)] text-left">
                    <th scope="col" className="p-2">{t("settings.customerTransfer.import.entity")}</th>
                    <th scope="col" className="p-2">{t("settings.customerTransfer.import.action")}</th>
                  </tr>
                </thead>
                <tbody>
                  {actionGroups.map(([type, actions]) => (
                    <tr key={type} className="border-b border-[var(--line,#dedcd1)] last:border-0">
                      <td className="p-2 font-medium">{type}</td>
                      <td className="p-2">
                        {Object.entries(actions)
                          .sort()
                          .map(([action, count]) => `${action}: ${count}`)
                          .join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {preview.warnings.length > 0 && (
              <details className="rounded-xl border border-[var(--line,#dedcd1)] p-3 text-xs">
                <summary className="cursor-pointer font-bold">
                  {t("settings.customerTransfer.import.warnings", {
                    count: preview.warnings.length,
                  })}
                </summary>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {preview.warnings.slice(0, 100).map((warning) => (
                    <li key={`${warning.code}:${warning.path}`}>
                      {issueText(warning)}
                      {warning.path ? ` (${warning.path})` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {preview.errors.length > 0 && (
              <div className="rounded-xl border border-red-300 p-3 text-xs">
                <p className="font-bold text-red-800">
                  {t("settings.customerTransfer.import.errors", {
                    count: preview.errors.length,
                  })}
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {preview.errors.slice(0, 100).map((error) => (
                    <li key={`${error.code}:${error.path}`}>
                      {issueText(error)}
                      {error.path ? ` (${error.path})` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {preview.canImport ? (
              <>
                <fieldset className="rounded-xl border border-[var(--line,#dedcd1)] p-3">
                  <legend className="px-1 text-xs font-bold">
                    {t("settings.customerTransfer.import.policyTitle")}
                  </legend>
                  <p className="mb-2 text-xs text-[var(--muted,#62685f)]">
                    {t("settings.customerTransfer.import.policyHelp")}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {POLICY_KEYS.map((key) => (
                      <label key={key} className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium">
                          {t(`settings.customerTransfer.import.policies.${key}`)}
                        </span>
                        <select
                          className={FIELD}
                          value={policies[key]}
                          onChange={(event) =>
                            setPolicies((current) => ({
                              ...current,
                              [key]: event.target.value,
                            }))
                          }
                        >
                          <option value="skip">
                            {t("settings.customerTransfer.import.policy.skip")}
                          </option>
                          <option value="new">
                            {t("settings.customerTransfer.import.policy.new")}
                          </option>
                          {UPDATE_ALLOWED.has(key) && (
                            <option value="update">
                              {t("settings.customerTransfer.import.policy.update")}
                            </option>
                          )}
                        </select>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <label className="flex items-start gap-2 text-xs font-bold">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  {t("settings.customerTransfer.import.confirmLabel")}
                </label>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={PRIMARY}
                    disabled={importing || !confirmed}
                    onClick={confirmImport}
                  >
                    <Icon name="check" className="h-4 w-4" />
                    {importing
                      ? t("settings.customerTransfer.import.importing")
                      : t("settings.customerTransfer.import.confirm")}
                  </button>
                  <button type="button" className={SECONDARY} onClick={abortImport}>
                    {t("settings.customerTransfer.import.abort")}
                  </button>
                </div>
              </>
            ) : (
              <p role="alert" className="text-sm font-bold text-red-700">
                {t("settings.customerTransfer.import.cannotImport")}
              </p>
            )}
          </div>
        )}

        {importResult && (
          <div className="rounded-xl border border-[var(--line,#dedcd1)] p-3 text-sm sm:p-4">
            <p className="font-bold">{t("settings.customerTransfer.import.resultTitle")}</p>
            <p className="mt-1 text-xs">
              {t("settings.customerTransfer.import.resultCounts", {
                created: importResult.create ?? 0,
                skipped: importResult.skip ?? 0,
                updated: importResult.update ?? 0,
              })}
            </p>
            <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
              {t("settings.customerTransfer.import.cleanupNote")}
            </p>
            <button type="button" className={`${SECONDARY} mt-2`} onClick={resetImport}>
              {t("settings.customerTransfer.import.newImport")}
            </button>
          </div>
        )}

        {importFile && !preview && !importResult && !importError && !previewError && (
          <p className="text-xs text-[var(--muted,#62685f)]">
            {t("settings.customerTransfer.import.fileInfo", {
              name: importFile.name,
              size: Math.ceil(importFile.size / 1024),
            })}
          </p>
        )}
      </section>
    </div>
  );
}
