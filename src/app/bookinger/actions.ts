"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import { cancelBookingFromOffice, confirmBooking } from "@/server/bookings";

export async function confirmBookingAction(formData: FormData): Promise<void> {
  const current = await getCurrentUser();
  if (!current) return;
  const result = await confirmBooking(current, {
    bookingId: formData.get("bookingId"),
    technicianId: formData.get("technicianId"),
  });
  if (!result.ok) {
    console.error("Kunne ikke bekrefte booking", result.reason);
  }
  revalidatePath("/bookinger");
  revalidatePath("/kundeportal");
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
