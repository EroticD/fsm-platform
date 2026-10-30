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
import {
  getCustomerAvailability,
  holdBookingSlot,
  releaseBookingHold,
  type BookingHoldResult,
  type PortalAvailabilityDay,
} from "@/server/availability";
import type { ServiceError } from "@/server/actor";

export type BookingActionState =
  | { status: "idle" }
  | {
      status: "success";
      duplicate: boolean;
      id: string;
      reference: string;
      bookingStatus: "CONFIRMED" | "PENDING";
      technicianName: string | null;
    }
  | { status: "error"; reason: ServiceError };

export type BookingChangeState =
  | { status: "idle" }
  | {
      status: "success";
      reference: string;
      workOrderCancelled?: boolean;
      visitInProgress?: boolean;
      technicianName?: string | null;
    }
  | { status: "error"; reason: ServiceError };

export type SlotActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: ServiceError };

/** Henter ledige halvtimer for én dato til slotvelgeren. */
export async function loadAvailabilityAction(
  date: string,
): Promise<SlotActionResult<PortalAvailabilityDay>> {
  const current = await getCurrentUser();
  if (!current) return { ok: false, reason: "forbidden" };
  return getCustomerAvailability(current, { date });
}

/** Reserverer en valgt time i fem minutter mens skjemaet fylles ut. */
export async function holdSlotAction(input: {
  date: string;
  from: string;
  to: string;
  technicianId: string;
  siteId?: string | null;
}): Promise<SlotActionResult<BookingHoldResult>> {
  const current = await getCurrentUser();
  if (!current) return { ok: false, reason: "forbidden" };
  return holdBookingSlot(current, input);
}

/** Frigjør en reservasjon når kunden velger en annen time. */
export async function releaseHoldAction(
  token: string,
): Promise<{ ok: boolean }> {
  const current = await getCurrentUser();
  if (!current) return { ok: false };
  const result = await releaseBookingHold(current, token);
  return { ok: result.ok };
}

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
    technicianId: formData.get("technicianId"),
    holdToken: formData.get("holdToken"),
    siteId: formData.get("siteId"),
    newSiteName: formData.get("newSiteName"),
    newSiteAddress: formData.get("newSiteAddress"),
    newSitePostalCode: formData.get("newSitePostalCode"),
    newSiteCity: formData.get("newSiteCity"),
    serviceType: formData.get("serviceType"),
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
    bookingStatus: result.data.status,
    technicianName: result.data.technicianName ?? null,
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
    technicianId: formData.get("technicianId"),
    preferredTechnicianId: formData.get("preferredTechnicianId"),
    holdToken: formData.get("holdToken"),
    siteId: formData.get("siteId"),
    serviceType: formData.get("serviceType"),
  });
  if (!result.ok) return { status: "error", reason: result.reason };

  revalidatePath("/kundeportal");
  return {
    status: "success",
    reference: result.data.reference,
    technicianName: result.data.technicianName ?? null,
  };
}
