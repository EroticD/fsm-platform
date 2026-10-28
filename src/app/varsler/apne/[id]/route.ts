import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import { openNotification } from "@/server/notifications";

export const dynamic = "force-dynamic";

/**
 * Åpner et varsel via en vanlig GET-lenke. Da fungerer midtklikk og «åpne i
 * ny fane», samtidig som serveren markerer varselet som lest og slår opp den
 * lagrede, rolle-trygge lenken. Klienten kan aldri sende en egen href.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user?.isActive) {
    return NextResponse.redirect(new URL("/api/auth/signin", request.url));
  }

  const { id } = await params;
  const result = await openNotification(user, id);
  revalidatePath("/varsler");

  if (!result.ok || !result.data.href) {
    return NextResponse.redirect(new URL("/varsler", request.url));
  }

  return NextResponse.redirect(new URL(result.data.href, request.url));
}
