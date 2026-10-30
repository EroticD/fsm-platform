import { getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import BrandingLogoUpload from "@/components/BrandingLogoUpload";
import { controlClassName } from "@/components/ui/controlStyles";
import type { SettingsOverviewData } from "@/server/settings";

type BrandingTabProps = {
  branding: SettingsOverviewData["branding"];
  error?: string;
  saveBranding: (formData: FormData) => Promise<void>;
};

const FIELD = controlClassName("min-h-11 text-sm font-medium");
const SIGNAL_BUTTON =
  "signal-button text-xs shadow-[2px_2px_0_var(--ink,#101310)] hover:shadow-[1px_1px_0_var(--ink,#101310)]";

export default async function BrandingTab({
  branding,
  error,
  saveBranding,
}: BrandingTabProps) {
  const t = await getTranslations("common");

  return (
    <section className="office-card p-5 sm:p-6">
      <div className="mb-5 flex items-center gap-2 border-b border-[var(--line,#dedcd1)] pb-3">
        <Icon name="image" className="h-4 w-4 shrink-0 text-[var(--ink,#101310)]" />
        <h2 className="text-base font-extrabold text-[var(--ink,#101310)]">
          {t("settings.branding.title")}
        </h2>
      </div>
      {error === "logo" && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-[var(--risk,#f04427)] bg-[#fae8e0] px-4 py-3 text-sm font-bold text-[var(--risk-text,#b42318)]">
          <Icon name="alert" className="h-4 w-4 shrink-0" />
          {t("settings.branding.logoError")}
        </div>
      )}
      <form action={saveBranding} className="max-w-md space-y-5">
        <div>
          <label htmlFor="branding-company-name" className="mb-1 block text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
            {t("settings.branding.companyName")}
          </label>
          <input
            id="branding-company-name"
            type="text"
            name="companyName"
            defaultValue={branding?.companyName || ""}
            placeholder={t("settings.branding.companyNamePlaceholder")}
            required
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="primaryColor" className="mb-1 block text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
            {t("settings.branding.primaryColor")}
          </label>
          <div className="flex items-center gap-3">
            <input
              id="primaryColor"
              type="color"
              name="primaryColor"
              defaultValue={branding?.primaryColor || "#2563eb"}
              className="h-12 w-12 cursor-pointer rounded-lg border border-[var(--line,#dedcd1)] p-1"
            />
            <input
              id="primaryColorHex"
              type="text"
              aria-label={t("settings.branding.primaryColor")}
              defaultValue={branding?.primaryColor || "#2563eb"}
              className={controlClassName("min-h-11 flex-1 bg-[var(--paper,#f2efe6)] text-sm font-medium")}
              readOnly
            />
          </div>
        </div>
        <div>
          <p className="mb-1 block text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
            {t("settings.branding.logo")}
          </p>
          <BrandingLogoUpload initialUrl={branding?.logoUrl} />
          <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
            {t("settings.branding.logoHelp")}
          </p>
        </div>
        <button type="submit" className={SIGNAL_BUTTON}>
          {t("settings.branding.save")}
        </button>
      </form>
    </section>
  );
}
