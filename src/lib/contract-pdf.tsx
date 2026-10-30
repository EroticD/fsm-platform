import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import prisma from "@/lib/prisma";
import { toDateOnly } from "@/lib/dates";
import { contractPdfLabels } from "@/lib/contract-pdf-labels";

/** Feltene PDF-en bruker. Tjenesten sender hele avtaledetaljen. */
export type ContractPdfData = {
  id: string;
  title: string;
  contractNumber: string | null;
  status: string;
  startDate: Date;
  endDate: Date | null;
  intervalMonths: number;
  renewalMode: string;
  noticeDays: number;
  indexationPercent: { toString(): string } | number | null;
  customer: {
    name: string;
    customerNumber: string | null;
    orgNumber: string | null;
    address: string | null;
    postalCode: string | null;
    city: string | null;
    phone: string | null;
    email: string | null;
  };
  department: { name: string };
  contact: { name: string; email: string | null; phone: string | null } | null;
  slaPolicy: {
    name: string;
    responseMinutes: number;
    resolutionMinutes: number;
    businessHoursOnly: boolean;
  } | null;
  priceList: {
    name: string;
    items: Array<{
      id: string;
      code: string;
      label: string;
      unit: string;
      amount: { toString(): string } | number;
    }>;
  } | null;
  lines: Array<{
    id: string;
    scope: string;
    visitsPerYear: number | null;
    responseMinutes: number | null;
    resolutionMinutes: number | null;
    product: {
      model: string;
      serialNumber: string | null;
      location: string | null;
    } | null;
  }>;
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingHorizontal: 36,
    paddingBottom: 44,
    fontSize: 9.5,
    fontFamily: "Helvetica",
    color: "#101310",
    lineHeight: 1.35,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: "#101310",
    paddingBottom: 12,
    marginBottom: 16,
  },
  company: { fontSize: 15, fontFamily: "Helvetica-Bold" },
  title: { fontSize: 21, fontFamily: "Helvetica-Bold", marginTop: 2 },
  kind: {
    fontSize: 8,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: "#62685f",
  },
  badge: {
    borderWidth: 1,
    borderColor: "#101310",
    paddingHorizontal: 7,
    paddingVertical: 3,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
  },
  section: { marginBottom: 13 },
  sectionTitle: {
    fontSize: 8,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "#62685f",
    marginBottom: 4,
    fontFamily: "Helvetica-Bold",
  },
  grid: { flexDirection: "row", gap: 18 },
  column: { flex: 1 },
  row: { flexDirection: "row", gap: 6, marginBottom: 1.5 },
  label: { width: 112, color: "#62685f" },
  value: { flex: 1, fontFamily: "Helvetica-Bold" },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#101310",
    paddingBottom: 3,
    marginBottom: 3,
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    textTransform: "uppercase",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#dedcd1",
    paddingVertical: 3.5,
  },
  cell: { flex: 1, paddingRight: 5 },
  cellWide: { flex: 2.2, paddingRight: 5 },
  cellNarrow: { width: 55, paddingRight: 5 },
  muted: { color: "#62685f", fontSize: 8 },
  note: {
    marginTop: 8,
    padding: 7,
    backgroundColor: "#f2efe6",
    borderLeftWidth: 3,
    borderLeftColor: "#101310",
    fontSize: 8,
  },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 36,
    right: 36,
    borderTopWidth: 0.5,
    borderTopColor: "#dedcd1",
    paddingTop: 5,
    flexDirection: "row",
    justifyContent: "space-between",
    color: "#62685f",
    fontSize: 7.5,
  },
});

