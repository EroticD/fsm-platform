"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import Icon from "@/components/icons";

const CARD =
  "relative space-y-1 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3 text-sm [--focus-ring:var(--ink,#101310)]";
const MUTED = "text-[var(--muted,#62685f)]";
const LABEL =
  "mb-1 block text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted,#62685f)]";
const CONTROL =
  "w-full rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 text-base font-medium text-[var(--ink,#101310)] outline-none transition placeholder:text-[#6b6559] hover:border-[#bcb3a0] focus:border-[var(--ink,#101310)] focus:ring-2 focus:ring-[var(--signal,#d8ff3e)] [--focus-ring:var(--ink,#101310)]";
const LINK =
  "inline-flex min-h-11 items-center gap-1.5 break-all font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4";
const INK_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)] [--focus-ring:var(--ink,#101310)]";
const RISK_BUTTON =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] border border-[#e7b5ae] bg-[#fdf4f2] px-2 py-2 text-xs font-bold text-[var(--risk-text,#b42318)] transition hover:border-[var(--risk-text,#b42318)] hover:bg-[#fbe9e7] [--focus-ring:var(--risk-text,#b42318)]";

export default function ContactCard({
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
  customerId: string;
  onUpdate: (formData: FormData) => Promise<void>;
  onDelete: (formData: FormData) => Promise<void>;
  /** Montører ser kontaktinfo, men får ikke redigere eller slette. */
  readOnly?: boolean;
  /** Sletting er forbeholdt administrator. */
  canDelete?: boolean;
}) {
  const t = useTranslations("common");
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-black text-[var(--ink,#101310)]">
            {contact.name} {contact.role ? <span className={`text-xs font-normal ${MUTED}`}>({contact.role})</span> : ""}
          </p>
          <div className={`mt-1 space-y-0.5 text-xs ${MUTED}`}>
            {contact.phone && (
              <p>
                <a href={`tel:${contact.phone}`} className={LINK}>
                  <Icon name="phone" className="h-3.5 w-3.5 shrink-0" />
                  {contact.phone}
                </a>
              </p>
            )}
            {contact.email && (
              <p>
                <a href={`mailto:${contact.email}`} className={LINK}>
                  <Icon name="mail" className="h-3.5 w-3.5 shrink-0" />
                  {contact.email}
                </a>
              </p>
            )}
          </div>
        </div>
        <div className={`flex shrink-0 flex-wrap items-center gap-1.5 ${readOnly ? "hidden" : ""}`}>
          <button
            type="button"
            onClick={() => setIsEditing(!isEditing)}
            className={INK_BUTTON}
          >
            <Icon name="edit" className="h-4 w-4 shrink-0" />
            {isEditing ? t("components.contact.hide") : t("components.contact.edit")}
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
              className={RISK_BUTTON}
              title={t("components.contact.deleteTitle")}
            >
              <Icon name="trash" className="h-4 w-4" />
            </button>
          </ConfirmSubmitForm>
        </div>
      </div>

      {isEditing && (
        <form action={onUpdate} className="mt-3 space-y-3 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-3">
          <input type="hidden" name="id" value={contact.id} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor={`contact-${contact.id}-name`} className={LABEL}>{t("components.contact.name")}</label>
              <input
                id={`contact-${contact.id}-name`}
                type="text"
                name="name"
                defaultValue={contact.name}
                required
                className={CONTROL}
              />
            </div>
            <div>
              <label htmlFor={`contact-${contact.id}-role`} className={LABEL}>{t("components.contact.role")}</label>
              <input
                id={`contact-${contact.id}-role`}
                type="text"
                name="role"
                defaultValue={contact.role || ""}
                className={CONTROL}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor={`contact-${contact.id}-email`} className={LABEL}>{t("components.contact.email")}</label>
              <input
                id={`contact-${contact.id}-email`}
                type="email"
                name="email"
                defaultValue={contact.email || ""}
                className={CONTROL}
              />
            </div>
            <div>
              <label htmlFor={`contact-${contact.id}-phone`} className={LABEL}>{t("components.contact.phone")}</label>
              <input
                id={`contact-${contact.id}-phone`}
                type="tel"
                name="phone"
                defaultValue={contact.phone || ""}
                className={CONTROL}
              />
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className={INK_BUTTON}
            >
              {t("components.contact.cancel")}
            </button>
            <button type="submit" className="signal-button whitespace-nowrap border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-xs text-[var(--ink,#101310)] shadow-[2px_2px_0_var(--ink,#101310)] transition hover:translate-x-px hover:translate-y-px hover:shadow-[1px_1px_0_var(--ink,#101310)]">
              {t("components.contact.save")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
