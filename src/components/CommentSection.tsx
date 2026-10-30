"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { apiErrorMessage } from "@/lib/api-error-message";
import { useRouter } from "next/navigation";
import MarkdownEditor from "@/components/MarkdownEditor";
import MarkdownView from "@/components/MarkdownView";
import Icon from "@/components/icons";
import { formatDateTimeLocalized } from "@/lib/dates";

type CommentType = {
  id: string;
  content: string;
  authorName: string | null;
  createdAt: string;
};

type CommentSectionProps = {
  entityType: "workOrder" | "customer" | "contact";
  entityId: string;
  existingComments: CommentType[];
  currentUserName: string | null;
  canWrite?: boolean;
};

export default function CommentSection({ 
  entityType, 
  entityId, 
  existingComments = [],
  currentUserName,
  canWrite = true,
}: CommentSectionProps) {
  const t = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [content, setContent] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType,
          entityId,
          content: content.trim(),
          authorName: currentUserName || "Ukjent",
        }),
      });

      if (!response.ok) {
        let payload: unknown = null;
        try {
          payload = await response.json();
        } catch {
          // Serveren svarte uten JSON – vis den lokale feilmeldingen.
        }
        setError(
          apiErrorMessage(
            payload as { error?: unknown; messageKey?: unknown },
            t,
            t("components.comment.error"),
          ),
        );
        return;
      }

      setContent("");
      setEditorKey((current) => current + 1);
      router.refresh();
    } catch (err) {
      console.error("Feil ved lagring av kommentar:", err);
      setError(t("components.comment.error"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-4 [--focus-ring:var(--ink,#101310)] sm:p-6">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--line,#dedcd1)] pb-2">
        <h2 className="mb-0 flex items-center gap-2 text-lg font-black text-[var(--ink,#101310)]">
          <Icon
            name={
              entityType === "workOrder"
                ? "clipboard"
                : entityType === "customer"
                  ? "building"
                  : "user"
            }
            className="h-5 w-5 shrink-0"
            strokeWidth={2}
          />
          {entityType === "workOrder"
            ? t("components.comment.titleWorkOrder")
            : entityType === "customer"
              ? t("components.comment.titleCustomer")
              : t("components.comment.titleContact")}
        </h2>
        <span className="text-xs font-bold uppercase tracking-wider text-[var(--muted,#62685f)]">
          {t("components.comment.count", { count: existingComments.length })}
        </span>
      </div>

      {/* Kommentarsskjema */}
      {canWrite && (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative">
            <MarkdownEditor
              key={editorKey}
              name="content"
              rows={3}
              disabled={submitting}
              placeholder={t("components.comment.placeholder")}
              onChange={setContent}
            />
            {submitting && (
              <div className="absolute right-2 top-2">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--ink,#101310)] border-t-transparent"></div>
              </div>
            )}
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-xl border border-[#e7b5ae] bg-[#fdf4f2] px-3 py-2 text-sm font-bold text-[var(--risk-text,#b42318)]"
            >
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={!content.trim() || submitting}
            className="signal-button w-full whitespace-nowrap text-sm"
          >
            {submitting
              ? t("components.comment.saving")
              : t("components.comment.submit")}
          </button>
        </form>
      )}

      {/* Kommentarer liste */}
      <div className="space-y-3">
        {existingComments.length === 0 ? (
          <div className="py-6 text-center">
            <p className="italic text-[var(--muted,#62685f)]">{t("components.comment.empty")}</p>
          </div>
        ) : (
          existingComments.map((comment) => (
            <div key={comment.id} className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3">
              <div className="mb-1 flex items-center justify-between gap-2 text-xs font-bold text-[var(--muted,#62685f)]">
                <span>{comment.authorName || t("components.comment.unknown")}</span>
                <span>{formatDateTimeLocalized(comment.createdAt, locale)}</span>
              </div>
              <div className="text-sm font-medium text-[var(--ink,#101310)]">
                <MarkdownView value={comment.content} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