function displayNumber(
  value: { toString(): string } | number | null,
  locale: string,
): string {
  if (value === null || value === undefined) return "";
  const number = Number(value.toString());
  const intlLocale = locale.startsWith("en")
    ? "en-GB"
    : locale.startsWith("pl")
      ? "pl-PL"
      : locale.startsWith("de")
        ? "de-DE"
        : "nb-NO";
  return Number.isFinite(number)
    ? number.toLocaleString(intlLocale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : value.toString();
}

function productLabel(
  labels: ReturnType<typeof contractPdfLabels>,
  product: ContractPdfData["lines"][number]["product"],
): string {
  if (!product) return labels.allEquipment;
  const parts = [product.model];
  if (product.serialNumber) parts.push(product.serialNumber);
  if (product.location) parts.push(product.location);
  return parts.join(" · ");
}

export async function renderContractPdf(
  contract: ContractPdfData,
  locale = "nb",
): Promise<Buffer> {
  const labels = contractPdfLabels(locale);
  const branding = await prisma.branding.findFirst({
    select: { companyName: true, primaryColor: true },
  });
  const companyName = branding?.companyName || "FSM";
  const accent = /^#[0-9a-f]{3,8}$/i.test(branding?.primaryColor ?? "")
    ? branding?.primaryColor
    : "#101310";

  const period = `${toDateOnly(contract.startDate)} – ${
    contract.endDate ? toDateOnly(contract.endDate) : labels.noEndDate
  }`;

  const document = (
    <Document
      title={`${labels.title} ${contract.contractNumber ?? contract.title}`}
      author={companyName}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.company}>{companyName}</Text>
            <Text style={styles.kind}>{labels.title}</Text>
            <Text style={styles.title}>{contract.title}</Text>
            {contract.contractNumber ? (
              <Text style={styles.muted}>
                {labels.contractNumber}: {contract.contractNumber}
              </Text>
            ) : null}
          </View>
          <Text style={[styles.badge, { borderColor: accent }]}>
            {labels.statuses[contract.status] ?? contract.status}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{labels.customer}</Text>
          <View style={styles.grid}>
            <View style={styles.column}>
              <View style={styles.row}>
                <Text style={styles.label}>{labels.customer}</Text>
                <Text style={styles.value}>{contract.customer.name}</Text>
              </View>
              {contract.customer.customerNumber ? (
                <View style={styles.row}>
                  <Text style={styles.label}>#</Text>
                  <Text style={styles.value}>
                    {contract.customer.customerNumber}
                  </Text>
                </View>
              ) : null}
              {contract.customer.orgNumber ? (
                <View style={styles.row}>
                  <Text style={styles.label}>{labels.orgNumber}</Text>
                  <Text style={styles.value}>{contract.customer.orgNumber}</Text>
                </View>
              ) : null}
              <View style={styles.row}>
                <Text style={styles.label}>{labels.department}</Text>
                <Text style={styles.value}>{contract.department.name}</Text>
              </View>
            </View>
            <View style={styles.column}>
              {contract.customer.address ? (
                <View style={styles.row}>
                  <Text style={styles.label}>{labels.customer}</Text>
                  <Text style={styles.value}>
                    {[
                      contract.customer.address,
                      [contract.customer.postalCode, contract.customer.city]
                        .filter(Boolean)
                        .join(" "),
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </Text>
                </View>
              ) : null}
              {contract.customer.phone ? (
                <View style={styles.row}>
                  <Text style={styles.label}>{labels.phone}</Text>
                  <Text style={styles.value}>{contract.customer.phone}</Text>
                </View>
              ) : null}
              {contract.customer.email ? (
                <View style={styles.row}>
                  <Text style={styles.label}>{labels.email}</Text>
                  <Text style={styles.value}>{contract.customer.email}</Text>
                </View>
              ) : null}
              {contract.contact ? (
                <View style={styles.row}>
                  <Text style={styles.label}>{labels.contact}</Text>
                  <Text style={styles.value}>{contract.contact.name}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{labels.period}</Text>
          <View style={styles.grid}>
            <View style={styles.column}>
              <View style={styles.row}>
                <Text style={styles.label}>{labels.period}</Text>
                <Text style={styles.value}>{period}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>{labels.interval}</Text>
                <Text style={styles.value}>
                  {contract.intervalMonths} {labels.months}
                </Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>{labels.status}</Text>
                <Text style={styles.value}>
                  {labels.statuses[contract.status] ?? contract.status}
                </Text>
              </View>
            </View>
            <View style={styles.column}>
              <View style={styles.row}>
                <Text style={styles.label}>{labels.renewal}</Text>
                <Text style={styles.value}>
                  {labels.renewalModes[contract.renewalMode] ??
                    contract.renewalMode}
                </Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>{labels.noticeDays}</Text>
                <Text style={styles.value}>{contract.noticeDays}</Text>
              </View>
              {contract.indexationPercent !== null ? (
                <View style={styles.row}>
                  <Text style={styles.label}>{labels.indexation}</Text>
                  <Text style={styles.value}>
                    {displayNumber(contract.indexationPercent, locale)} %
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        {contract.slaPolicy ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{labels.sla}</Text>
            <View style={styles.row}>
              <Text style={styles.label}>{contract.slaPolicy.name}</Text>
              <Text style={styles.value}>
                {labels.slaResponse}: {contract.slaPolicy.responseMinutes} min ·{" "}
                {labels.slaResolution}: {contract.slaPolicy.resolutionMinutes} min
                {contract.slaPolicy.businessHoursOnly
                  ? ` · ${labels.businessHoursOnly}`
                  : ""}
              </Text>
            </View>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{labels.line}</Text>
          <View style={styles.tableHeader}>
            <Text style={styles.cellWide}>{labels.equipment}</Text>
            <Text style={styles.cellWide}>{labels.scope}</Text>
            <Text style={styles.cellNarrow}>{labels.visitsPerYear}</Text>
            <Text style={styles.cellNarrow}>{labels.responseMinutes}</Text>
            <Text style={styles.cellNarrow}>{labels.resolutionMinutes}</Text>
          </View>
          {contract.lines.length === 0 ? (
            <Text style={styles.muted}>{labels.allEquipment}</Text>
          ) : (
            contract.lines.map((line) => (
              <View key={line.id} style={styles.tableRow}>
                <Text style={styles.cellWide}>
                  {productLabel(labels, line.product)}
                </Text>
                <Text style={styles.cellWide}>{line.scope || "–"}</Text>
                <Text style={styles.cellNarrow}>
                  {line.visitsPerYear ?? "–"}
                </Text>
                <Text style={styles.cellNarrow}>
                  {line.responseMinutes ?? "–"}
                </Text>
                <Text style={styles.cellNarrow}>
                  {line.resolutionMinutes ?? "–"}
                </Text>
              </View>
            ))
          )}
        </View>

        {contract.priceList ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {labels.priceList}: {contract.priceList.name}
            </Text>
            <View style={styles.tableHeader}>
              <Text style={styles.cellNarrow}>{labels.code}</Text>
              <Text style={styles.cellWide}>{labels.label}</Text>
              <Text style={styles.cellNarrow}>{labels.unit}</Text>
              <Text style={styles.cellNarrow}>{labels.amount}</Text>
            </View>
            {contract.priceList.items.map((item) => (
              <View key={item.id} style={styles.tableRow}>
                <Text style={styles.cellNarrow}>{item.code}</Text>
                <Text style={styles.cellWide}>{item.label}</Text>
                <Text style={styles.cellNarrow}>{item.unit}</Text>
                <Text style={styles.cellNarrow}>
                  {displayNumber(item.amount, locale)}
                </Text>
              </View>
            ))}
            <Text style={styles.note}>{labels.referenceOnly}</Text>
          </View>
        ) : null}

        <View style={styles.footer} fixed>
          <Text>
            {labels.generated} {toDateOnly(new Date())} · {companyName}
          </Text>
          <Text>{contract.contractNumber ?? contract.id}</Text>
        </View>
      </Page>
    </Document>
  );

  return renderToBuffer(document);
}
