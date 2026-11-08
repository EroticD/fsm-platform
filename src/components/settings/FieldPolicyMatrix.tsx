import { getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import {
  FIELD_GROUPS,
  FIELD_POLICY_MATRIX,
  type FieldAccessLevel,
  type FieldGroup,
} from "@/lib/field-rbac";

const ROLES = ["ADMIN", "OFFICE", "TECHNICIAN", "CUSTOMER", "USER"] as const;

const ACCESS_KEY: Record<FieldAccessLevel, string> = {
  full: "settings.fieldPolicy.full",
  own: "settings.fieldPolicy.own",
  none: "settings.fieldPolicy.none",
};

const ACCESS_CLASS: Record<FieldAccessLevel, string> = {
  full: "border-[#b9c99a] bg-[var(--success-surface,#eef7d6)] text-[var(--success-text,#283509)]",
  own: "border-[#e2cf9b] bg-[var(--warning-surface,#fdf5e4)] text-[var(--warning-text,#7a4f0c)]",
  none: "border-[#e7b7a4] bg-[var(--risk-surface,#fdf4f2)] text-[var(--risk-text,#b42318)]",
};

function fieldLabelKey(group: FieldGroup): string {
  return `settings.fieldPolicy.fields.${group}`;
}

/**
 * Skrivebeskyttet policy-matrise for feltnivå-RBAC. Hovedagenten monterer den
 * i innstillingene. Matrisen er den samme som serveren håndhever.
 */
export default async function FieldPolicyMatrix() {
  const t = await getTranslations("common");

  return (
    <section data-field-policy className="office-card p-5 sm:p-6">
      <div className="mb-4 border-b border-[var(--line,#dedcd1)] pb-3">
        <h2 className="flex items-center gap-2 text-base font-extrabold text-[var(--ink,#101310)]">
          <Icon name="shield" className="h-4 w-4 shrink-0" />
          {t("settings.fieldPolicy.title")}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted,#62685f)]">
          {t("settings.fieldPolicy.description")}
        </p>
      </div>

      <div
        className="overflow-x-auto"
        role="region"
        aria-label={t("settings.fieldPolicy.title")}
        tabIndex={0}
      >
        <table className="w-full min-w-[560px] border-collapse text-left text-xs">
          <thead>
            <tr>
              <th className="border-b border-[var(--line,#dedcd1)] px-2 py-2 font-bold uppercase tracking-[0.06em] text-[var(--muted,#62685f)]">
                {t("settings.fieldPolicy.field")}
              </th>
              {ROLES.map((role) => (
                <th
                  key={role}
                  className="border-b border-[var(--line,#dedcd1)] px-2 py-2 text-center font-bold uppercase tracking-[0.06em] text-[var(--muted,#62685f)]"
                >
                  {role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FIELD_GROUPS.map((group) => (
              <tr key={group}>
                <th className="border-b border-[var(--line,#dedcd1)] px-2 py-2 text-left font-bold text-[var(--ink,#101310)]">
                  {t(fieldLabelKey(group))}
                </th>
                {ROLES.map((role) => {
                  const level = FIELD_POLICY_MATRIX[group][role];
                  return (
                    <td
                      key={role}
                      className="border-b border-[var(--line,#dedcd1)] px-2 py-2 text-center"
                    >
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 font-bold ${ACCESS_CLASS[level]}`}
                      >
                        {t(ACCESS_KEY[level])}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs leading-5 text-[var(--muted,#62685f)]">
        {t("settings.fieldPolicy.note")}
      </p>
      <p className="mt-1 text-xs leading-5 text-[var(--muted,#62685f)]">
        {t("settings.fieldPolicy.overrideNote")}
      </p>
    </section>
  );
}
