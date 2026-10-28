/**
 * Standardverdier for bekreftelsesdialogen.
 *
 * Dialogen brukes til både destruktive og ikke-destruktive handlinger. Derfor
 * er standarden en nøytral bekreftelse uten rød farefarge. Handlinger som
 * sletter noe må eksplisitt sende `danger` og en slettetekst.
 */
export const CONFIRM_DIALOG_DEFAULTS = {
  confirmLabelKey: "components.confirm.confirm",
  cancelLabelKey: "components.confirm.cancel",
  danger: false,
} as const;

export type ConfirmDialogOptions = {
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

/** Slår sammen kallspesifikke valg med de nøytrale standardverdiene. */
export function resolveConfirmDialogConfig(
  options: ConfirmDialogOptions,
  labels: { confirm: string; cancel: string },
) {
  return {
    confirmLabel: options.confirmLabel ?? labels.confirm,
    cancelLabel: options.cancelLabel ?? labels.cancel,
    danger: options.danger ?? CONFIRM_DIALOG_DEFAULTS.danger,
  };
}
