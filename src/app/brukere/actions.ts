"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { safeRelativeTarget } from "@/lib/safe-redirect";
import {
  changeDepartment as changeDepartmentService,
  changePermissions as changePermissionsService,
  changePhone as changePhoneService,
  changeRole as changeRoleService,
  createUser as createUserService,
  deleteUser as deleteUserService,
  generateInvite as generateInviteService,
  resetPermissions as resetPermissionsService,
  setActive as setActiveService,
} from "@/server/users";

/**
 * Hvor skal brukeren sendes tilbake etter handlingen? Skjemaet sender med
 * `returnTo`, slik at samme skjema virker både på /brukere og i
 * innstillinger-fanen. Kun relative stier internt i appen godtas.
 */
function returnPath(formData: FormData): string {
  const raw = (formData.get("returnTo") as string) || "";
  // Samme normalisering som innloggingsredirecten: absolutte URL-er, "//vert"
  // og backslash-stier avvises, slik at skjemaet ikke kan brukes som åpen
  // omdirigering.
  const target = safeRelativeTarget(raw);
  return target === "/" && raw !== "/" ? "/brukere" : target;
}

/** Legger på et query-parameter, uansett om stien allerede har query. */
function withParam(path: string, key: string, value: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

/** Begge sidene som viser brukeradministrasjonen må revalideres. */
function revalidateUserAdmin() {
  revalidatePath("/brukere");
  revalidatePath("/innstillinger");
}

export async function createUser(formData: FormData) {
  const back = returnPath(formData);
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await createUserService(actor, {
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    role: formData.get("role"),
    departmentId: formData.get("departmentId"),
    contactId: formData.get("contactId"),
  });

  if (!result.ok) {
    if (result.reason === "invalid") {
      redirect(withParam(back, "error", "ugyldig-data"));
    }
    if (result.reason === "missing_contact") {
      redirect(withParam(back, "error", "mangler_kontakt"));
    }
    if (result.reason === "duplicate_email") {
      redirect(withParam(back, "error", "epost_finnes"));
    }
    return;
  }

  const { id, mailSent } = result.data;
  revalidateUserAdmin();
  // Den rå invitasjonsnøkkelen skal aldri ligge i en URL. Den finnes bare i
  // e-posten (eller vises én gang i utviklingsmodus), slik at den ikke havner i
  // logger, referrer-headere eller nettleserhistorikk.
  redirect(withParam(withParam(back, "invite", id), "mail", mailSent ? "sent" : "manual"));
}

export async function deleteUser(formData: FormData) {
  const back = returnPath(formData);
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await deleteUserService(actor, { id: formData.get("id") });
  if (!result.ok) {
    if (result.reason === "invalid") {
      redirect(withParam(back, "error", "ugyldig-data"));
    }
    return;
  }

  revalidateUserAdmin();
}

export async function changeRole(formData: FormData) {
  const back = returnPath(formData);
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await changeRoleService(actor, {
    id: formData.get("id"),
    role: formData.get("role"),
  });
  if (!result.ok) {
    if (result.reason === "invalid") {
      redirect(withParam(back, "error", "ugyldig-data"));
    }
    return;
  }

  revalidateUserAdmin();
}

export async function setActive(formData: FormData) {
  const back = returnPath(formData);
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await setActiveService(actor, {
    id: formData.get("id"),
    active: formData.get("active"),
  });
  if (!result.ok) {
    if (result.reason === "invalid") {
      redirect(withParam(back, "error", "ugyldig-data"));
    }
    return;
  }

  revalidateUserAdmin();
}

export async function changeDepartment(formData: FormData) {
  const back = returnPath(formData);
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await changeDepartmentService(actor, {
    id: formData.get("id"),
    departmentId: formData.get("departmentId"),
  });
  if (!result.ok) {
    if (result.reason === "invalid") {
      redirect(withParam(back, "error", "ugyldig-data"));
    }
    return;
  }

  revalidateUserAdmin();
}

export async function changePhone(formData: FormData) {
  const back = returnPath(formData);
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await changePhoneService(actor, {
    id: formData.get("id"),
    phone: formData.get("phone"),
  });
  if (!result.ok) {
    if (result.reason === "invalid") {
      redirect(withParam(back, "error", "ugyldig-data"));
    }
    return;
  }

  revalidateUserAdmin();
}

export async function changePermissions(formData: FormData) {
  const back = returnPath(formData);
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await changePermissionsService(actor, {
    id: formData.get("id"),
    permissions: formData.getAll("permissions"),
  });
  if (!result.ok) {
    if (result.reason === "invalid") {
      redirect(withParam(back, "error", "ugyldig-data"));
    }
    return;
  }

  revalidateUserAdmin();
}

export async function resetPermissions(formData: FormData) {
  const back = returnPath(formData);
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await resetPermissionsService(actor, {
    id: formData.get("id"),
  });
  if (!result.ok) {
    if (result.reason === "invalid") {
      redirect(withParam(back, "error", "ugyldig-data"));
    }
    return;
  }

  revalidateUserAdmin();
}

export async function generateInvite(formData: FormData) {
  const back = returnPath(formData);
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await generateInviteService(actor, {
    id: formData.get("id"),
  });
  if (!result.ok) {
    if (result.reason === "invalid") {
      redirect(withParam(back, "error", "ugyldig-data"));
    }
    return;
  }

  const { id, mailSent } = result.data;
  revalidateUserAdmin();
  // Den rå invitasjonsnøkkelen skal aldri ligge i en URL. Den finnes bare i
  // e-posten (eller vises én gang i utviklingsmodus), slik at den ikke havner i
  // logger, referrer-headere eller nettleserhistorikk.
  redirect(withParam(withParam(back, "invite", id), "mail", mailSent ? "sent" : "manual"));
}
