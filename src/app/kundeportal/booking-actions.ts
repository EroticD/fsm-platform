"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import { clientIpFrom } from "@/lib/client-ip";
import { createBooking } from "@/server/portal";
import type { ServiceError } from "@/server/actor";

export type BookingActionState =
  | { status: "idle" }
  | { status: "success"; duplicate: boolean }
  | { status: "error"; reason: ServiceError };

/**
 * Bestilling fra kundeportalen. Resultatet er typet, slik at skjemaet kan vise
 * en konkret norsk melding i stedet for å feile stille.
 */
export async function bookWorkOrderAction(
  _previous: BookingActionState,
  formData: FormData,
): Promise<BookingActionState> {
  const current = await getCurrentUser();
  if (!current) return { status: "error", reason: "forbidden" };

  const requestHeaders = await headers();
  const result = await createBooking(current, {
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
    // Bare en betrodd proxy får bidra med klient-IP.
    ip: clientIpFrom(requestHeaders),
  });

  if (!result.ok) return { status: "error", reason: result.reason };

  revalidatePath("/kundeportal");
  return { status: "success", duplicate: result.data.duplicate === true };
}
