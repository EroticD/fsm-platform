"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import Icon from "@/components/icons";
import {
  CUSTOMER_CONTROL,
  CUSTOMER_INK_BUTTON,
  CUSTOMER_INSET,
  CUSTOMER_LABEL,
  CUSTOMER_MUTED,
  CUSTOMER_RISK_BUTTON,
  CUSTOMER_SIGNAL_BUTTON,
} from "./customerStyles";

/**
 * Kontaktkort på kundekortet. Samme redigering og sletting som den delte
 * ContactCard, men med monokrome ikoner og papir/blekk-flaten kundekortet
 * bruker. Montører ser kontaktinfo uten redigeringsknapper.
 */
export default function CustomerContactCard({
  contact,
  onUpdate,
  onDelete,
  readOnly = false,
  canDelete = false,
}: {
  contact: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    role: string | null;
  };
  onUpdate: (formData: FormData) => Promise<void>;
  onDelete: (formData: FormData) => Promise<void>;
  readOnly?: boolean;
  canDelete?: boolean;
}) {
  const t = useTranslations("common");
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div className={`${CUSTOMER_INSET} p-3 text-sm`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-bold text-[var(--ink,#101310)]">
            {contact.name}{" "}
            {contact.role ? (
              <span className={`text-xs font-normal ${CUSTOMER_MUTED}`}>
                ({contact.role})
              </span>
            ) : null}
          </p>
          <div className={`mt-1 space-y-0.5 text-xs ${CUSTOMER_MUTED}`}>
            {contact.phone && (
              <p>
                <a
                  href={`tel:${contact.phone}`}
                  className="inline-flex items-center gap-1.5 font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
                >
                  <Icon name="phone" className="h-3.5 w-3.5 shrink-0" />
                  {contact.phone}
                </a>
              </p>
            )}
            {contact.email && (
              <p>
                <a
                  href={`mailto:${contact.email}`}
                  className="inline-flex min-w-0 items-center gap-1.5 break-all font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
                >
                  <Icon name="mail" className="h-3.5 w-3.5 shrink-0" />
                  {contact.email}
                </a>
              </p>
            )}
          </div>
        </div>

        {!readOnly && (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIsEditing((current) => !current)}
              className={CUSTOMER_INK_BUTTON}
            >
              <Icon name="edit" className="h-4 w-4 shrink-0" />
              {isEditing
                ? t("components.contact.hide")
                : t("components.contact.edit")}
            </button>
            <ConfirmSubmitForm
              action={onDelete}
              confirmMessage={t("components.contact.deleteConfirm", {
                name: contact.name,
              })}
              confirmLabel={t("delete")}
              danger
              className={`inline-flex ${canDelete ? "" : "hidden"}`}
            >
              <input type="hidden" name="id" value={contact.id} />
              <button
                type="submit"
                aria-label={`${t("components.contact.deleteTitle")}: ${contact.name}`}
                title={t("components.contact.deleteTitle")}
                className={`${CUSTOMER_RISK_BUTTON} min-w-11 px-2`}
              >
                <Icon name="trash" className="h-4 w-4" />
              </button>
            </ConfirmSubmitForm>
          </div>
        )}
      </div>

      {isEditing && (
        <form
          action={onUpdate}
          className="mt-3 space-y-3 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-3"
        >
          <input type="hidden" name="id" value={contact.id} />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label
                htmlFor={`contact-${contact.id}-name`}
                className={CUSTOMER_LABEL}
              >
                {t("components.contact.name")}
              </label>
              <input
                id={`contact-${contact.id}-name`}
                type="text"
                name="name"
                defaultValue={contact.name}
                required
                className={CUSTOMER_CONTROL}
              />
            </div>
            <div>
              <label
                htmlFor={`contact-${contact.id}-role`}
                className={CUSTOMER_LABEL}
              >
                {t("components.contact.role")}
              </label>
              <input
                id={`contact-${contact.id}-role`}
                type="text"
                name="role"
                defaultValue={contact.role || ""}
                className={CUSTOMER_CONTROL}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label
                htmlFor={`contact-${contact.id}-email`}
                className={CUSTOMER_LABEL}
              >
                {t("components.contact.email")}
              </label>
              <input
                id={`contact-${contact.id}-email`}
                type="email"
                name="email"
                defaultValue={contact.email || ""}
                className={CUSTOMER_CONTROL}
              />
            </div>
            <div>
              <label
                htmlFor={`contact-${contact.id}-phone`}
                className={CUSTOMER_LABEL}
              >
                {t("components.contact.phone")}
              </label>
              <input
                id={`contact-${contact.id}-phone`}
                type="tel"
                name="phone"
                defaultValue={contact.phone || ""}
                className={CUSTOMER_CONTROL}
              />
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className={CUSTOMER_INK_BUTTON}
            >
              {t("components.contact.cancel")}
            </button>
            <button type="submit" className={CUSTOMER_SIGNAL_BUTTON}>
              {t("components.contact.save")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
