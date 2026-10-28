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
