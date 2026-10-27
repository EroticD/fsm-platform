import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import {
  isLineCommentKey,
  needsComment,
  parseImageUrls,
  parseJsonObject,
  readLineComment,
} from "@/lib/report-answers";
import {
  resolvePdfImageSource,
  type PdfImage,
} from "@/lib/report-images";
import { MarkdownPdf } from "@/lib/markdown-pdf";
import { formatDate } from "@/lib/dates";
import type { HmsFormType, TemplateCategory } from "@prisma/client";
import {
  HMS_TYPE_LABELS,
  reportTemplateCategoryOf,
} from "@/lib/template-categories";

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
  /** Frosset mal-navn/-innhold fra da rapporten ble signert. */
  templateTitle?: string | null;
  /** Rapportens eget visningsnavn, om malen har det. */
  name?: string | null;
  /** Automatisk rapportnummer for HMS-rapporter. */
  reportNumber?: string | null;
  /** Om rapporten er knyttet til enheter. Eldre rapporter mangler feltet. */
  requiresUnits?: boolean | null;
  /** Frosset kategori/type fra malen. Eldre rapporter mangler feltene. */
  templateCategory?: TemplateCategory | null;
  hmsType?: HmsFormType | null;
  templateSnapshotJson?: string | null;
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
  name: string | null;
  templateTitle: string | null;
  reportNumber: string | null;
  requiresUnits: boolean;
  category: TemplateCategory;
  hmsType: HmsFormType | null;
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

/** Opplysningene et sjekkpunkt arver fra enheten det hører til. */
type UnitContext = {
  key: string;
  checklist: string;
  requiresUnits: boolean;
  date: string | null;
  unitLabel: string | null;
  serialNumber: string | null;
  location: string | null;
  unitComment: string | null;
  status: string | null;
};

/** Et planlagt sjekkpunkt: innholdet, bildene og hvor det hører til. */
type PlannedRow = {
  label: string;
  text: string;
  /** Svaret som Markdown, når feltet er et fritekstfelt. */
  rich: string | null;
  comment: string;
  alert: boolean;
  isImage: boolean;
  urls: string[];
  rowIndex: number;
  context: UnitContext | null;
};

/** Et sjekkpunkt slik det tegnes, med nummererte miniatyrbilder. */
type PreparedRow = {
  label: string;
  text: string;
  rich: string | null;
  comment: string;
  alert: boolean;
  isImage: boolean;
  /** Numrene viser til vedleggssidene bakerst i rapporten. */
  images: Array<{ n: number; image: PdfImage }>;
};

type PlannedBlock = {
  block: ReportBlock;
  units: Array<{ unit: ReportUnit; index: number; rows: PlannedRow[] }>;
  legacy: PlannedRow[];
};

/** Ett vedlagt bilde, med opplysningene som sier hvor det hører til. */
type Attachment = {
  n: number;
  url: string;
  checklist: string;
  requiresUnits: boolean;
  date: string | null;
  unitLabel: string | null;
  serialNumber: string | null;
  location: string | null;
  point: string;
  comment: string;
  status: string | null;
};

/**
 * Selve PDF-innholdet for en servicerapport.
 *
 * Bilder vises som små miniatyrbilder på sjekkpunktet de hører til, og kommer i
 * tillegg på sin egen vedleggsside bakerst i rapporten – med sjekkliste,
 * sjekkpunkt og serienummer. Innholdet flyter over så mange sider det trenger.
 *
 * Komponenten er bevisst uten "use client": den brukes av server-ruten
 * /api/rapporter/[id]/pdf (renderToBuffer).
 */
