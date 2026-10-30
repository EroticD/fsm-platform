"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import Icon from "@/components/icons";
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
  className = "",
}: {
  compact?: boolean;
  className?: string;
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
      className={`inline-flex min-h-11 items-center gap-2 rounded-[10px] border px-3 text-xs font-bold transition ${
        enabled
          ? "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]"
          : "border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--muted,#62685f)] hover:border-[var(--ink,#101310)]"
      } ${className}`}
    >
      <Icon
        name="bell"
        className={`h-4 w-4 shrink-0 ${enabled ? "" : "opacity-50"}`}
      />
      {!compact && (
        <span>{enabled ? t("components.sound.on") : t("components.sound.off")}</span>
      )}
    </button>
  );
}
