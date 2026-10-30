/**
 * Bakoverkompatibel import. Den felles scheduleren ligger i `scheduler.ts` og
 * kjører serviceavtaler, avtalelivssyklus, vedlikeholdsplaner, garantivarsler
 * og SLA-sveip.
 */
export {
  runScheduledJobs,
  startRecurringScheduler,
  startScheduler,
} from "./scheduler";
export type { SchedulerRunResult } from "./scheduler";