export default function ReportDocument({
  data,
  globalLogoUrl,
  globalPrimaryColor,
  globalCompanyName,
  baseUrl,
  pdfImages,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  globalLogoUrl?: string | null;
  globalPrimaryColor?: string;
  globalCompanyName?: string;
  /** F.eks. "https://fsm.example.com" – brukes til å gjøre /uploads/... absolutt. */
  baseUrl?: string;
  /** Nedskalerte bilder, nøklet på den opprinnelige URL-en. */
  pdfImages?: Record<string, PdfImage>;
}) {
  // `data` er oppdraget, med rapportene sine i `reports`.
  const workOrder = data.workOrder || data || {};
  const reports: RawReport[] = data.reports || (data.report ? [data.report] : []);
  const templates: WorkOrderTemplate[] = workOrder.templates || [];

  const blocks: ReportBlock[] = reports.map((report) => {
    const parsed = parseJsonObject(report.dataJson);
    const template = templates.find((t) => t.id === report.templateId) || null;
    // Bruk øyeblikksbildet fra signeringstidspunktet. Den levende malen er bare
    // en fallback for rapporter som ble laget før snapshots ble innført.
    const fieldsSource = report.templateSnapshotJson ?? template?.fieldsJson ?? "[]";
    let fields: TemplateFieldDef[] = [];
    try {
      const p = JSON.parse(fieldsSource);
      if (Array.isArray(p)) fields = p;
    } catch {}

    return {
      id: report.id,
      name: report.name ?? report.templateTitle ?? template?.title ?? null,
      templateTitle: report.templateTitle ?? template?.title ?? null,
      reportNumber: report.reportNumber ?? null,
      requiresUnits: report.requiresUnits !== false,
      // Kategorien leses fra rapportens frosne felt, aldri fra den levende
      // malen. Mangler feltet (eldre rapport), er den SERVICE.
      category: reportTemplateCategoryOf(report),
      hmsType: report.hmsType ?? null,
      date: formatDate(report.createdAt) || null,
      status: typeof parsed.status === "string" && parsed.status ? parsed.status : "UKJENT",
      fields,
      answers:
        parsed.answers && typeof parsed.answers === "object" && !Array.isArray(parsed.answers)
          ? (parsed.answers as Record<string, unknown>)
          : {},
      units: report.units || [],
      comments: report.comments,
      // "Utførende tekniker": navnet montøren skrev ved signaturen, ellers
      // brukeren som fylte ut og låste rapporten.
      technician: (report.technicianName || report.lockedByName || "").trim() || null,
      technicianSignatureUrl: report.technicianSignatureUrl,
      technicianName: report.technicianName,
      customerSignatureUrl: report.customerSignatureUrl,
      customerName: report.customerName,
    };
  });

  // Bare rapporter med enheter har et godkjent/avvik-resultat. En rapport uten
  // enheter skal verken vises som godkjent eller avvik, selv om eldre rader
  // fortsatt har GODKJENT/AVVIK lagret.
  const unitBlocks = blocks.filter((b) => b.requiresUnits);
  const knownStatuses = unitBlocks.map((b) => b.status).filter((s) => s !== "UKJENT");
  const overallStatus =
    knownStatuses.length === 0
      ? "UKJENT"
      : knownStatuses.includes("AVVIK")
        ? "AVVIK"
        : "GODKJENT";
  const hasUnitReports = unitBlocks.length > 0;
  const totalUnits = unitBlocks.reduce((sum, b) => sum + b.units.length, 0);
  const customer = workOrder.customer || data.customer || {};
  // Én rapport gir et presist dokumentnavn; flere sjekklister på samme
  // oppdrag beholder den generelle tittelen.
  const documentTitle =
    blocks.length === 1 && blocks[0]?.name ? blocks[0].name : "Servicerapport";

  // Kategori/type vises i toppen av PDF-en. Én HMS-rapport får den konkrete
  // undertypen; et oppdrag med flere skjemaer får en nøytral merking.
  const hmsBlocks = blocks.filter((block) => block.category === "HMS");
  const hmsHeader =
    hmsBlocks.length === 0
      ? null
      : blocks.length === 1
        ? `HMS-dokumentasjon${
            hmsBlocks[0].hmsType
              ? ` · ${HMS_TYPE_LABELS[hmsBlocks[0].hmsType]}`
              : ""
          }`
        : "Inneholder HMS-dokumentasjon";

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

  /**
   * Bildet slik det skal tegnes.
   *
   * Bare bilder som allerede er bakt inn som data-URL, eller som ligger i
   * appens egen opplastingsmappe, får være med. Eksterne http(s)-adresser
   * avvises – PDF-motoren skal aldri hente ukjent innhold.
   */
  const pdfImage = (url: string): PdfImage | null =>
    resolvePdfImageSource(
      url,
      pdfImages,
      baseUrl ?? (typeof window !== "undefined" ? window.location.origin : ""),
    );

  const answerText = (field: TemplateFieldDef | null, answer: unknown): string => {
    if (field?.type === "CHECKBOX") return answer ? "Ja / utført" : "Nei / ikke krysset ut";
    if (field?.type === "IMAGE") return "";
    if (answer === undefined || answer === null || answer === "") return "Ikke besvart";
    return String(answer);
  };

  /** Felttypene der svaret kan være skrevet i Markdown (se components/MarkdownEditor). */
  const RICH_TEXT_TYPES = new Set(["TEXT", "TEXTAREA"]);

  /**
   * Sjekkpunktene i en sjekkliste, som enkle linjer å tegne. Bildene er bare
   * URL-er her; nummereringen til vedlegget skjer etterpå.
   */
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
      // Fritekstsvar kan inneholde Markdown og tegnes derfor av MarkdownPdf.
      const rich =
        row.field &&
        RICH_TEXT_TYPES.has(row.field.type ?? "") &&
        typeof row.value === "string" &&
        row.value.trim() !== ""
          ? row.value
          : null;

      return {
        label: row.label,
        text: rich ? "" : answerText(row.field, row.value),
        rich,
        comment,
        // Avvik/utbedring markeres i rødt i PDF-en.
        alert: Boolean(row.field) && needsComment(row.field as TemplateFieldDef, row.value),
        isImage: row.field?.type === "IMAGE",
        urls: row.field?.type === "IMAGE" ? parseImageUrls(row.value) : [],
        context: null as UnitContext | null,
      };
    });
  };

  /*
   * Alle sjekkpunkter i rapporten, i den rekkefølgen de vises. Bildene
   * nummereres etterpå ut fra denne listen, slik at nummeret på
   * miniatyrbildet og vedleggssiden alltid er det samme.
   */
  const planUnit = (
    fields: TemplateFieldDef[],
    answers: Record<string, unknown>,
    context: UnitContext,
  ): PlannedRow[] =>
    buildRows(fields, answers).map((row, rowIndex) => ({ ...row, rowIndex, context }));

  const planned: PlannedBlock[] = [];
  for (const block of blocks) {
    const checklist = block.name || block.templateTitle || `Sjekkliste ${block.id.slice(0, 6)}`;

    const units: Array<{ unit: ReportUnit; index: number; rows: PlannedRow[] }> = [];
    for (let index = 0; index < block.units.length; index += 1) {
      const unit = block.units[index];
      units.push({
        unit,
        index,
        rows: planUnit(block.fields, parseJsonObject(unit.answersJson), {
          key: `${block.id}::${unit.id}`,
          checklist,
          requiresUnits: block.requiresUnits,
          date: block.date,
          unitLabel: unit.label,
          serialNumber: unit.serialNumber ?? null,
          location: unit.location ?? null,
          unitComment: unit.comment ?? null,
          status: unit.status,
        }),
      });
    }

    // Eldre rapporter uten enheter.
    const legacy: PlannedRow[] =
      block.units.length === 0
        ? planUnit(block.fields, block.answers, {
            key: `${block.id}::uten-enhet`,
            checklist,
            requiresUnits: block.requiresUnits,
            date: block.date,
            unitLabel: null,
            serialNumber: null,
            location: null,
            unitComment: block.comments ?? null,
            status: block.status,
          })
        : [];

    planned.push({ block, units, legacy });
  }

  // Hvert vedlagte bilde, i den rekkefølgen de forekommer.
  const imageItems: PlannedRow[] = [];
  for (const entry of planned) {
    for (const { rows } of entry.units) {
      for (const row of rows) if (row.urls.length > 0) imageItems.push(row);
    }
    for (const row of entry.legacy) if (row.urls.length > 0) imageItems.push(row);
  }

  // Nummer på hvert bilde, og hvilke nummer hvert sjekkpunkt viser til.
  const rowKey = (row: PlannedRow) => `${row.context?.key ?? ""}|${row.rowIndex}`;
  const imageNumbers = new Map<string, number[]>();
  const attachments: Attachment[] = [];
  let imageNumber = 0;
  for (const row of imageItems) {
    const context = row.context!;
    for (const url of row.urls) {
      imageNumber += 1;
      imageNumbers.set(rowKey(row), [...(imageNumbers.get(rowKey(row)) ?? []), imageNumber]);
      attachments.push({
        n: imageNumber,
        url,
        checklist: context.checklist,
        requiresUnits: context.requiresUnits,
        date: context.date,
        unitLabel: context.unitLabel,
        serialNumber: context.serialNumber,
        location: context.location,
        point: row.label,
        comment: row.comment || context.unitComment || "",
        status: context.status,
      });
    }
  }

  /** Sjekkpunktet slik det tegnes: med numrene til bildene sine. */
  const prepareRow = (row: PlannedRow): PreparedRow => ({
    label: row.label,
    text: row.text,
    rich: row.rich,
    comment: row.comment,
    alert: row.alert,
    isImage: row.isImage,
    images: row.urls.flatMap((url, i) => {
      const image = pdfImage(url);
      return image
        ? [{ n: imageNumbers.get(rowKey(row))?.[i] ?? 0, image }]
        : [];
    }),
  });

  const styles = StyleSheet.create({
    page: { padding: 40, fontFamily: 'Helvetica', fontSize: 10 },

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
    headerHms: { fontSize: 9, color: '#374151', fontWeight: 'bold', marginTop: 2, textAlign: 'right' },
    headerOrder: { fontSize: 10, color: '#374151', fontWeight: 'bold', marginTop: 2, textAlign: 'right' },
    companyName: { fontSize: 10, color: '#6b7280', fontWeight: 'bold', textTransform: 'uppercase', textAlign: 'right' },

    section: { marginBottom: 20 },
    label: { fontSize: 10, color: '#6b7280', marginBottom: 4, textTransform: 'uppercase', lineHeight: 1.35 },
    value: { fontSize: 12, color: '#111827', marginBottom: 8, lineHeight: 1.35 },
    checklistItem: { fontSize: 12, color: '#111827', marginBottom: 4, lineHeight: 1.35 },

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
      color: overallStatus === "AVVIK" ? '#991b1b' : overallStatus === "GODKJENT" ? '#166534' : '#374151',
      lineHeight: 1.35
    },

    reportTitle: { fontSize: 13, fontWeight: 'bold', color: '#111827', marginBottom: 10, lineHeight: 1.35 },

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
    // Tittelen skal kunne brekke over flere linjer uten å kollidere med statusen.
    unitHeaderText: { flexGrow: 1, flexShrink: 1, paddingRight: 8 },
    unitTitle: { fontSize: 12, fontWeight: 'bold', color: '#111827', lineHeight: 1.35 },
    unitMeta: { fontSize: 9, color: '#6b7280', marginTop: 2, lineHeight: 1.35 },
    unitStatus: {
      fontSize: 9,
      fontWeight: 'bold',
      paddingVertical: 3,
      paddingHorizontal: 8,
      borderRadius: 10,
      flexShrink: 0
    },
    unitBody: { padding: 10 },
    answerRow: { fontSize: 11, color: '#111827', marginBottom: 5, lineHeight: 1.4 },
    answerLabel: { fontWeight: 'bold' },
    lineComment: { fontSize: 10, color: '#92400e', fontStyle: 'italic', marginBottom: 5, lineHeight: 1.4 },
    lineCommentBlock: { marginBottom: 5 },
    missingImage: { fontSize: 9, color: '#9ca3af', fontStyle: 'italic', marginBottom: 5, lineHeight: 1.4 },

    // Små miniatyrbilder på sjekkpunktet; det store bildet ligger på vedleggssiden.
    thumbGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 2, marginBottom: 6 },
    thumbBox: { marginRight: 6, marginBottom: 4, alignItems: 'center' },
    thumbImage: { width: 78, height: 58, objectFit: 'contain', borderWidth: 0.5, borderColor: '#d1d5db', borderRadius: 2 },
    thumbLabel: { fontSize: 7, color: '#6b7280', marginTop: 1, lineHeight: 1.2 },

    unitComment: {
      fontSize: 11,
      color: '#374151',
      fontStyle: 'italic',
      padding: 10,
      lineHeight: 1.4,
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
    signatureLine: { borderTopWidth: 1, borderTopColor: '#9ca3af', marginTop: 8, paddingTop: 4, fontSize: 10, color: '#111827', lineHeight: 1.35 },
    signatureMissing: { fontSize: 10, color: '#9ca3af', fontStyle: 'italic', marginTop: 8, lineHeight: 1.35 },

    // Vedleggssidene: ett bilde per side, stort nok til å se detaljene.
    attachmentHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      borderBottom: `2px solid ${brandColor}`,
      paddingBottom: 6,
      marginBottom: 12
    },
    attachmentKicker: { fontSize: 9, color: '#6b7280', textTransform: 'uppercase', fontWeight: 'bold', lineHeight: 1.35 },
    attachmentTitle: { fontSize: 18, fontWeight: 'bold', color: brandColor, lineHeight: 1.3 },
    attachmentImageBox: { alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
    attachmentImage: { objectFit: 'contain' },
    attachmentMeta: { borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 8 },
    metaRow: { fontSize: 10, color: '#111827', marginBottom: 3, lineHeight: 1.4 },
    metaKey: { fontWeight: 'bold', color: '#6b7280' },

    footer: {
      // Festet nederst på hver side, utenfor innholdsflaten.
      position: 'absolute',
      bottom: 22,
      left: 40,
      right: 40,
      borderTop: `1px solid #e5e7eb`,
      paddingTop: 5,
      flexDirection: 'row',
      justifyContent: 'space-between'
    },
    footerText: {
      fontSize: 8,
      color: '#6b7280',
      lineHeight: 1.35
    }
  });

  /*
   * Felles bunntekst på hver side.
   *
   * Merk: `render`-prop (sidetall) kan ikke brukes sammen med `fixed` –
   * react-pdf 4 tegner da ikke bunnteksten i det hele tatt.
   */
  const renderFooter = () => (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>{companyName} – generert av FSM-plattformen</Text>
      <Text style={styles.footerText}>
        {formatDate(new Date())}
      </Text>
    </View>
  );

  const signatureBox = (label: string, url?: string | null, name?: string | null) => {
    const image = pdfImage(url ?? "");
    return (
      <View style={styles.signatureBox} wrap={false}>
        <Text style={styles.label}>{label}</Text>
        {image ? (
          // react-pdf tegner <Image> inn i PDF-en, ikke i DOM-en (og støtter ikke alt)
          // eslint-disable-next-line jsx-a11y/alt-text
          <Image src={image.src} style={styles.signatureImage} />
        ) : (
          <Text style={styles.signatureMissing}>Ikke signert</Text>
        )}
        <Text style={styles.signatureLine}>{name || "—"}</Text>
      </View>
    );
  };

  /**
   * Sjekkpunkt med miniatyrbilder.
   *
   * Bevisst uten `wrap={false}`: et punkt med mange bilder kan være høyere enn
   * en side, og et element som ikke får plass på siden ødelegger linjeflyten i
   * react-pdf (teksten havner oppå hverandre).
   */
  const answerBlock = (
    row: PreparedRow,
    index: number,
    textStyle: { fontSize: number; color: string; marginBottom: number },
  ) => (
    <View key={index} style={{ marginBottom: 4 }}>
      {row.rich ? (
        <View>
          <Text
            style={row.alert ? { ...textStyle, color: "#991b1b", fontWeight: "bold" } : textStyle}
          >
            {row.label}:
          </Text>
          <MarkdownPdf value={row.rich} base={textStyle} />
        </View>
      ) : (row.text !== "" || row.isImage) ? (
        <Text style={row.alert ? { ...textStyle, color: "#991b1b", fontWeight: "bold" } : textStyle}>
          <Text style={styles.answerLabel}>{row.label}: </Text>
          {row.text}
        </Text>
      ) : null}
      {row.comment ? (
        <View style={styles.lineCommentBlock}>
          <Text style={styles.lineComment}>» Kommentar</Text>
          <MarkdownPdf value={row.comment} base={styles.lineComment} />
        </View>
      ) : null}
      {row.images.length > 0 && (
        <View style={styles.thumbGrid}>
          {row.images.map((image) => (
            <View key={image.n} style={styles.thumbBox}>
              {/* eslint-disable-next-line jsx-a11y/alt-text */}
              <Image src={image.image.src} style={styles.thumbImage} />
              <Text style={styles.thumbLabel}>Bilde {image.n}</Text>
            </View>
          ))}
        </View>
      )}
      {row.images.length === 0 && row.isImage && (
        <Text style={styles.missingImage}>Ingen bilder lagt ved</Text>
      )}
    </View>
  );

  const logoImage = pdfImage(logoUrl ?? "");

  return (
    <Document title={documentTitle} author={companyName}>
      <Page size="A4" style={styles.page}>

        {/* HEADER: logo til venstre, tittel, ordrenummer og firmanavn til høyre */}
        <View style={styles.headerContainer}>
          {logoImage ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={logoImage.src} style={styles.logo} />
          ) : (
            <View />
          )}
          <View style={styles.headerTextBlock}>
            <Text style={styles.headerText}>{documentTitle}</Text>
            {hmsHeader && <Text style={styles.headerHms}>{hmsHeader}</Text>}
            {workOrder.orderNumber && (
              <Text style={styles.headerOrder}>
                Ordrenr. {workOrder.orderNumber}
              </Text>
            )}
            {blocks.length === 1 && blocks[0]?.reportNumber && (
              <Text style={styles.headerOrder}>
                Rapportnr. {blocks[0].reportNumber}
              </Text>
            )}
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
              Dato: {formatDate(workOrder.scheduledFor, "Ingen dato")}
            </Text>
            <Text style={styles.value}>
              Utførende tekniker: {technicianNames.length > 0 ? technicianNames.join(", ") : "Ikke angitt"}
            </Text>
          </View>
        </View>

        {/* SAMLET RESULTAT – bare når minst én rapport har enheter */}
        {hasUnitReports && (
          <View style={styles.statusBox}>
            <Text style={styles.statusText}>
              {overallStatus === "GODKJENT" ? "Godkjent / utført" : overallStatus === "AVVIK" ? "Avvik funnet" : "Ukjent resultat"}
              {totalUnits > 0 ? ` – ${totalUnits} ${totalUnits === 1 ? "enhet" : "enheter"} kontrollert` : ""}
            </Text>
          </View>
        )}

        {/* ÉN SEKSJON PER UTFYLT SJEKKLISTE */}
        {planned.map(({ block, units, legacy }, blockIndex) => (
          <View key={block.id} style={styles.section} wrap>
            {blocks.length > 1 || block.name ? (
              <Text style={styles.reportTitle}>
                {block.name || `Sjekkliste ${blockIndex + 1}`}
                {block.category === "HMS" ? "  •  HMS-dokumentasjon" : ""}
                {block.reportNumber ? `  •  Rapportnr. ${block.reportNumber}` : ""}
                {block.date ? `  •  ${block.date}` : ""}
                {block.requiresUnits && block.status !== "UKJENT"
                  ? block.status === "AVVIK"
                    ? "  –  Avvik"
                    : "  –  Godkjent"
                  : ""}
              </Text>
            ) : null}

            {/* Enheter med sine egne sjekkpunkter */}
            {units.map(({ unit, index, rows }) =>
              block.requiresUnits ? (
                <View key={unit.id} style={styles.unitCard}>
                  <View style={styles.unitHeader}>
                    <View style={styles.unitHeaderText}>
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
                    {rows.map((row, i) => answerBlock(prepareRow(row), i, styles.answerRow))}
                  </View>

                  {unit.comment && <MarkdownPdf value={unit.comment} base={styles.unitComment} />}
                </View>
              ) : (
                // Rapport uten enheter: sjekkpunktene vises direkte, uten
                // enhetskort, nummer, serienummer eller plassering.
                <View key={unit.id} style={styles.unitBody}>
                  {rows.map((row, i) => answerBlock(prepareRow(row), i, styles.checklistItem))}
                  {unit.comment && <MarkdownPdf value={unit.comment} base={styles.unitComment} />}
                </View>
              ),
            )}

            {/* Eldre rapporter uten enheter */}
            {legacy.length > 0 && (
              <View style={styles.unitBody}>
                {legacy.map((row, i) => answerBlock(prepareRow(row), i, styles.checklistItem))}
              </View>
            )}

            {block.comments && (
              <View style={{ marginTop: 10 }}>
                <Text style={styles.label}>Montørens kommentar</Text>
                <MarkdownPdf value={block.comments} base={styles.value} />
              </View>
            )}

            {/* Signaturer: holdes samlet og dyttes til neste side om det blir for trangt */}
            <View style={{ ...styles.signatureGrid, marginTop: 10 }} wrap={false}>
              {signatureBox("Montør / tekniker", block.technicianSignatureUrl, block.technicianName)}
              {signatureBox("Kunde", block.customerSignatureUrl, block.customerName)}
            </View>
          </View>
        ))}

        {renderFooter()}
      </Page>

      {/*
        VEDLEGG: hvert bilde får sin egen side, slik at detaljene faktisk er
        lesbare. Nummeret viser tilbake til sjekkpunktet i rapporten.
      */}
      {attachments.flatMap((attachment) => {
        const image = pdfImage(attachment.url);
        if (!image) return [];

        return [
          <Page key={attachment.n} size="A4" style={styles.page}>
            <View style={styles.attachmentHeader}>
              <View>
                <Text style={styles.attachmentKicker}>Vedlegg – bilde</Text>
                <Text style={styles.attachmentTitle}>
                  {attachment.n} av {attachments.length}
                </Text>
              </View>
              <View style={styles.headerTextBlock}>
                <Text style={styles.attachmentKicker}>{documentTitle}</Text>
                {workOrder.orderNumber && (
                  <Text style={styles.headerOrder}>
                    Ordrenr. {workOrder.orderNumber}
                  </Text>
                )}
                <Text style={styles.companyName}>{companyName}</Text>
              </View>
            </View>

            <View style={styles.attachmentImageBox}>
              {/* eslint-disable-next-line jsx-a11y/alt-text */}
              <Image
                src={image.src}
                style={{
                  ...styles.attachmentImage,
                  width: image.width ?? '100%',
                  height: image.height ?? 560,
                }}
              />
            </View>

            <View style={styles.attachmentMeta}>
              <Text style={styles.metaRow}>
                <Text style={styles.metaKey}>Sjekkpunkt: </Text>
                {attachment.point}
              </Text>
              {attachment.requiresUnits && (
                <Text style={styles.metaRow}>
                  <Text style={styles.metaKey}>Enhet: </Text>
                  {attachment.unitLabel || "Uten enhet"}
                  {attachment.serialNumber ? `  •  Serienummer: ${attachment.serialNumber}` : ""}
                  {attachment.location ? `  •  Plassering: ${attachment.location}` : ""}
                </Text>
              )}
              <Text style={styles.metaRow}>
                <Text style={styles.metaKey}>Sjekkliste: </Text>
                {attachment.checklist}
                {attachment.date ? `  •  ${attachment.date}` : ""}
                {attachment.requiresUnits && attachment.status
                  ? `  •  ${attachment.status === "AVVIK" ? "Avvik" : "Godkjent"}`
                  : ""}
              </Text>
              {attachment.comment ? (
                <View style={styles.metaRow}>
                  <Text style={styles.metaKey}>Kommentar: </Text>
                  <MarkdownPdf value={attachment.comment} base={styles.metaRow} />
                </View>
              ) : null}
            </View>

            {renderFooter()}
          </Page>,
        ];
      })}
    </Document>
  );
}
