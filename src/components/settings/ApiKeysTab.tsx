import { getLocale, getTranslations } from "next-intl/server";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import Icon from "@/components/icons";
import CreateApiKeyForm from "@/components/settings/CreateApiKeyForm";
import { formatDateLocalized, formatDateTimeLocalized } from "@/lib/dates";
import type { ApiKeyActionState } from "@/app/innstillinger/api-actions";
import type { ApiKeySummary } from "@/server/api-keys";

const ERROR_KEYS: Record<string, string> = {
  forbidden: "settings.apiKeys.errors.forbidden",
  validation_error: "settings.apiKeys.errors.invalid",
  not_found: "settings.apiKeys.errors.not_found",
  server_error: "settings.apiKeys.errors.error",
};

const INK_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]";
const DANGER_BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-[10px] border border-[#e7b7a4] bg-[#fae8e0] px-3 py-2 text-xs font-bold text-[var(--risk-text,#b42318)] transition hover:bg-[#f6d9cf]";

/**
 * Administrasjon av API-nøkler. Selve klartekstnøkkelen finnes aldri her –
 * raden viser bare det lagrede visningsprefikset. En ny nøkkel vises én gang i
 * den klientside skjema-komponenten.
 */
export default async function ApiKeysTab({
  keys,
  error,
  createKey,
  revokeKey,
}: {
  keys: ApiKeySummary[];
  error?: string;
  createKey: (
    state: ApiKeyActionState,
    formData: FormData,
  ) => Promise<ApiKeyActionState>;
  revokeKey: (formData: FormData) => void | Promise<void>;
}) {
  const t = await getTranslations("common");
  const locale = await getLocale();
  const now = new Date().getTime();

  return (
    <div className="space-y-5">
      <section className="office-card p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line,#dedcd1)] pb-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-extrabold text-[var(--ink,#101310)]">
              <Icon name="shield" className="h-4 w-4 shrink-0" />
              {t("settings.apiKeys.title")}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-[var(--muted,#62685f)]">
              {t("settings.apiKeys.description")}
            </p>
          </div>
          <a
            href="/api/v1/openapi.json"
            target="_blank"
            rel="noreferrer"
            className={INK_BUTTON}
          >
            <Icon name="file" className="h-4 w-4 shrink-0" />
            {t("settings.apiKeys.docsLink")}
          </a>
        </div>

        <h3 className="text-sm font-extrabold text-[var(--ink,#101310)]">
          {t("settings.apiKeys.createTitle")}
        </h3>
        <p className="mb-3 mt-1 text-sm text-[var(--muted,#62685f)]">
          {t("settings.apiKeys.createDesc")}
        </p>
        <CreateApiKeyForm createKey={createKey} />
      </section>

      <section className="office-card p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line,#dedcd1)] pb-3">
          <h2 className="text-base font-extrabold text-[var(--ink,#101310)]">
            {t("settings.apiKeys.listTitle")}
          </h2>
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
            {t("settings.apiKeys.listCount", { count: keys.length })}
          </span>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-4 flex items-center gap-2 rounded-xl border border-[var(--risk,#f04427)] bg-[#fae8e0] px-4 py-3 text-sm font-bold text-[var(--risk-text,#b42318)]"
          >
            <Icon name="alert" className="h-4 w-4 shrink-0" />
            {t(ERROR_KEYS[error] ?? "settings.apiKeys.errors.error")}
          </div>
        )}

        {keys.length === 0 ? (
          <p className="text-sm italic text-[var(--muted,#62685f)]">
            {t("settings.apiKeys.empty")}
          </p>
        ) : (
          <ul className="space-y-2">
            {keys.map((key) => {
              const revoked = Boolean(key.revokedAt);
              const expired =
                !revoked && key.expiresAt
                  ? key.expiresAt.getTime() <= now
                  : false;
              const statusKey = revoked
                ? "revoked"
                : expired
                  ? "expired"
                  : "active";
              const status = t(`settings.apiKeys.${statusKey}`);
              const statusClass = revoked
                ? "border-[#e7b7a4] bg-[#fae8e0] text-[var(--risk-text,#b42318)]"
                : expired
                  ? "border-[#e2cf9b] bg-[#fbf1d2] text-[#6b4a05]"
                  : "border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--ink,#101310)]";

              return (
                <li
                  key={key.id}
                  className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3 sm:p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 break-words font-bold text-[var(--ink,#101310)]">
                          {key.name}
                        </span>
                        <code className="rounded-md border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-1.5 py-0.5 font-mono text-xs text-[var(--muted,#62685f)]">
                          {key.prefix}…
                        </code>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold ${statusClass}`}
                        >
                          {statusKey === "active" && (
                            <span
                              aria-hidden="true"
                              className="h-1.5 w-1.5 rounded-full bg-[var(--signal,#d8ff3e)]"
                            />
                          )}
                          {status}
                        </span>
                      </div>

                      <dl className="mt-2 grid grid-cols-1 gap-x-5 gap-y-1.5 text-xs text-[var(--muted,#62685f)] sm:grid-cols-2 lg:grid-cols-4">
                        <div className="min-w-0">
                          <dt className="font-bold uppercase tracking-[0.06em]">
                            {t("settings.apiKeys.ownerColumn")}
                          </dt>
                          <dd className="truncate text-[var(--ink,#101310)]">
                            {key.user?.name ||
                              key.user?.email ||
                              t("settings.apiKeys.unknownOwner")}
                          </dd>
                          {key.user?.name && key.user.email && (
                            <dd className="truncate">{key.user.email}</dd>
                          )}
                        </div>
                        <div className="min-w-0">
                          <dt className="font-bold uppercase tracking-[0.06em]">
                            {t("settings.apiKeys.createdColumn")}
                          </dt>
                          <dd className="text-[var(--ink,#101310)]">
                            {formatDateTimeLocalized(key.createdAt, locale)}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="font-bold uppercase tracking-[0.06em]">
                            {t("settings.apiKeys.lastUsedColumn")}
                          </dt>
                          <dd className="text-[var(--ink,#101310)]">
                            {formatDateTimeLocalized(
                              key.lastUsedAt,
                              locale,
                              t("settings.apiKeys.never"),
                            )}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="font-bold uppercase tracking-[0.06em]">
                            {t("settings.apiKeys.expiresColumn")}
                          </dt>
                          <dd className="text-[var(--ink,#101310)]">
                            {formatDateLocalized(
                              key.expiresAt,
                              locale,
                              undefined,
                              t("settings.apiKeys.noExpiry"),
                            )}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    {!revoked && (
                      <ConfirmSubmitForm
                        action={revokeKey}
                        confirmMessage={t("settings.apiKeys.revokeConfirm", {
                          name: key.name,
                        })}
                        confirmLabel={t("settings.apiKeys.revokeLabel")}
                        danger
                        className="shrink-0"
                      >
                        <input type="hidden" name="id" value={key.id} />
                        <button type="submit" className={DANGER_BUTTON}>
                          <Icon name="close" className="mr-1 h-4 w-4 shrink-0" />
                          {t("settings.apiKeys.revoke")}
                        </button>
                      </ConfirmSubmitForm>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
