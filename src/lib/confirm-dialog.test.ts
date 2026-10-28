import { describe, expect, it } from "vitest";
import {
  CONFIRM_DIALOG_DEFAULTS,
  resolveConfirmDialogConfig,
} from "./confirm-dialog";

describe("ConfirmDialog-standarder", () => {
  const labels = { confirm: "Bekreft", cancel: "Avbryt" };

  it("er nøytral og ikke destruktiv som standard", () => {
    expect(CONFIRM_DIALOG_DEFAULTS.danger).toBe(false);
    expect(CONFIRM_DIALOG_DEFAULTS.confirmLabelKey).toBe(
      "components.confirm.confirm",
    );

    expect(resolveConfirmDialogConfig({}, labels)).toEqual({
      confirmLabel: "Bekreft",
      cancelLabel: "Avbryt",
      danger: false,
    });
  });

  it("lar destruktive kall eksplisitt velge farefarge og slettetekst", () => {
    expect(
      resolveConfirmDialogConfig(
        { confirmLabel: "Slett", danger: true },
        labels,
      ),
    ).toEqual({
      confirmLabel: "Slett",
      cancelLabel: "Avbryt",
      danger: true,
    });
  });

  it("beholder eksplisitt danger=false for ikke-destruktive kall", () => {
    expect(
      resolveConfirmDialogConfig({ danger: false }, labels).danger,
    ).toBe(false);
  });
});
