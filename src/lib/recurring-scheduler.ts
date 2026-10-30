/**
 * Bakoverkompatibel import. Den felles scheduleren ligger i `scheduler.ts` og
 * kjører både serviceavtaler, vedlikeholdsplaner og garantivarsler.
 */
export {
  startRecurringScheduler,
  startScheduler,
} from "./scheduler";
