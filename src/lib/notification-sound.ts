/** Hendelsen realtime-laget dispatcher på `window` når data endrer seg. */
export const NOTIFICATION_REALTIME_EVENT = "fsm:realtime";

/** Skal bjellen spille lyd når antallet går fra `previous` til `next`? */
export function shouldPlayNotificationSound(
  previous: number | null,
  next: number,
): boolean {
  // `null` betyr at vi ennå ikke har lastet en baseline. Da skal det ikke
  // pipes, hverken ved innlasting eller etter en mislykket første henting.
  return previous !== null && next > previous;
}

/** Er realtidshendelsen relevant for uleste varsler? */
export function isNotificationRealtimeKind(kind: unknown): boolean {
  return kind === "notifications" || kind === "all";
}

/**
 * Oppretter en AudioContext hvis vi ikke har en levende en. Må kalles fra en
 * brukergest, ellers blokkerer nettleserens autoplay-policy lyden.
 */
export function ensureAudioContext(
  current: AudioContext | null,
): AudioContext | null {
  if (typeof window === "undefined" || typeof window.AudioContext === "undefined") {
    return null;
  }
  try {
    if (!current || current.state === "closed") return new window.AudioContext();
    return current;
  } catch {
    return null;
  }
}

/** Prøver å låse opp en suspendert AudioContext. Feil ignoreres. */
export function resumeAudioContext(context: AudioContext | null): void {
  if (!context || context.state === "running" || context.state === "closed") return;
  void context.resume().catch(() => {
    // Autoplay-policy kan nekte; da er bjellen fortsatt helt funksjonell.
  });
}

/**
 * Spiller en kort, diskret totoners pipelyd. Gjør ingenting hvis lyd ikke er
 * låst opp ennå, og kaster aldri videre feil til UI-et.
 */
export function playNotificationSound(context: AudioContext | null): void {
  if (!context || context.state !== "running") return;
  try {
    const now = context.currentTime;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.07, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    gain.connect(context.destination);

    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, now);
    oscillator.frequency.setValueAtTime(1174.66, now + 0.12);
    oscillator.connect(gain);
    oscillator.onended = () => {
      try {
        gain.disconnect();
      } catch {
        // Ignorer feil ved opprydding.
      }
    };
    oscillator.start(now);
    oscillator.stop(now + 0.3);
  } catch {
    // Lyd skal aldri påvirke bjellen eller navigasjonen.
  }
}
