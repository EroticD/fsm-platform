"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import {
  getOrCreateCalendarToken,
  regenerateCalendarToken,
  revokeCalendarToken,
} from "@/server/calendar-feed";

export type CalendarFeedActionState = {
  /** Rå tokenet – bare satt i svaret som opprettet/roterte lenken. */
  token: string | null;
  active: boolean;
  error?: "forbidden" | "not_found" | "error";
};

/**
 * Én action for alle tre valgene. Tokenet returneres bare i returverdien til
 * klienten som nettopp utførte handlingen – aldri via en redirect-URL, og
 * aldri fra en vanlig sidevisning.
 */
export async function calendarFeedAction(
  _previous: CalendarFeedActionState,
  formData: FormData,
): Promise<CalendarFeedActionState> {
  const user = await getCurrentUser();
  if (!user) return { token: null, active: false, error: "forbidden" };

  const intent = String(formData.get("intent") ?? "create");

  if (intent === "revoke") {
    const result = await revokeCalendarToken(user);
    if (!result.ok) return { token: null, active: true, error: "error" };
    revalidatePath("/innstillinger");
    return { token: null, active: false };
  }

  if (intent === "regenerate") {
    const result = await regenerateCalendarToken(user);
    if (!result.ok) {
      return {
        token: null,
        active: true,
        error: result.reason === "forbidden" ? "forbidden" : "error",
      };
    }
    revalidatePath("/innstillinger");
    return { token: result.data.token, active: true };
  }

  const result = await getOrCreateCalendarToken(user);
  if (!result.ok) {
    return {
      token: null,
      active: false,
      error: result.reason === "forbidden" ? "forbidden" : "error",
    };
  }
  revalidatePath("/innstillinger");
  return { token: result.data.token, active: true };
}
