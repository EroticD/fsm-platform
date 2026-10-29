type SubmittedReport = {
  templateId: string | null;
  isLocked: boolean;
  deletedAt?: Date | null;
};

/**
 * Godtar bare en `reportSubmitted`-markør når serveren faktisk har en låst
 * rapport for akkurat den malen på oppdraget. Uten denne kontrollen kunne en
 * hvilken som helst query-parameter få klienten til å slette lokale kladder og
 * vise en falsk kvittering.
 */
export function verifiedSubmittedTemplateId(
  reportSubmitted: string | undefined | null,
  reports: SubmittedReport[],
): string | null {
  if (!reportSubmitted) return null;
  const report = reports.find(
    (candidate) =>
      candidate.templateId === reportSubmitted &&
      candidate.isLocked &&
      !candidate.deletedAt,
  );
  return report ? reportSubmitted : null;
}
