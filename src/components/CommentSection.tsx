"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import MarkdownEditor from "@/components/MarkdownEditor";
import MarkdownView from "@/components/MarkdownView";
import { formatDateTime } from "@/lib/dates";

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
  const [content, setContent] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || submitting) return;
    setSubmitting(true);

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

      if (response.ok) {
        setContent("");
        setEditorKey((current) => current + 1);
        window.location.reload();
      }
    } catch (error) {
      console.error("Feil ved lagring av kommentar:", error);
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-200 space-y-4">
      <div className="flex justify-between items-center border-b pb-2">
        <h2 className="font-black text-gray-900 text-lg mb-0">
          {entityType === "workOrder"
            ? `💬 ${t("components.comment.titleWorkOrder")}`
            : entityType === "customer"
              ? `💬 ${t("components.comment.titleCustomer")}`
              : `💬 ${t("components.comment.titleContact")}`}
        </h2>
        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
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
                <div className="w-3 h-3 rounded-full border-2 border-blue-600 border-t-transparent animate-spin"></div>
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={!content.trim() || submitting}
            className="w-full bg-[var(--primary-color)] text-white px-4 py-2 rounded-xl text-sm font-bold hover:opacity-90 transition shadow-sm disabled:opacity-50 whitespace-nowrap"
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
          <div className="text-center py-6">
            <p className="text-gray-500 italic">{t("components.comment.empty")}</p>
          </div>
        ) : (
          existingComments.map((comment) => (
            <div key={comment.id} className="bg-gray-50 p-3 rounded-xl border border-gray-100">
              <div className="flex justify-between items-center text-xs font-bold text-gray-500 mb-1">
                <span>{comment.authorName || t("components.comment.unknown")}</span>
                <span>{formatDateTime(comment.createdAt)}</span>
              </div>
              <div className="text-sm text-gray-900 font-medium">
                <MarkdownView value={comment.content} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
