import type { ReactNode } from "react";
import Card from "@/components/ui/Card";

/** Kort seksjon med tittel og valgfri beskrivelse/handling. */
export default function SectionCard({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title?: ReactNode;
  description?: string;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Card as="section" className={`p-5 sm:p-6 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex flex-col gap-2 border-b border-gray-100 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            {title && <h2 className="text-lg font-bold text-gray-900">{title}</h2>}
            {description && (
              <p className="mt-1 text-sm text-gray-600">{description}</p>
            )}
          </div>
          {action}
        </div>
      )}
      {children}
    </Card>
  );
}
