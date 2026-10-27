"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import {
  NOTIFICATION_SOUND_CHANGED_EVENT,
  NOTIFICATION_SOUND_STORAGE_KEY,
  readNotificationSoundSetting,
  writeNotificationSoundSetting,
  type NotificationSoundSetting,
} from "@/lib/notification-sound-preference";

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === NOTIFICATION_SOUND_STORAGE_KEY) {
      onChange();
    }
  };
  window.addEventListener(NOTIFICATION_SOUND_CHANGED_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(NOTIFICATION_SOUND_CHANGED_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Av/på for varsellyd. Valget lagres lokalt, og bjellen leser det samme
 * valget før den spiller av lyd.
 */
export default function NotificationSoundToggle({
  compact = false,
}: {
  compact?: boolean;
}) {
  const t = useTranslations("common");
  const setting = useSyncExternalStore<NotificationSoundSetting>(
    subscribe,
    readNotificationSoundSetting,
    // Serveren vet ikke hva brukeren har valgt; standard er på.
    () => "on",
  );
  const enabled = setting === "on";

  const toggle = () => {
    writeNotificationSoundSetting(enabled ? "off" : "on");
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={enabled}
      aria-label={
        enabled
          ? t("components.sound.turnOff")
          : t("components.sound.turnOn")
      }
      title={enabled ? t("components.sound.on") : t("components.sound.off")}
      className={`flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-bold transition ${
        enabled
          ? "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
          : "border-gray-300 bg-gray-100 text-gray-500 hover:bg-gray-200"
      }`}
    >
      <span aria-hidden="true">{enabled ? "🔔" : "🔕"}</span>
      {!compact && (
        <span>{enabled ? t("components.sound.on") : t("components.sound.off")}</span>
      )}
    </button>
  );
}
