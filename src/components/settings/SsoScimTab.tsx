import { getLocale, getTranslations } from "next-intl/server";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import Icon from "@/components/icons";
import CreateScimTokenForm from "@/components/settings/CreateScimTokenForm";
import RotateScimTokenForm from "@/components/settings/RotateScimTokenForm";
import { formatDateLocalized, formatDateTimeLocalized } from "@/lib/dates";
import type { ScimTokenActionState } from "@/app/innstillinger/scim-actions";
import {
  scimTokenDefaultLifetimeDays,
  scimTokenMaxLifetimeDays,
  type ScimTokenSummary,
} from "@/server/scim-tokens";

const ERROR_KEYS: Record<string, string> = {
  forbidden: "settings.ssoScim.errors.forbidden",
  validation_error: "settings.ssoScim.errors.invalid",
  not_found: "settings.ssoScim.errors.not_found",
  server_error: "settings.ssoScim.errors.error",
};

const DANGER_BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-[10px] border border-[#e7b7a4] bg-[var(--risk-surface,#fdf4f2)] px-3 py-2 text-xs font-bold text-[var(--risk-text,#b42318)] transition hover:bg-[#f6d9cf]";

export type SsoProviderSummary = {
  slug: string;
  displayName: string;
  issuer: string;
  autoProvision: boolean;
  autoProvisionActive: boolean;
  defaultRole: string;
  allowedEmailDomains: string[];
};

/**
 * Administrasjon av SSO og SCIM.
 *
 * SSO-leverandørene leses fra miljøet og vises bare som status; hemmeligheter
 * vises aldri. SCIM-tokens kan opprettes, roteres og tilbakekalles her.
 */
export default async function SsoScimTab({
  providers,
  configErrors,
  tokens,
  error,
  createToken,
  rotateToken,
  revokeToken,
}: {
  providers: SsoProviderSummary[];
  configErrors: string[];
  tokens: ScimTokenSummary[];
  error?: string;
  createToken: (
    state: ScimTokenActionState,
    formData: FormData,
  ) => Promise<ScimTokenActionState>;
  rotateToken: (
    state: ScimTokenActionState,
    formData: FormData,
  ) => Promise<ScimTokenActionState>;
  revokeToken: (formData: FormData) => void | Promise<void>;
}) {
  const t = await getTranslations("common");
  const locale = await getLocale();
  const now = new Date().getTime();

  return (
    <div className="space-y-5">
      <section className="office-card p-5 sm:p-6">
        <div className="mb-4 border-b border-[var(--line,#dedcd1)] pb-3">
          <h2 className="flex items-center gap-2 text-base font-extrabold text-[var(--ink,#101310)]">
            <Icon name="shield" className="h-4 w-4 shrink-0" />
            {t("settings.ssoScim.ssoTitle")}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--muted,#62685f)]">
            {t("settings.ssoScim.ssoDescription")}
          </p>
        </div>

        {configErrors.length > 0 && (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-[#e2cf9b] bg-[var(--warning-surface,#fdf5e4)] px-4 py-3 text-xs font-bold text-[var(--warning-text,#7a4f0c)]"
          >
            <p className="mb-1 flex items-center gap-1.5">
              <Icon name="alert" className="h-4 w-4 shrink-0" />
              {t("settings.ssoScim.configErrors")}
            </p>
            <ul className="list-disc space-y-0.5 pl-5 font-medium">
              {configErrors.map((configError) => (
                <li key={configError}>{configError}</li>
              ))}
            </ul>
          </div>
        )}

        {providers.length === 0 ? (
          <p className="text-sm text-[var(--muted,#62685f)]">
            {t("settings.ssoScim.ssoEmpty")}
          </p>
        ) : (
          <ul className="space-y-2">
            {providers.map((provider) => (
              <li
                key={provider.slug}
                className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3 sm:p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-[var(--ink,#101310)]">
                    {provider.displayName}
                  </span>
                  <code className="rounded-md border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-1.5 py-0.5 font-mono text-xs text-[var(--muted,#62685f)]">
                    {provider.slug}
                  </code>
                  <span className="inline-flex items-center gap-1 rounded-full border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-2 py-0.5 text-xs font-bold text-[var(--ink,#101310)]">
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 rounded-full bg-[var(--signal,#d8ff3e)]"
                    />
                    {t("settings.ssoScim.ssoActive")}
                  </span>
                </div>
                <dl className="mt-2 grid grid-cols-1 gap-x-5 gap-y-1.5 text-xs text-[var(--muted,#62685f)] sm:grid-cols-2">
                  <div className="min-w-0">
                    <dt className="font-bold uppercase tracking-[0.06em]">
                      {t("settings.ssoScim.issuer")}
                    </dt>
                    <dd className="break-all text-[var(--ink,#101310)]">
                      {provider.issuer}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="font-bold uppercase tracking-[0.06em]">
                      {t("settings.ssoScim.provisioning")}
                    </dt>
                    <dd className="text-[var(--ink,#101310)]">
                      {provider.autoProvision
                        ? provider.autoProvisionActive
                          ? t("settings.ssoScim.autoProvisionActive")
                          : t("settings.ssoScim.autoProvisionInactive")
                        : t("settings.ssoScim.autoProvisionOff")}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="font-bold uppercase tracking-[0.06em]">
                      {t("settings.ssoScim.defaultRole")}
                    </dt>
                    <dd className="text-[var(--ink,#101310)]">
                      {provider.defaultRole}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="font-bold uppercase tracking-[0.06em]">
                      {t("settings.ssoScim.allowedDomains")}
                    </dt>
                    <dd className="break-all text-[var(--ink,#101310)]">
                      {provider.allowedEmailDomains.length > 0
                        ? provider.allowedEmailDomains.join(", ")
                        : t("settings.ssoScim.allDomains")}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-4 text-xs leading-5 text-[var(--muted,#62685f)]">
          {t("settings.ssoScim.ssoHelp")}
        </p>
      </section>

      <section className="office-card p-5 sm:p-6">
        <div className="mb-4 border-b border-[var(--line,#dedcd1)] pb-3">
          <h2 className="flex items-center gap-2 text-base font-extrabold text-[var(--ink,#101310)]">
            <Icon name="sync" className="h-4 w-4 shrink-0" />
            {t("settings.ssoScim.scimTitle")}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--muted,#62685f)]">
            {t("settings.ssoScim.scimDescription")}
          </p>
          <p className="mt-2 break-all rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2 font-mono text-xs text-[var(--ink,#101310)]">
            {t("settings.ssoScim.scimEndpoint")}: /api/scim/v2/Users
          </p>
        </div>

        <h3 className="text-sm font-extrabold text-[var(--ink,#101310)]">
          {t("settings.ssoScim.createTitle")}
        </h3>
        <p className="mb-3 mt-1 text-sm text-[var(--muted,#62685f)]">
          {t("settings.ssoScim.createDesc")}
        </p>
        <CreateScimTokenForm
          createToken={createToken}
          defaultLifetimeDays={scimTokenDefaultLifetimeDays()}
          maxLifetimeDays={scimTokenMaxLifetimeDays()}
        />
      </section>

      <section className="office-card p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line,#dedcd1)] pb-3">
          <h2 className="text-base font-extrabold text-[var(--ink,#101310)]">
            {t("settings.ssoScim.listTitle")}
          </h2>
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
            {t("settings.ssoScim.listCount", { count: tokens.length })}
          </span>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-4 flex items-center gap-2 rounded-xl border border-[var(--risk,#f04427)] bg-[var(--risk-surface,#fdf4f2)] px-4 py-3 text-sm font-bold text-[var(--risk-text,#b42318)]"
          >
            <Icon name="alert" className="h-4 w-4 shrink-0" />
            {t(ERROR_KEYS[error] ?? "settings.ssoScim.errors.error")}
          </div>
        )}

        {tokens.length === 0 ? (
          <p className="text-sm italic text-[var(--muted,#62685f)]">
            {t("settings.ssoScim.empty")}
          </p>
        ) : (
          <ul className="space-y-2">
            {tokens.map((token) => {
              const revoked = Boolean(token.revokedAt);
              const expired =
                !revoked && token.expiresAt
                  ? token.expiresAt.getTime() <= now
                  : false;
              const statusKey = revoked
                ? "revoked"
                : expired
                  ? "expired"
                  : "active";
              const status = t(`settings.ssoScim.${statusKey}`);
              const statusClass = revoked
                ? "border-[#e7b7a4] bg-[var(--risk-surface,#fdf4f2)] text-[var(--risk-text,#b42318)]"
                : expired
                  ? "border-[#e2cf9b] bg-[var(--warning-surface,#fdf5e4)] text-[var(--warning-text,#7a4f0c)]"
                  : "border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--ink,#101310)]";

              return (
                <li
                  key={token.id}
                  className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3 sm:p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 break-words font-bold text-[var(--ink,#101310)]">
                          {token.name}
                        </span>
                        <code className="rounded-md border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-1.5 py-0.5 font-mono text-xs text-[var(--muted,#62685f)]">
                          {token.prefix}…
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

                      <dl className="mt-2 grid grid-cols-1 gap-x-5 gap-y-1.5 text-xs text-[var(--muted,#62685f)] sm:grid-cols-3">
                        <div className="min-w-0">
                          <dt className="font-bold uppercase tracking-[0.06em]">
                            {t("settings.ssoScim.createdColumn")}
                          </dt>
                          <dd className="text-[var(--ink,#101310)]">
                            {formatDateTimeLocalized(token.createdAt, locale)}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="font-bold uppercase tracking-[0.06em]">
                            {t("settings.ssoScim.lastUsedColumn")}
                          </dt>
                          <dd className="text-[var(--ink,#101310)]">
                            {formatDateTimeLocalized(
                              token.lastUsedAt,
                              locale,
                              t("settings.ssoScim.never"),
                            )}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="font-bold uppercase tracking-[0.06em]">
                            {t("settings.ssoScim.expiresColumn")}
                          </dt>
                          <dd className="text-[var(--ink,#101310)]">
                            {formatDateLocalized(
                              token.expiresAt,
                              locale,
                              undefined,
                              t("settings.ssoScim.noExpiry"),
                            )}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    {!revoked && (
                      <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
                        <RotateScimTokenForm
                          id={token.id}
                          name={token.name}
                          rotateToken={rotateToken}
                        />
                        <ConfirmSubmitForm
                          action={revokeToken}
                          confirmMessage={t("settings.ssoScim.revokeConfirm", {
                            name: token.name,
                          })}
                          confirmLabel={t("settings.ssoScim.revokeLabel")}
                          danger
                          className="shrink-0"
                        >
                          <input type="hidden" name="id" value={token.id} />
                          <button type="submit" className={DANGER_BUTTON}>
                            <Icon name="close" className="mr-1 h-4 w-4 shrink-0" />
                            {t("settings.ssoScim.revoke")}
                          </button>
                        </ConfirmSubmitForm>
                      </div>
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
