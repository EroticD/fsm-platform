"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";

export default function ContactCard({
  contact,
  customerId,
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
    <div className="bg-gray-50 p-3 rounded-xl border border-gray-200 text-sm space-y-1 relative">
      <div className="flex justify-between items-start gap-2 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="font-black text-gray-900">
            {contact.name} {contact.role ? <span className="text-xs font-normal text-gray-500">({contact.role})</span> : ""}
          </p>
          {contact.phone && (
            <p className="text-gray-600">
              📞 <a href={`tel:${contact.phone}`} className="text-blue-600 font-bold hover:underline">{contact.phone}</a>
            </p>
          )}
          {contact.email && (
            <p className="text-gray-600">
              ✉️ <a href={`mailto:${contact.email}`} className="text-blue-600 font-bold hover:underline">{contact.email}</a>
            </p>
          )}
        </div>
        <div className={`flex gap-2 flex-shrink-0 ${readOnly ? "hidden" : ""}`}>
          <button
            type="button"
            onClick={() => setIsEditing(!isEditing)}
            className="text-xs font-bold text-blue-600 hover:text-blue-800 hover:underline transition p-1"
          >
            {isEditing ? t("components.contact.hide") : `✏️ ${t("components.contact.edit")}`}
          </button>
          <ConfirmSubmitForm
            action={onDelete}
            confirmMessage={t("components.contact.deleteConfirm")}
            confirmLabel={t("delete")}
            danger
            className={`inline ${canDelete ? "" : "hidden"}`}
          >
            <input type="hidden" name="id" value={contact.id} />
            <button
              type="submit"
              className="text-xs font-bold text-red-600 hover:text-red-800 hover:underline transition p-1"
              title={t("components.contact.deleteTitle")}
            >
              🗑️
            </button>
          </ConfirmSubmitForm>
        </div>
      </div>

      {isEditing && (
        <form action={onUpdate} className="mt-3 p-3 bg-white rounded-lg border border-gray-200 space-y-3">
          <input type="hidden" name="id" value={contact.id} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor={`contact-${contact.id}-name`} className="block text-xs font-bold text-gray-700 mb-1">{t("components.contact.name")}</label>
              <input
                id={`contact-${contact.id}-name`}
                type="text"
                name="name"
                defaultValue={contact.name}
                required
                className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
              />
            </div>
            <div>
              <label htmlFor={`contact-${contact.id}-role`} className="block text-xs font-bold text-gray-700 mb-1">{t("components.contact.role")}</label>
              <input
                id={`contact-${contact.id}-role`}
                type="text"
                name="role"
                defaultValue={contact.role || ""}
                className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor={`contact-${contact.id}-email`} className="block text-xs font-bold text-gray-700 mb-1">{t("components.contact.email")}</label>
              <input
                id={`contact-${contact.id}-email`}
                type="email"
                name="email"
                defaultValue={contact.email || ""}
                className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
              />
            </div>
            <div>
              <label htmlFor={`contact-${contact.id}-phone`} className="block text-xs font-bold text-gray-700 mb-1">{t("components.contact.phone")}</label>
              <input
                id={`contact-${contact.id}-phone`}
                type="tel"
                name="phone"
                defaultValue={contact.phone || ""}
                className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="text-xs font-bold text-gray-600 hover:text-gray-800 hover:underline px-3 py-1.5 rounded-lg transition"
            >
              {t("components.contact.cancel")}
            </button>
            <button type="submit" className="w-auto bg-green-600 text-white px-4 py-1.5 rounded-xl text-xs font-bold hover:bg-green-700 transition shadow-sm">
              {t("components.contact.save")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
