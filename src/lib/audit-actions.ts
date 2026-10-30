/**
 * Oversetter revisjonsloggens handlingsstrenger ved visning.
 *
 * Handlingsfeltet i `AuditLog` er lagret som ferdig norsk tekst, med tittel,
 * navn og antall flettet inn. Vi endrer ikke lagrede rader (det ville krevd en
 * migrering og gjort eldre logger uleselige), men gjenkjenner de stabile
 * mønstrene fra tjenestelaget og oversetter dem ved render. Ukjente handlinger
 * faller tilbake til den lagrede teksten, slik at historikken alltid vises.
 *
 * i18n-ignore-file: de norske strengene under er mønstre som matches mot
 * lagrede data, ikke UI-tekst.
 */
export type AuditTranslator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

type Rule = {
  pattern: RegExp;
  translate: (match: RegExpExecArray, t: AuditTranslator) => string;
};

const rules: Rule[] = [
  // ------------------------------------------------------------------ oppdrag
  {
    pattern:
      /^(?:Kontoret|Montør) endret status til: (OPEN|PENDING|PLANNED|WAITING|IN_PROGRESS|COMPLETED|CANCELLED)$/,
    translate: (m, t) => {
      const statusKeys: Record<string, string> = {
        OPEN: "orders.detail.statusOpen",
        PENDING: "orders.detail.statusPending",
        PLANNED: "orders.detail.statusPlanned",
        WAITING: "orders.detail.statusWaiting",
        IN_PROGRESS: "orders.detail.statusInProgress",
        COMPLETED: "orders.detail.statusCompleted",
        CANCELLED: "orders.detail.statusCancelled",
      };
      return t("auditActions.workOrder.statusChanged", {
        status: t(statusKeys[m[1]] ?? m[1]),
      });
    },
  },
  {
    pattern: /^Kontoret opprettet nytt oppdrag: (.*)$/,
    translate: (m, t) => t("auditActions.workOrder.created", { title: m[1] }),
  },
  {
    pattern: /^Oppdaterte oppdraget: (.*)$/,
    translate: (m, t) => t("auditActions.workOrder.updated", { title: m[1] }),
  },
  {
    pattern: /^Endret dato til (.*)$/,
    translate: (m, t) =>
      t("auditActions.workOrder.dateChanged", { range: m[1] }),
  },
  {
    pattern: /^La til en sjekkliste på oppdraget$/,
    translate: (_m, t) => t("auditActions.workOrder.checklistAdded"),
  },
  {
    pattern: /^La til kommentar: "(.*)"$/,
    translate: (m, t) =>
      t("auditActions.workOrder.commentAdded", { snippet: m[1] }),
  },
  {
    pattern: /^Oppdaterte tags: (.*)$/,
    translate: (m, t) =>
      t("auditActions.workOrder.tagsUpdated", { tags: m[1] }),
  },
  {
    pattern: /^Valgte kontaktperson: (.*)$/,
    translate: (m, t) =>
      t("auditActions.workOrder.contactSelected", { name: m[1] }),
  },
  {
    pattern: /^Fjernet kontaktpersonen fra oppdraget$/,
    translate: (_m, t) => t("auditActions.workOrder.contactRemoved"),
  },
  {
    pattern: /^La til kontaktperson: (.*)$/,
    translate: (m, t) => t("auditActions.contact.created", { name: m[1] }),
  },
  {
    pattern: /^La til (.+) som montør$/,
    translate: (m, t) =>
      t("auditActions.workOrder.technicianAdded", { name: m[1] }),
  },
  {
    pattern: /^La til (.+) på oppdraget$/,
    translate: (m, t) =>
      t("auditActions.workOrder.personAdded", { name: m[1] }),
  },
  {
    pattern: /^Fjernet (.+) fra oppdraget$/,
    translate: (m, t) =>
      t("auditActions.workOrder.personRemoved", { name: m[1] }),
  },
  {
    pattern: /^Klonet oppdraget «(.*)» til nytt oppdrag$/,
    translate: (m, t) => t("auditActions.workOrder.cloned", { title: m[1] }),
  },
  {
    pattern: /^Slo på bevaringsplikt for oppdraget «(.*)»$/,
    translate: (m, t) =>
      t("auditActions.workOrder.legalHoldOn", { title: m[1] }),
  },
  {
    pattern:
      /^Slo av bevaringsplikt for oppdraget «(.*)» \(rapporter beholder sin egen bevaringsplikt\)$/,
    translate: (m, t) =>
      t("auditActions.workOrder.legalHoldOff", { title: m[1] }),
  },
  {
    pattern: /^Slo på bevaringsplikt for rapporten «(.*)»$/,
    translate: (m, t) =>
      t("auditActions.workOrder.reportLegalHoldOn", { name: m[1] }),
  },
  {
    pattern: /^Slo av bevaringsplikt for rapporten «(.*)»$/,
    translate: (m, t) =>
      t("auditActions.workOrder.reportLegalHoldOff", { name: m[1] }),
  },
  {
    pattern:
      /^Slettet oppdraget «(.*)»(?: \((.*)\))? \(myk sletting – kan gjenopprettes\)$/,
    translate: (m, t) =>
      t("auditActions.workOrder.deleted", {
        title: m[1],
        customer: m[2] || "none",
      }),
  },
  {
    pattern: /^Gjenopprettet oppdraget «(.*)»$/,
    translate: (m, t) => t("auditActions.workOrder.restored", { title: m[1] }),
  },

  // ------------------------------------------------------------------ visitt
  {
    pattern: /^Opprettet visitt: (.*) \((.*)\)$/,
    translate: (m, t) =>
      t("auditActions.visit.created", { title: m[1], range: m[2] }),
  },
  {
    pattern: /^Oppdaterte visitten: (.*) \((.*)\)$/,
    translate: (m, t) =>
      t("auditActions.visit.updated", { title: m[1], range: m[2] }),
  },
  {
    pattern: /^Flyttet visitt: (.*) \((.*)\)$/,
    translate: (m, t) =>
      t("auditActions.visit.moved", { title: m[1], range: m[2] }),
  },
  {
    pattern: /^Tildelte montør: (.*)$/,
    translate: (m, t) => t("auditActions.visit.assigned", { names: m[1] }),
  },
  {
    pattern: /^Fjernet montør: (.*)$/,
    translate: (m, t) => t("auditActions.visit.unassigned", { names: m[1] }),
  },
  {
    pattern:
      /^Endret visittstatus: (PLANNED|ASSIGNED|EN_ROUTE|ON_SITE|DONE|CANCELLED) → (PLANNED|ASSIGNED|EN_ROUTE|ON_SITE|DONE|CANCELLED)$/,
    translate: (m, t) => {
      const statusKeys: Record<string, string> = {
        PLANNED: "visits.status.planned",
        ASSIGNED: "visits.status.assigned",
        EN_ROUTE: "visits.status.enRoute",
        ON_SITE: "visits.status.onSite",
        DONE: "visits.status.done",
        CANCELLED: "visits.status.cancelled",
      };
      return t("auditActions.visit.statusChanged", {
        from: t(statusKeys[m[1]] ?? m[1]),
        to: t(statusKeys[m[2]] ?? m[2]),
      });
    },
  },
  {
    pattern: /^Slettet visitt: (.*) \((.*)\)$/,
    translate: (m, t) =>
      t("auditActions.visit.deleted", { title: m[1], range: m[2] }),
  },

  // ----------------------------------------------------------------- rapport
  {
    pattern: /^Kundens kvittering ble trukket tilbake ved ny innsending$/,
    translate: (_m, t) =>
      t("auditActions.report.acknowledgementWithdrawnResubmit"),
  },
  {
    pattern: /^Kundens kvittering ble trukket tilbake ved opplåsing$/,
    translate: (_m, t) =>
      t("auditActions.report.acknowledgementWithdrawnUnlock"),
  },
  {
    pattern: /^Tildelte rapportnummer (.*)$/,
    translate: (m, t) =>
      t("auditActions.report.numberAssigned", { number: m[1] }),
  },
  {
    pattern:
      /^Opprettet automatisk utbedringsoppdrag for (\d+) avvik fra rapporten «(.*)»$/,
    translate: (m, t) =>
      t("auditActions.report.remediationCreated", {
        count: Number(m[1]),
        name: m[2],
      }),
  },
  {
    pattern: /^Låste rapporten igjen$/,
    translate: (_m, t) => t("auditActions.report.locked"),
  },
  {
    pattern:
      /^Låste opp rapporten slik at den kan rettes \(sporbarhet: endringer logges\)$/,
    translate: (_m, t) => t("auditActions.report.unlocked"),
  },
  {
    pattern:
      /^(Rapport oppdatert|Kontoret fylte ut skjema|Montør fylte ut skjema): (.*) \((.*)\) – rapporten låses automatisk$/,
    translate: (m, t) => {
      const baseKey =
        m[1] === "Rapport oppdatert"
          ? "auditActions.report.savedUpdated"
          : m[1] === "Kontoret fylte ut skjema"
            ? "auditActions.report.savedOffice"
            : "auditActions.report.savedTechnician";
      const details = /^(?:(\d+) enheter?|uten enheter)(?:, (avvik|godkjent))?$/.exec(
        m[3],
      );
      if (!details) {
        return t(baseKey, { title: m[2], details: m[3] });
      }
      const units = details[1]
        ? t("auditActions.report.units", { count: Number(details[1]) })
        : t("auditActions.report.noUnits");
      const status =
        details[2] === "avvik"
          ? t("auditActions.report.deviation")
          : details[2] === "godkjent"
            ? t("auditActions.report.approved")
            : null;
      return t(baseKey, {
        title: m[2],
        details: status ? `${units}, ${status}` : units,
      });
    },
  },

  // ------------------------------------------------------------------ kunde
  {
    pattern: /^Opprettet kunde: (.*)$/,
    translate: (m, t) => t("auditActions.customer.created", { name: m[1] }),
  },
  {
    pattern: /^Endret kundeinformasjon: (.*)$/,
    translate: (m, t) => t("auditActions.customer.updated", { name: m[1] }),
  },
  {
    pattern: /^Endret kontaktperson: (.*)$/,
    translate: (m, t) => t("auditActions.contact.updated", { name: m[1] }),
  },
  {
    pattern: /^Slettet kontaktperson: (.*)$/,
    translate: (m, t) => t("auditActions.contact.deleted", { name: m[1] }),
  },
  {
    pattern: /^La til enhet: (.*?)(?: \(SN: (.*)\))?$/,
    translate: (m, t) =>
      t("auditActions.unit.added", { model: m[1], serial: m[2] || "none" }),
  },
  {
    pattern: /^Oppdaterte enhet: (.*?)(?: \(SN: (.*)\))?$/,
    translate: (m, t) =>
      t("auditActions.unit.updated", { model: m[1], serial: m[2] || "none" }),
  },
  {
    pattern: /^Slettet enhet: (.*?)(?: \(SN: (.*)\))?$/,
    translate: (m, t) =>
      t("auditActions.unit.deleted", { model: m[1], serial: m[2] || "none" }),
  },
  {
    pattern: /^Opprettet serviceavtale: (.*) \((.*)\)$/,
    translate: (m, t) =>
      t("auditActions.contract.created", {
        title: m[1],
        interval: m[2],
      }),
  },
  {
    pattern: /^Aktiverte serviceavtale: (.*)$/,
    translate: (m, t) =>
      t("auditActions.contract.activated", { title: m[1] }),
  },
  {
    pattern: /^Pauset serviceavtale: (.*)$/,
    translate: (m, t) => t("auditActions.contract.paused", { title: m[1] }),
  },
  {
    pattern: /^Slettet serviceavtale: (.*)$/,
    translate: (m, t) =>
      t("auditActions.contract.deleted", { title: m[1] }),
  },
  {
    pattern: /^La ved fil: (.*)$/,
    translate: (m, t) => t("auditActions.attachment.added", { name: m[1] }),
  },
  {
    pattern: /^Slettet vedlegg: (.*)$/,
    translate: (m, t) =>
      t("auditActions.attachment.deleted", { name: m[1] }),
  },
  {
    pattern:
      /^Slettet kunden «(.*)» \(myk sletting – kan gjenopprettes\)$/,
    translate: (m, t) => t("auditActions.customer.deleted", { name: m[1] }),
  },
  {
    pattern: /^Gjenopprettet kunden «(.*)»$/,
    translate: (m, t) => t("auditActions.customer.restored", { name: m[1] }),
  },

  // --------------------------------------------------------------- innlogging
  {
    pattern: /^Logget inn$/,
    translate: (_m, t) => t("auditActions.auth.login"),
  },
  {
    pattern: /^Logget inn med gjenopprettingskode$/,
    translate: (_m, t) => t("auditActions.auth.loginRecovery"),
  },
  {
    pattern: /^Tilbakestilte passord med e-postlenke$/,
    translate: (_m, t) => t("auditActions.auth.passwordReset"),
  },
  {
    pattern: /^2FA: feilet verifisering$/,
    translate: (_m, t) => t("auditActions.security.twoFactorFailed"),
  },
  {
    pattern: /^2FA: oppsett utløpt$/,
    translate: (_m, t) => t("auditActions.security.twoFactorSetupExpired"),
  },
  {
    pattern: /^Startet oppsett av to-trinns verifisering$/,
    translate: (_m, t) => t("auditActions.security.twoFactorSetupStarted"),
  },
  {
    pattern: /^Avbrøt oppsett av to-trinns verifisering$/,
    translate: (_m, t) => t("auditActions.security.twoFactorSetupCancelled"),
  },
  {
    pattern: /^Slå på to-trinns verifisering$/,
    translate: (_m, t) => t("auditActions.security.twoFactorEnabled"),
  },
  {
    pattern: /^Slå av to-trinns verifisering$/,
    translate: (_m, t) => t("auditActions.security.twoFactorDisabled"),
  },
  {
    pattern: /^Genererte nye gjenopprettingskoder for to-trinns verifisering$/,
    translate: (_m, t) => t("auditActions.security.twoFactorRecoveryRegenerated"),
  },
  {
    pattern: /^Tilbaketstilte to-trinns verifisering for (.*)$/,
    translate: (m, t) =>
      t("auditActions.security.twoFactorReset", { name: m[1] }),
  },

  // -------------------------------------------------------------------- brukere
  {
    pattern: /^Opprettet bruker: (.*) \((.*)\)$/,
    translate: (m, t) =>
      t("auditActions.users.created", { name: m[1], role: m[2] }),
  },
  {
    pattern: /^Opprettet kundeportalbruker: (.*) \((.*)\)$/,
    translate: (m, t) =>
      t("auditActions.users.portalCreated", { name: m[1], email: m[2] }),
  },
  {
    pattern: /^Aktiverte bruker: (.*)$/,
    translate: (m, t) => t("auditActions.users.activated", { name: m[1] }),
  },
  {
    pattern: /^Deaktiverte bruker: (.*)$/,
    translate: (m, t) => t("auditActions.users.deactivated", { name: m[1] }),
  },
  {
    pattern: /^Aktiverte kundeportalbruker: (.*)$/,
    translate: (m, t) =>
      t("auditActions.users.portalActivated", { name: m[1] }),
  },
  {
    pattern: /^Deaktiverte kundeportalbruker: (.*)$/,
    translate: (m, t) =>
      t("auditActions.users.portalDeactivated", { name: m[1] }),
  },
  {
    pattern: /^Endret avdeling for (.*) til (.*)$/,
    translate: (m, t) =>
      t("auditActions.users.departmentChanged", {
        name: m[1],
        department: m[2],
      }),
  },
  {
    pattern: /^Endret rolle for (.*) til (.*)$/,
    translate: (m, t) =>
      t("auditActions.users.roleChanged", { name: m[1], role: m[2] }),
  },
  {
    pattern: /^Endret telefonnummer for (.*)$/,
    translate: (m, t) => t("auditActions.users.phoneChanged", { name: m[1] }),
  },
  {
    pattern: /^Genererte ny invitasjonslenke for: (.*)$/,
    translate: (m, t) =>
      t("auditActions.users.invitationCreated", { name: m[1] }),
  },
  {
    pattern: /^Sendte ny invitasjonslenke til kundeportalbruker: (.*)$/,
    translate: (m, t) =>
      t("auditActions.users.invitationResent", { name: m[1] }),
  },
  {
    pattern: /^Slettet bruker: (.*)$/,
    translate: (m, t) => t("auditActions.users.deleted", { name: m[1] }),
  },
  {
    pattern: /^Tilbakestilte rettigheter til rollen for (.*)$/,
    translate: (m, t) =>
      t("auditActions.users.permissionsReset", { name: m[1] }),
  },

  // ------------------------------------------------------------------ avdelinger
  {
    pattern: /^Opprettet avdeling: (.*)$/,
    translate: (m, t) => t("auditActions.departments.created", { name: m[1] }),
  },
  {
    pattern: /^Oppdaterte avdeling: (.*) → (.*)$/,
    translate: (m, t) =>
      t("auditActions.departments.updated", { from: m[1], to: m[2] }),
  },
  {
    pattern: /^Aktiverte avdeling: (.*)$/,
    translate: (m, t) =>
      t("auditActions.departments.activated", { name: m[1] }),
  },
  {
    pattern: /^Deaktiverte avdeling: (.*)$/,
    translate: (m, t) =>
      t("auditActions.departments.deactivated", { name: m[1] }),
  },
  {
    pattern: /^Satte (.*) som standardavdeling$/,
    translate: (m, t) =>
      t("auditActions.departments.defaultChanged", { name: m[1] }),
  },

  // ---------------------------------------------------------------------- roller
  {
    pattern: /^Opprettet rolle: (.*) \((\d+) rettigheter\)$/,
    translate: (m, t) =>
      t("auditActions.roles.created", { label: m[1], count: Number(m[2]) }),
  },
  {
    pattern: /^Oppdaterte rolle: (.*) → (.*) \((\d+) rettigheter\)$/,
    translate: (m, t) =>
      t("auditActions.roles.updated", {
        from: m[1],
        to: m[2],
        count: Number(m[3]),
      }),
  },
  {
    pattern: /^Slettet rolle: (.*)$/,
    translate: (m, t) => t("auditActions.roles.deleted", { label: m[1] }),
  },

  // ------------------------------------------------------------------ dokumenter
  {
    pattern: /^Lastet opp dokument: (.*)$/,
    translate: (m, t) => t("auditActions.documents.uploaded", { title: m[1] }),
  },
  {
    pattern: /^Oppdaterte dokument: (.*)$/,
    translate: (m, t) => t("auditActions.documents.updated", { title: m[1] }),
  },
  {
    pattern: /^Gjenopprettet dokumentet «(.*)»$/,
    translate: (m, t) => t("auditActions.documents.restored", { title: m[1] }),
  },
  {
    pattern: /^Gjenopprettet tidligere versjon av dokument: (.*)$/,
    translate: (m, t) =>
      t("auditActions.documents.versionRestored", { title: m[1] }),
  },
  {
    pattern: /^Reindekserte dokumentet for fulltekst-søk$/,
    translate: (_m, t) => t("auditActions.documents.reindexed"),
  },
  {
    pattern: /^Slettet dokumentet «(.*)» \(myk sletting – kan gjenopprettes\)$/,
    translate: (m, t) => t("auditActions.documents.deleted", { title: m[1] }),
  },
  {
    pattern: /^Opprettet mappe: (.*)$/,
    translate: (m, t) =>
      t("auditActions.documents.folderCreated", { name: m[1] }),
  },
  {
    pattern: /^Flyttet mappen: (.*)$/,
    translate: (m, t) =>
      t("auditActions.documents.folderMoved", { name: m[1] }),
  },
  {
    pattern: /^Ga mappen nytt navn: (.*) → (.*)$/,
    translate: (m, t) =>
      t("auditActions.documents.folderRenamed", { from: m[1], to: m[2] }),
  },
  {
    pattern: /^Slettet mappe: (.*)$/,
    translate: (m, t) =>
      t("auditActions.documents.folderDeleted", { name: m[1] }),
  },
  {
    pattern: /^La til tagger på dokumentet «(.*)»: (.*)$/,
    translate: (m, t) =>
      t("auditActions.documents.tagsAdded", { title: m[1], tags: m[2] }),
  },
  {
    pattern: /^Flyttet dokumentet «(.*)» til mappen (.*)$/,
    translate: (m, t) =>
      t("auditActions.documents.movedToFolder", {
        title: m[1],
        folder: m[2],
      }),
  },
  {
    pattern: /^Flyttet dokumentet «(.*)» til rot$/,
    translate: (m, t) =>
      t("auditActions.documents.movedToRoot", { title: m[1] }),
  },

  // ------------------------------------------------------------------ innstillinger
  {
    pattern: /^Oppdaterte merkevareinnstillinger: (.*)$/,
    translate: (m, t) =>
      t("auditActions.settings.brandingUpdated", { company: m[1] }),
  },
  {
    pattern: /^Oppdaterte kartinnstillinger$/,
    translate: (_m, t) => t("auditActions.settings.mapUpdated"),
  },
  {
    pattern: /^Opprettet sjekkliste: (.*)$/,
    translate: (m, t) =>
      t("auditActions.templates.created", { title: m[1] }),
  },
  {
    pattern: /^Slettet sjekkliste: (.*)$/,
    translate: (m, t) =>
      t("auditActions.templates.deleted", { title: m[1] }),
  },
  {
    pattern: /^Blokkerte sletting av sjekklisten «(.*)» fordi den er i bruk$/,
    translate: (m, t) =>
      t("auditActions.templates.deleteBlocked", { title: m[1] }),
  },
  {
    pattern: /^Opprettet tag: (.*)$/,
    translate: (m, t) => t("auditActions.templates.tagCreated", { name: m[1] }),
  },
  {
    pattern: /^Oppdaterte tag: (.*) -> (.*)$/,
    translate: (m, t) =>
      t("auditActions.templates.tagUpdated", { from: m[1], to: m[2] }),
  },
  {
    pattern: /^Slettet tag: (.*)$/,
    translate: (m, t) => t("auditActions.templates.tagDeleted", { name: m[1] }),
  },
  {
    pattern: /^Opprettet dokument-tag: (.*)$/,
    translate: (m, t) =>
      t("auditActions.documents.tagCreated", { name: m[1] }),
  },
  {
    pattern: /^Oppdaterte dokument-tag: (.*) -> (.*)$/,
    translate: (m, t) =>
      t("auditActions.documents.tagUpdated", { from: m[1], to: m[2] }),
  },
  {
    pattern: /^Slettet dokument-tag: (.*)$/,
    translate: (m, t) =>
      t("auditActions.documents.tagDeleted", { name: m[1] }),
  },

  // ------------------------------------------------------------------- bemanning
  {
    pattern: /^Opprettet kompetanse: (.*)$/,
    translate: (m, t) =>
      t("auditActions.workforce.skillCreated", { label: m[1] }),
  },
  {
    pattern: /^Endret kompetanse: (.*)$/,
    translate: (m, t) =>
      t("auditActions.workforce.skillUpdated", { label: m[1] }),
  },
  {
    pattern: /^Slettet kompetanse: (.*)$/,
    translate: (m, t) =>
      t("auditActions.workforce.skillDeleted", { label: m[1] }),
  },
  {
    pattern: /^Oppdaterte kompetanse for (.*)$/,
    translate: (m, t) =>
      t("auditActions.workforce.userSkillUpdated", { name: m[1] }),
  },
  {
    pattern: /^Registrerte fravær for (.*)$/,
    translate: (m, t) =>
      t("auditActions.workforce.absenceCreated", { name: m[1] }),
  },
  {
    pattern: /^Endret fravær for (.*)$/,
    translate: (m, t) =>
      t("auditActions.workforce.absenceUpdated", { name: m[1] }),
  },
  {
    pattern: /^Slettet fravær for (.*)$/,
    translate: (m, t) =>
      t("auditActions.workforce.absenceDeleted", { name: m[1] }),
  },
  {
    pattern: /^Endret arbeidstid for (.*)$/,
    translate: (m, t) =>
      t("auditActions.workforce.availabilityUpdated", { name: m[1] }),
  },

  // ------------------------------------------------------------------ kundeportal
  {
    pattern: /^Kunde booket nytt oppdrag: (.*)$/,
    translate: (m, t) =>
      t("auditActions.portal.bookingCreated", { title: m[1] }),
  },
  {
    pattern: /^Kunden ba om ny tid$/,
    translate: (_m, t) => t("auditActions.portal.rescheduleRequested"),
  },
  {
    pattern: /^Kunden kansellerte bestillingen$/,
    translate: (_m, t) => t("auditActions.portal.bookingCancelled"),
  },
  {
    pattern: /^Kunden kvitterte for rapporten$/,
    translate: (_m, t) => t("auditActions.report.acknowledged"),
  },
  {
    pattern: /^Opprettet gjentagende oppdrag fra serviceavtalen «(.*)»$/,
    translate: (m, t) =>
      t("auditActions.contract.recurringCreated", { title: m[1] }),
  },
];

/**
 * Returnerer oversatt handling, eller `null` når strengen er ukjent (eldre
 * logger, egendefinerte handlinger eller handlinger fra andre tjenester).
 */
export function describeAuditAction(
  action: string,
  t: AuditTranslator,
): string | null {
  const value = String(action ?? "").trim();
  if (!value) return null;

  for (const rule of rules) {
    const match = rule.pattern.exec(value);
    if (match) return rule.translate(match, t);
  }
  return null;
}
