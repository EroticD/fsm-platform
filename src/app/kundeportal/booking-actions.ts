"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import { clientIpFrom } from "@/lib/client-ip";
import {
  cancelBooking,
  createBooking,
  rescheduleBooking,
} from "@/server/portal";
import type { ServiceError } from "@/server/actor";

export type BookingActionState =
  | { status: "idle" }
  | {
      status: "success";
      duplicate: boolean;
      id: string;
      reference: string;
    }
  | { status: "error"; reason: ServiceError };

export type BookingChangeState =
  | { status: "idle" }
  | {
      status: "success";
      reference: string;
      workOrderCancelled?: boolean;
      visitInProgress?: boolean;
    }
  | { status: "error"; reason: ServiceError };

/**
 * Bestilling fra kundeportalen. All validering og eierskap ligger i
 * `createBooking`; handlingen sender bare videre skjemafeltene.
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
    requestedDate: formData.get("requestedDate"),
    requestedFrom: formData.get("requestedFrom"),
    requestedTo: formData.get("requestedTo"),
    equipmentId: formData.get("equipmentId"),
    contactName: formData.get("contactName"),
    contactPhone: formData.get("contactPhone"),
    preferredTechnicianId: formData.get("preferredTechnicianId"),
    // Bare en betrodd proxy får bidra med klient-IP.
    ip: clientIpFrom(requestHeaders),
  });

  if (!result.ok) return { status: "error", reason: result.reason };

  revalidatePath("/kundeportal");
  return {
    status: "success",
    duplicate: result.data.duplicate === true,
    id: result.data.id,
    reference: result.data.reference,
  };
}

/** Kunden kansellerer sin egen bestilling. */
export async function cancelBookingAction(
  _previous: BookingChangeState,
  formData: FormData,
): Promise<BookingChangeState> {
  const current = await getCurrentUser();
  if (!current) return { status: "error", reason: "forbidden" };

  const result = await cancelBooking(current, {
    bookingId: formData.get("bookingId"),
  });
  if (!result.ok) return { status: "error", reason: result.reason };

  revalidatePath("/kundeportal");
  return {
    status: "success",
    reference: result.data.reference,
    workOrderCancelled: result.data.workOrderCancelled,
    visitInProgress: result.data.visitInProgress,
  };
}

/** Kunden ber om et nytt tidsvindu for sin egen bestilling. */
export async function rescheduleBookingAction(
  _previous: BookingChangeState,
  formData: FormData,
): Promise<BookingChangeState> {
  const current = await getCurrentUser();
  if (!current) return { status: "error", reason: "forbidden" };

  const result = await rescheduleBooking(current, {
    bookingId: formData.get("bookingId"),
    requestedDate: formData.get("requestedDate"),
    requestedFrom: formData.get("requestedFrom"),
    requestedTo: formData.get("requestedTo"),
  });
  if (!result.ok) return { status: "error", reason: result.reason };

  revalidatePath("/kundeportal");
  return { status: "success", reference: result.data.reference };
}
