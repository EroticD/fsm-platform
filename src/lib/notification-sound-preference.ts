/**
 * Brukerens valg for varsellyd. Valget ligger i localStorage, slik at det
 * gjelder i alle faner og overlever innlogging uten en ekstra databasetabell.
 * Standard er på, som før.
 */
export const NOTIFICATION_SOUND_STORAGE_KEY = "fsm:notification-sound";
/** Hendelse på `window` når lydvalget endres i en annen komponent eller fane. */
export const NOTIFICATION_SOUND_CHANGED_EVENT = "fsm:notification-sound-changed";

export type NotificationSoundSetting = "on" | "off";

/** Leser lagret valg. Mangler eller ødelagt verdi betyr «på». */
export function readNotificationSoundSetting(): NotificationSoundSetting {
  if (typeof window === "undefined") return "on";
  try {
    return window.localStorage.getItem(NOTIFICATION_SOUND_STORAGE_KEY) === "off"
      ? "off"
      : "on";
  } catch {
    return "on";
  }
}

export function isNotificationSoundEnabled(): boolean {
  return readNotificationSoundSetting() === "on";
}

/** Lagrer valget og varsler andre komponenter i samme fane. */
export function writeNotificationSoundSetting(setting: NotificationSoundSetting): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NOTIFICATION_SOUND_STORAGE_KEY, setting);
  } catch {
    // Privat modus eller full lagring: valget gjelder bare denne visningen.
  }
  window.dispatchEvent(
    new CustomEvent<NotificationSoundSetting>(NOTIFICATION_SOUND_CHANGED_EVENT, {
      detail: setting,
    }),
  );
}
