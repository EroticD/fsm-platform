import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { countUnreadNotifications } from "@/server/notifications";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ count: 0 }, { status: 401 });
  }
  const count = await countUnreadNotifications(user);
  return NextResponse.json(
    { count },
    { headers: { "Cache-Control": "no-store" } },
  );
}
