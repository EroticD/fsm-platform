import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import {
  isLineCommentKey,
  needsComment,
  parseImageUrls,
  readLineComment,
} from "@/lib/report-answers";

type TemplateFieldDef = {
  id: string;
  type?: string;
  label?: string;
  required?: boolean;
  options?: string[];
  commentOptions?: string[];
};

type WorkOrderTemplate = {
  id: string;
  title: string;
  fieldsJson: string | null;
};

type ReportUnit = {
  id: string;
  label: string;
  serialNumber?: string | null;
  location?: string | null;
  status: string;
  answersJson: string;
  comment?: string | null;
};

type RawReport = {
  id: string;
  templateId?: string | null;
  dataJson?: string | null;
  comments?: string | null;
  createdAt?: string | Date | null;
  units?: ReportUnit[];
  technicianSignatureUrl?: string | null;
  technicianName?: string | null;
  customerSignatureUrl?: string | null;
  customerName?: string | null;
  /** Brukeren som fylte ut og låste rapporten (brukes hvis navnet ikke er skrevet inn). */
  lockedByName?: string | null;
};

type ReportBlock = {
  id: string;
  templateTitle: string | null;
  date: string | null;
  status: string;
  fields: TemplateFieldDef[];
  answers: Record<string, unknown>;
  units: ReportUnit[];
  comments?: string | null;
  /** Navnet på den som utførte jobben (signaturnavn, eller brukeren som lagret). */
  technician: string | null;
  technicianSignatureUrl?: string | null;
  technicianName?: string | null;
  customerSignatureUrl?: string | null;
  customerName?: string | null;
};

/**
 * Selve PDF-innholdet for en servicerapport.
 *
 * Komponenten er bevisst uten "use client": den brukes både av server-ruten
 * /api/rapporter/[id]/pdf (renderToBuffer) og kan brukes i nettleseren.
 */
