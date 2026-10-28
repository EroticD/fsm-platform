/**
 * Resultatet av en invitasjonshandling (opprett bruker, ny lenke eller
 * kundeportal-invitasjon).
 *
 * Den rå invitasjonsnøkkelen returneres bare til den autentiserte siden som
 * utførte handlingen, slik at den kan vises én gang i sideinnholdet. Den skal
 * aldri legges i en URL, query-streng eller logg.
 */
export type InviteActionState =
  | { status: "idle" }
  | {
      status: "invite";
      inviteUrl: string;
      mailSent: boolean;
      name: string;
    }
  | { status: "error" };

/** Etikettene komponenten trenger, ferdig oversatt på serveren. */
export type InviteActionLabels = {
  /** Tekst med `{name}` som plassholder. */
  ready: string;
  sent: string;
  manual: string;
  copy: string;
  error: string;
};
