"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  cancelBookingFromOffice,
  confirmBooking,
  type BookingQueueFilter,
} from "@/server/bookings";

const QUEUE_FILTERS: readonly BookingQueueFilter[] = [
  "all",
  "pending",
  "confirmed",
  "closed",
];

function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function failureSlug(result: {
  reason: string;
  details?: unknown;
}): string {
  const details = result.details;
  if (details && typeof details === "object" && "code" in details) {
    const code = (details as { code?: unknown }).code;
    if (typeof code === "string") {
      const segment = code.split(".").pop();
      if (segment) return segment;
    }
  }
  return result.reason || "error";
}

/** Bevarer kontorets filter og side når skjemaet sender brukeren tilbake. */
function queuePath(
  formData: FormData,
  bookingId: string,
  params: Record<string, string>,
): string {
  const search = new URLSearchParams();
  const filter = formText(formData, "filter");
  if ((QUEUE_FILTERS as readonly string[]).includes(filter) && filter !== "all") {
    search.set("status", filter);
  }
  const side = formText(formData, "side");
  if (/^\d+$/.test(side) && Number(side) > 1) {
    search.set("side", String(Number(side)));
  }
  for (const [key, value] of Object.entries(params)) {
    search.set(key, value);
  }
  const query = search.toString();
  return `/bookinger${query ? `?${query}` : ""}#booking-${bookingId}`;
}

export async function confirmBookingAction(formData: FormData): Promise<void> {
  const current = await getCurrentUser();
  if (!current) redirect("/api/auth/signin");
  const bookingId = formText(formData, "bookingId");
  const result = await confirmBooking(current, {
    bookingId,
    technicianId: formData.get("technicianId"),
    date: formData.get("date"),
    from: formData.get("from"),
    to: formData.get("to"),
  });

  if (!result.ok) {
    redirect(queuePath(formData, bookingId, { bookingError: failureSlug(result) }));
  }

  revalidatePath("/bookinger");
  revalidatePath("/kundeportal");
  const workOrderId = formText(formData, "workOrderId");
  if (workOrderId) revalidatePath(`/oppdrag/${workOrderId}`);
  redirect(
    queuePath(formData, bookingId, {
      ok: result.data.already ? "already" : "confirmed",
    }),
  );
}

export async function cancelBookingOfficeAction(
  formData: FormData,
): Promise<void> {
  const current = await getCurrentUser();
  if (!current) return;
  const result = await cancelBookingFromOffice(current, {
    bookingId: formData.get("bookingId"),
  });
  if (!result.ok) {
    console.error("Kunne ikke avlyse booking", result.reason);
  }
  revalidatePath("/bookinger");
  revalidatePath("/kundeportal");
}
