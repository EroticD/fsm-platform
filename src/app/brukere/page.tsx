import { redirect } from "next/navigation";

/**
 * Ansattadministrasjonen skal bare vises som fane i Innstillinger. Den gamle
 * /brukere-URL-en beholdes som en kompatibel redirect for bokmerker og gamle
 * lenker, men har ingen egen side eller navigasjonsinngang.
 */
export default function UsersPage() {
  redirect("/innstillinger?tab=ansatte");
}
