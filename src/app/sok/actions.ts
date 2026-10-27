"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  createSavedSearch,
  deleteSavedSearch,
} from "@/server/saved-searches";
import { buildSearchHref } from "./search-params";
import {
  pageFromFormData,
  queryFromFormData,
  searchFiltersFromFormData,
} from "./saved-search-form";

/** Lagrer q + gjeldende filtre som et navngitt, personlig søk. */
export async function saveSearchAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");

  const query = queryFromFormData(formData);
  const filters = searchFiltersFromFormData(formData);
  const page = pageFromFormData(formData);

  let state: string | null = null;

  try {
    const result = await createSavedSearch(user, {
      name: String(formData.get("name") ?? ""),
      query,
      filters,
    });

    if (!result.ok) {
      state =
        result.reason === "conflict"
          ? "duplikat"
          : result.reason === "invalid"
            ? "ugyldig"
            : "feil";
    }
  } catch {
    state = "feil";
  }

  if (state) {
    redirect(buildSearchHref({ q: query, page, filters, extra: { lagre: state } }));
  }

  revalidatePath("/sok");
  redirect(
    buildSearchHref({ q: query, page, filters, extra: { lagre: "lagret" } }),
  );
}

/** Sletter et lagret søk. Tjenesten kontrollerer eierskap på nytt. */
export async function deleteSearchAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");

  const id = String(formData.get("id") ?? "");
  const query = queryFromFormData(formData);
  const filters = searchFiltersFromFormData(formData);
  const page = pageFromFormData(formData);

  let failed = false;

  try {
    const result = await deleteSavedSearch(user, id);
    failed = !result.ok;
  } catch {
    failed = true;
  }

  if (failed) {
    redirect(
      buildSearchHref({
        q: query,
        page,
        filters,
        extra: { slettet: "feil" },
      }),
    );
  }

  revalidatePath("/sok");
  redirect(
    buildSearchHref({
      q: query,
      page,
      filters,
      extra: { slettet: "ok" },
    }),
  );
}
