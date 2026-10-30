"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { workOrderScope } from "@/lib/access";
import { allowRequestDb } from "@/lib/rate-limit-db";
import {
  addressHash,
  effectiveAddress,
  geocodeAddress,
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
        { status: { notIn: ["COMPLETED", "CANCELLED"] } },
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
    if (!location.query) continue;
    const coordinates = await geocodeAddress(location.query);
    if (!coordinates) continue;

    await prisma.workOrder.update({
      where: { id: workOrder.id },
      data: {
        latitude: coordinates.lat,
        longitude: coordinates.lng,
        geoAddressHash: addressHash(location.query),
      },
    });
    geocoded += 1;
  }

  revalidatePath("/kart");
  redirect(
    `/kart?geokodet=${geocoded}&geokodingsgjenstår=${Math.max(0, missing.length - geocoded)}`,
  );
}
