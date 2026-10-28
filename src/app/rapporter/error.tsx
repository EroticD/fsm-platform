"use client";

import { LocalizedRouteError } from "@/components/RouteError";

export default function Error({
  error,
  reset,
  retry,
}: {
  error: unknown;
  reset?: () => void;
  retry?: () => void;
}) {
  return (
    <LocalizedRouteError
      error={error}
      reset={reset}
      retry={retry}
      scope="rapporter"
    />
  );
}
