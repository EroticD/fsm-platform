"use server";

import { revalidatePath } from "next/cache";
import { statusKeysByCategory } from "@/lib/work-order-status";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { workOrderScope } from "@/lib/access";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { moduleEnabled } from "@/server/modules";
import {
  addressHash,
  effectiveAddress,
  geocodeAddressDetailed,
  type GeocodeStatus,
} from "@/lib/geocode";

/** Antall adresser per klikk. Nominatim krever maks én forespørsel per sekund. */
const BATCH_SIZE = 3;

/**
 * Geokoder aktive oppdrag som mangler koordinater. Kalles fra kartet.
 *
 * Kartet faller tilbake til kundens by når et oppdrag mangler koordinater;
 * denne handlingen retter opp eldre oppdrag som ble opprettet før geokoding
 * var på plass, eller der første geokodingsforsøk feilet.
 */
export async function geocodeMissingAction() {
  if (!(await moduleEnabled("map"))) redirect("/");
  const user = await getCurrentUser();
  if (!user || !hasPermission(user, "workorders.edit")) redirect("/kart");

  const limit = await allowRequestDb(`geocode:${user.id}`, 2, 60_000);
  if (!limit.allowed) redirect("/kart?geokodingsfeil=rate");

  const missing = await prisma.workOrder.findMany({
    where: {
      AND: [
        workOrderScope(user),
        { latitude: null },
        { longitude: null },
        { status: { notIn: statusKeysByCategory("CLOSED") } },
        {
          OR: [
            { address: { not: null } },
            { postalCode: { not: null } },
            { city: { not: null } },
            { customer: { address: { not: null } } },
            { customer: { city: { not: null } } },
          ],
        },
      ],
    },
    select: {
      id: true,
      address: true,
      postalCode: true,
      city: true,
      customer: { select: { address: true, postalCode: true, city: true } },
    },
    orderBy: [{ scheduledFor: "asc" }, { createdAt: "desc" }],
    take: BATCH_SIZE,
  });

  let geocoded = 0;
  const failures: GeocodeStatus[] = [];
  for (const [index, workOrder] of missing.entries()) {
    if (index > 0) {
      // Vær snill mot Nominatim: maks én forespørsel per sekund.
      await new Promise((resolve) => setTimeout(resolve, 1_100));
    }
    const location = effectiveAddress({
      address: workOrder.address,
      postalCode: workOrder.postalCode,
      city: workOrder.city,
      customer: workOrder.customer,
    });
    if (!location.query) {
      failures.push("no_result");
      continue;
    }
    const result = await geocodeAddressDetailed(location.query, location);
    if (result.status !== "ok" || !result.coordinates) {
      failures.push(result.status);
      continue;
    }

    await prisma.workOrder.update({
      where: { id: workOrder.id },
      data: {
        latitude: result.coordinates.lat,
        longitude: result.coordinates.lng,
        geoAddressHash: addressHash(location.query),
      },
    });
    geocoded += 1;
  }

  const failure: GeocodeStatus | null =
    geocoded === 0
      ? failures.includes("unavailable") || failures.includes("timeout")
        ? failures.includes("timeout")
          ? "timeout"
          : "unavailable"
        : failures.includes("disabled")
          ? "disabled"
          : failures.length > 0
            ? "no_result"
            : null
      : null;

  revalidatePath("/kart");
  const failureParam = failure ? `&geokodingsfeil=${failure}` : "";
  redirect(
    `/kart?geokodet=${geocoded}&geokodingsgjenstår=${Math.max(0, missing.length - geocoded)}${failureParam}`,
  );
}
