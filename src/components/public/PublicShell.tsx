import type { ReactNode } from "react";
import PageShell from "@/components/PageShell";
import Card from "@/components/ui/Card";
import BrandMark from "@/components/BrandMark";

/**
 * Felles, innloggingsfri ramme for sporing og omtale. Den viser bare
 * merkevaren og innholdet – ingen navigasjon eller kontorflate.
 */
export default function PublicShell({ children }: { children: ReactNode }) {
  return (
    <PageShell className="flex min-h-screen items-center justify-center">
      <Card className="w-full max-w-md p-6 sm:p-8">
        <div className="mb-5 flex items-center gap-3">
          <BrandMark size={36} />
          <span className="type-eyebrow text-[var(--ink,#101310)]">
            FSM System
          </span>
        </div>
        {children}
      </Card>
    </PageShell>
  );
}