export default function ReportDocument({
  data,
  globalLogoUrl,
  globalPrimaryColor,
  globalCompanyName,
  baseUrl,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  globalLogoUrl?: string | null;
  globalPrimaryColor?: string;
  globalCompanyName?: string;
  /** F.eks. "https://fsm.example.com" – brukes til å gjøre /uploads/... absolutt. */
  baseUrl?: string;
}) {
  // `data` er oppdraget, med rapportene sine i `reports`.
  const workOrder = data.workOrder || data || {};
  const reports: RawReport[] = data.reports || (data.report ? [data.report] : []);
  const templates: WorkOrderTemplate[] = workOrder.templates || [];

  const blocks: ReportBlock[] = reports.map((report) => {
    let parsed: { status?: string; answers?: Record<string, unknown> } = {};
    try {
      const json = JSON.parse(report.dataJson || "{}");
      if (json && typeof json === "object" && !Array.isArray(json)) parsed = json;
    } catch {}

    const template = templates.find((t) => t.id === report.templateId) || null;
    let fields: TemplateFieldDef[] = [];
    try {
      const p = JSON.parse(template?.fieldsJson || "[]");
      if (Array.isArray(p)) fields = p;
    } catch {}

    return {
      id: report.id,
      templateTitle: template?.title ?? null,
      date: report.createdAt ? new Date(report.createdAt).toLocaleDateString("no-NO") : null,
      status: parsed.status || "UKJENT",
      fields,
      answers: parsed.answers || {},
      units: report.units || [],
      comments: report.comments,
      // "Utførende tekniker": navnet montøren skrev ved signaturen, ellers
      // brukeren som fylte ut og låste rapporten.
      technician:
        (report.technicianName || report.lockedByName || "").trim() || null,
      technicianSignatureUrl: report.technicianSignatureUrl,
      technicianName: report.technicianName,
      customerSignatureUrl: report.customerSignatureUrl,
      customerName: report.customerName,
    };
  });

  const knownStatuses = blocks.map((b) => b.status).filter((s) => s !== "UKJENT");
  const overallStatus =
    knownStatuses.length === 0 ? "UKJENT" : knownStatuses.includes("AVVIK") ? "AVVIK" : "GODKJENT";
  const totalUnits = blocks.reduce((sum, b) => sum + b.units.length, 0);
  const customer = workOrder.customer || data.customer || {};

  // Hvem som utførte jobben: navnene fra rapportene (signatur eller brukeren som
  // lagret). Bare hvis ingen rapport har navn, faller vi tilbake på montørene
  // som er tildelt oppdraget og den som opprettet det.
  const assignedTechnicians: Array<{ name?: string | null }> = workOrder.technicians || [];
  const uniqueNames = (names: Array<string | null | undefined>) =>
    Array.from(new Set(names.map((n) => (n || "").trim()).filter(Boolean)));

  const technicianNamesFromReports = uniqueNames(blocks.map((b) => b.technician));
  const technicianNames =
    technicianNamesFromReports.length > 0
      ? technicianNamesFromReports
      : uniqueNames([
          ...assignedTechnicians.map((t) => t?.name),
          workOrder.creatorName ? String(workOrder.creatorName) : null,
        ]);

  const brandColor = globalPrimaryColor || "#2563eb";
  const logoUrl = globalLogoUrl || null;
  const companyName = globalCompanyName || "FSM System";

  const answerText = (field: TemplateFieldDef | null, answer: unknown): string => {
    if (field?.type === "CHECKBOX") return answer ? "Ja / utført" : "Nei / ikke krysset av";
    if (field?.type === "IMAGE") return "Se vedlagt bilde";
    if (answer === undefined || answer === null || answer === "") return "Ikke besvart";
    return String(answer);
  };
  /** Relativ bilde-URL (/uploads/...) må gjøres absolutt for at PDF-en skal kunne hente den. */
  const absoluteUrl = (url: string) => {
    if (/^(https?:|data:)/.test(url)) return url;
    const origin =
      baseUrl ?? (typeof window !== "undefined" ? window.location.origin : "");
    return `${origin}${url}`;
  };

  /** Gjør sjekkpunktene om til rader som er enkle å tegne i PDF-en. */
  const buildRows = (fields: TemplateFieldDef[], answers: Record<string, unknown>) => {
    const rows =
      fields.length > 0
        ? fields.map((field) => ({ label: field.label ?? "", value: answers[field.id], field }))
        : Object.entries(answers)
            // Kommentarer til en linje vises sammen med linjen, ikke som eget punkt.
            .filter(([key]) => !isLineCommentKey(key))
            .map(([label, value]) => ({
              label,
              value,
              field: null as TemplateFieldDef | null,
            }));

    return rows.map((row) => {
      const comment = row.field ? readLineComment(answers, row.field.id) : "";
      return {
        label: row.label,
        text: answerText(row.field, row.value),
        comment,
        // Avvik/utbedring markeres i rødt i PDF-en.
        alert: Boolean(row.field) && needsComment(row.field as TemplateFieldDef, row.value),
        images:
          row.field?.type === "IMAGE"
            ? parseImageUrls(row.value).map((url) => absoluteUrl(url))
            : [],
      };
    });
  };

  const styles = StyleSheet.create({
    page: { padding: 40, fontFamily: 'Helvetica' },

    headerContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 30,
      borderBottom: `3px solid ${brandColor}`,
      paddingBottom: 15
    },
    headerText: { fontSize: 24, color: brandColor, fontWeight: 'bold', textAlign: 'right' },
    logo: { maxHeight: 60, maxWidth: 160, objectFit: 'contain' },
    // Tittel og firmanavn står til høyre i toppen av rapporten.
    headerTextBlock: { alignItems: 'flex-end' },
    companyName: { fontSize: 10, color: '#6b7280', fontWeight: 'bold', textTransform: 'uppercase', textAlign: 'right' },

    section: { marginBottom: 20 },
    label: { fontSize: 10, color: '#6b7280', marginBottom: 4, textTransform: 'uppercase' },
    value: { fontSize: 12, color: '#111827', marginBottom: 8 },
    checklistItem: { fontSize: 12, color: '#111827', marginBottom: 4 },

    infoGrid: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 20
    },
    infoBox: {
      flex: 1,
      paddingRight: 20
    },

    statusBox: {
      padding: 10,
      borderRadius: 4,
      marginBottom: 20,
      borderWidth: 1,
      borderColor: overallStatus === "AVVIK" ? '#fecaca' : overallStatus === "GODKJENT" ? '#bbf7d0' : '#e5e7eb',
      backgroundColor: overallStatus === "AVVIK" ? '#fef2f2' : overallStatus === "GODKJENT" ? '#f0fdf4' : '#f9fafb'
    },
    statusText: {
      fontSize: 12,
      fontWeight: 'bold',
      color: overallStatus === "AVVIK" ? '#991b1b' : overallStatus === "GODKJENT" ? '#166534' : '#374151'
    },

    reportTitle: { fontSize: 13, fontWeight: 'bold', color: '#111827', marginBottom: 10 },

    unitCard: {
      borderWidth: 1,
      borderColor: '#e5e7eb',
      borderRadius: 4,
      marginBottom: 14
    },
    unitHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: '#f9fafb',
      padding: 10,
      borderBottomWidth: 1,
      borderBottomColor: '#e5e7eb'
    },
    unitTitle: { fontSize: 12, fontWeight: 'bold', color: '#111827' },
    unitMeta: { fontSize: 9, color: '#6b7280', marginTop: 2 },
    unitStatus: {
      fontSize: 9,
      fontWeight: 'bold',
      paddingVertical: 3,
      paddingHorizontal: 8,
      borderRadius: 10
    },
    unitBody: { padding: 10 },
    answerRow: { fontSize: 11, color: '#111827', marginBottom: 5 },
    answerLabel: { fontWeight: 'bold' },
    lineComment: { fontSize: 10, color: '#92400e', fontStyle: 'italic', marginBottom: 5 },
    imageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4, marginBottom: 6 },
    answerImage: { width: 165, height: 120, objectFit: 'contain' },
    unitComment: {
      fontSize: 11,
      color: '#374151',
      fontStyle: 'italic',
      padding: 10,
      backgroundColor: '#f9fafb',
      borderTopWidth: 1,
      borderTopColor: '#e5e7eb'
    },

    signatureGrid: { flexDirection: 'row', justifyContent: 'space-between' },
    signatureBox: {
      width: '48%',
      borderWidth: 1,
      borderColor: '#e5e7eb',
      borderRadius: 4,
      padding: 10
    },
    signatureImage: { width: 200, height: 60, objectFit: 'contain', marginTop: 6, marginBottom: 4 },
    signatureLine: { borderTopWidth: 1, borderTopColor: '#9ca3af', marginTop: 8, paddingTop: 4, fontSize: 10, color: '#111827' },
    signatureMissing: { fontSize: 10, color: '#9ca3af', fontStyle: 'italic', marginTop: 8 },

    footer: {
      marginTop: 40,
      borderTop: `1px solid #e5e7eb`,
      paddingTop: 20
    },
    footerText: {
      fontSize: 8,
      color: '#6b7280'
    }
  });

  const signatureBox = (label: string, url?: string | null, name?: string | null) => (
    <View style={styles.signatureBox} wrap={false}>
      <Text style={styles.label}>{label}</Text>
      {url ? (
        // react-pdf tegner <Image> inn i PDF-en, ikke i DOM-en (og støtter ikke alt)
        // eslint-disable-next-line jsx-a11y/alt-text
        <Image src={url} style={styles.signatureImage} />
      ) : (
        <Text style={styles.signatureMissing}>Ikke signert</Text>
      )}
      <Text style={styles.signatureLine}>{name || "—"}</Text>
    </View>
  );

  /** Sjekkpunkt med eventuelle vedlagte bilder (én eller flere per felt). */
  const answerBlock = (
    row: { label: string; text: string; comment?: string; alert?: boolean; images: string[] },
    index: number,
    textStyle: { fontSize: number; color: string; marginBottom: number },
  ) => (
    <View key={index} style={{ marginBottom: 4 }}>
      <Text style={row.alert ? { ...textStyle, color: "#991b1b", fontWeight: "bold" } : textStyle}>
        <Text style={styles.answerLabel}>{row.label}: </Text>
        {row.text}
      </Text>
      {row.comment ? (
        <Text style={styles.lineComment}>» Kommentar: {row.comment}</Text>
      ) : null}
      {row.images.length > 0 && (
        <View style={styles.imageRow}>
          {row.images.map((src, i) => (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image key={i} src={src} style={styles.answerImage} />
          ))}
        </View>
      )}
    </View>
  );

  return (
    <Document>
      <Page size="A4" style={styles.page}>

        {/* HEADER: logo til venstre, tittel og firmanavn til høyre */}
        <View style={styles.headerContainer}>
          {logoUrl ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={logoUrl} style={styles.logo} />
          ) : (
            <View />
          )}
          <View style={styles.headerTextBlock}>
            <Text style={styles.headerText}>Servicerapport</Text>
            <Text style={styles.companyName}>{companyName}</Text>
          </View>
        </View>

        {/* KUNDE OG OPPDRAGSINFO */}
        <View style={styles.infoGrid}>
          <View style={styles.infoBox}>
            <Text style={styles.label}>Kunde</Text>
            <Text style={styles.value}>{customer.name || "Ikke angitt"}</Text>
            {customer.address && <Text style={styles.value}>{customer.address}, {customer.city}</Text>}
            {customer.phone && <Text style={styles.value}>{customer.phone}</Text>}
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.label}>Oppdrag</Text>
            <Text style={styles.value}>{workOrder.title || "Ikke angitt"}</Text>
            <Text style={styles.value}>Status: {workOrder.status || 'Ukjent'}</Text>
            <Text style={styles.value}>
              Dato: {workOrder.scheduledFor ? new Date(workOrder.scheduledFor).toLocaleDateString("no-NO") : "Ingen dato"}
            </Text>
            <Text style={styles.value}>
              Utførende tekniker: {technicianNames.length > 0 ? technicianNames.join(", ") : "Ikke angitt"}
            </Text>
          </View>
        </View>

        {/* SAMLET RESULTAT */}
        <View style={styles.statusBox}>
          <Text style={styles.statusText}>
            {overallStatus === "GODKJENT" ? "Godkjent / utført" : overallStatus === "AVVIK" ? "Avvik funnet" : "Ukjent resultat"}
            {totalUnits > 0 ? ` – ${totalUnits} ${totalUnits === 1 ? "enhet" : "enheter"} kontrollert` : ""}
          </Text>
        </View>

        {/* ÉN SEKSJON PER UTFYLT SJEKKLISTE */}
        {blocks.map((block, blockIndex) => (
          <View key={block.id} style={styles.section} wrap>
            {blocks.length > 1 || block.templateTitle ? (
              <Text style={styles.reportTitle}>
                {block.templateTitle || `Sjekkliste ${blockIndex + 1}`}
                {block.date ? `  •  ${block.date}` : ""}
                {block.status !== "UKJENT" ? (block.status === "AVVIK" ? "  –  Avvik" : "  –  Godkjent") : ""}
              </Text>
            ) : null}

            {/* Enheter med sine egne sjekkpunkter */}
            {block.units.map((unit, index) => {
              let answers: Record<string, unknown> = {};
              try {
                answers = JSON.parse(unit.answersJson || "{}");
              } catch {}

              const rows = buildRows(block.fields, answers);

              return (
                <View key={unit.id} style={styles.unitCard} wrap={false}>
                  <View style={styles.unitHeader}>
                    <View>
                      <Text style={styles.unitTitle}>{index + 1}. {unit.label}</Text>
                      <Text style={styles.unitMeta}>
                        {unit.serialNumber ? `SN: ${unit.serialNumber}` : "Uten serienummer"}
                        {unit.location ? `  •  ${unit.location}` : ""}
                      </Text>
                    </View>
                    <Text
                      style={{
                        ...styles.unitStatus,
                        backgroundColor: unit.status === "AVVIK" ? '#fee2e2' : '#dcfce7',
                        color: unit.status === "AVVIK" ? '#991b1b' : '#166534'
                      }}
                    >
                      {unit.status === "AVVIK" ? "AVVIK" : "GODKJENT"}
                    </Text>
                  </View>

                  <View style={styles.unitBody}>
                    {rows.map((row, i) => answerBlock(row, i, styles.answerRow))}
                  </View>

                  {unit.comment && <Text style={styles.unitComment}>{unit.comment}</Text>}
                </View>
              );
            })}

            {/* Eldre rapporter uten enheter */}
            {block.units.length === 0 && block.fields.length > 0 && (
              <View style={styles.unitBody}>
                {buildRows(block.fields, block.answers).map((row, i) =>
                  answerBlock(row, i, styles.checklistItem),
                )}
              </View>
            )}

            {block.comments && (
              <View style={{ marginTop: 10 }}>
                <Text style={styles.label}>Montørens kommentar</Text>
                <Text style={styles.value}>{block.comments}</Text>
              </View>
            )}

            {/* Signaturer: holdes samlet og dyttes til neste side om det blir for trangt */}
            <View style={{ ...styles.signatureGrid, marginTop: 10 }} wrap={false} minPresenceAhead={120}>
              {signatureBox("Montør / tekniker", block.technicianSignatureUrl, block.technicianName)}
              {signatureBox("Kunde", block.customerSignatureUrl, block.customerName)}
            </View>
          </View>
        ))}

        {/* FOOTER */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            {companyName} - {new Date().toLocaleDateString('no-NO')}
          </Text>
          <Text style={styles.footerText}>
            Generert av FSM-plattformen
          </Text>
        </View>
      </Page>
    </Document>
  );
}
