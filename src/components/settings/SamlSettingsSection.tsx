import { getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import type { SamlProviderConfig } from "@/lib/saml";

export type SamlProviderSummary = Pick<
  SamlProviderConfig,
  | "slug"
  | "displayName"
  | "spEntityId"
  | "acsUrl"
  | "groupsAttribute"
  | "autoProvision"
  | "autoProvisionActive"
  | "defaultRole"
  | "allowIdpInitiated"
>;

/**
 * Read-only status for SAML-leverandører. Hovedagenten monterer denne i
 * SSO/SCIM-fanen; komponenten gjør ingen egne oppslag og viser aldri
 * sertifikater eller hemmeligheter.
 */
export default async function SamlSettingsSection({
  providers,
  configErrors = [],
}: {
  providers: SamlProviderSummary[];
  configErrors?: string[];
}) {
  const t = await getTranslations("common");

  return (
    <section data-saml-settings className="office-card p-5 sm:p-6">
      <div className="mb-4 border-b border-[var(--line,#dedcd1)] pb-3">
        <h2 className="flex items-center gap-2 text-base font-extrabold text-[var(--ink,#101310)]">
          <Icon name="shield" className="h-4 w-4 shrink-0" />
          {t("settings.saml.title")}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted,#62685f)]">
          {t("settings.saml.description")}
        </p>
      </div>

      {configErrors.length > 0 && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-[#e2cf9b] bg-[var(--warning-surface,#fdf5e4)] px-4 py-3 text-xs font-bold text-[var(--warning-text,#7a4f0c)]"
        >
          <p className="mb-1 flex items-center gap-1.5">
            <Icon name="alert" className="h-4 w-4 shrink-0" />
            {t("settings.saml.configErrors")}
          </p>
          <ul className="list-disc space-y-0.5 pl-5 font-medium">
            {configErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {providers.length === 0 ? (
        <p className="text-sm text-[var(--muted,#62685f)]">
          {t("settings.saml.empty")}
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
                  {t("settings.saml.active")}
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-1 gap-x-5 gap-y-1.5 text-xs text-[var(--muted,#62685f)] sm:grid-cols-2">
                <div className="min-w-0">
                  <dt className="font-bold uppercase tracking-[0.06em]">
                    {t("settings.saml.entityId")}
                  </dt>
                  <dd className="break-all text-[var(--ink,#101310)]">
                    {provider.spEntityId}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="font-bold uppercase tracking-[0.06em]">
                    {t("settings.saml.acsUrl")}
                  </dt>
                  <dd className="break-all text-[var(--ink,#101310)]">
                    {provider.acsUrl}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="font-bold uppercase tracking-[0.06em]">
                    {t("settings.saml.groupsAttribute")}
                  </dt>
                  <dd className="break-all text-[var(--ink,#101310)]">
                    {provider.groupsAttribute}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="font-bold uppercase tracking-[0.06em]">
                    {t("settings.saml.provisioning")}
                  </dt>
                  <dd className="text-[var(--ink,#101310)]">
                    {provider.autoProvision
                      ? provider.autoProvisionActive
                        ? t("settings.saml.autoProvisionActive")
                        : t("settings.saml.autoProvisionInactive")
                      : t("settings.saml.autoProvisionOff")}
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-xs text-[var(--muted,#62685f)]">
                {provider.allowIdpInitiated
                  ? t("settings.saml.idpInitiatedOn")
                  : t("settings.saml.idpInitiatedOff")}
              </p>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-xs leading-5 text-[var(--muted,#62685f)]">
        {t("settings.saml.help")}
      </p>
    </section>
  );
}
