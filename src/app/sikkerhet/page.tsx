import { redirect } from "next/navigation";

/** Sikkerhetsinnstillinger er flyttet inn som egen fane under /innstillinger. */
export default function SecurityRedirect() {
  redirect("/innstillinger?tab=sikkerhet");
}
