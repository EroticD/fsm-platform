"use client";

import { useEffect } from "react";

type SavedValues = Record<string, string[]>;

/**
 * Bevarer skjemafelter over en server-redirect.
 *
 * Server-handlingene våre svarer med `redirect(...?error=...)` når valideringen
 * feiler. Da mister et ukontrollert skjema det brukeren hadde skrevet. Denne
 * komponenten lagrer feltene i `sessionStorage` rett før innsending og legger
 * dem tilbake når skjemaet vises igjen – uten at verdiene havner i URL-en.
 *
 * Bare felter med `name` lagres. Passord og lignende skal derfor ikke bruke
 * denne komponenten.
 */
export default function FormValuePersistence({
  formId,
  storageKey,
  restore: shouldRestore = true,
}: {
  formId: string;
  storageKey: string;
  /** Bare gjenopprett verdier når siden faktisk vises etter en feil. */
  restore?: boolean;
}) {
  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;

    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved && shouldRestore) {
        const values = JSON.parse(saved) as SavedValues;
        restore(form, values);
        sessionStorage.removeItem(storageKey);
      } else if (!shouldRestore) {
        // En vellykket innsending skal ikke etterlate gamle verdier til neste
        // gang skjemaet åpnes på nytt.
        sessionStorage.removeItem(storageKey);
      }
    } catch {
      // Ugyldig eller utilgjengelig lagring skal ikke hindre skjemaet.
    }

    const persist = () => {
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(serialize(form)));
      } catch {
        // Privat modus eller full lagring – skjemaet fungerer fortsatt.
      }
    };

    form.addEventListener("submit", persist);
    return () => form.removeEventListener("submit", persist);
  }, [formId, storageKey, shouldRestore]);

  return null;
}

function serialize(form: HTMLFormElement): SavedValues {
  const values: SavedValues = {};
  for (const [name, value] of new FormData(form).entries()) {
    if (typeof value !== "string") continue;
    (values[name] ??= []).push(value);
  }
  return values;
}

function restore(form: HTMLFormElement, values: SavedValues) {
  for (const [name, saved] of Object.entries(values)) {
    if (!Array.isArray(saved)) continue;
    const elements = Array.from(
      form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        `[name="${CSS.escape(name)}"]`,
      ),
    );

    for (const element of elements) {
      if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
        element.checked = saved.includes(element.value);
        continue;
      }
      if (saved.length > 0) element.value = saved[0];
    }
  }
}
