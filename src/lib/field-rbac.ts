// i18n-ignore-file: policy-nøkler og feltnavn er stabile interne verdier.
/**
 * Feltnivå-RBAC v1.
 *
 * Modulen er ren og DB-fri. Den brukes av lesetjenester, API-ruter, søk og
 * eksport for å fjerne eller maskere sensitive felt før data forlater serveren.
 * Standardmatrisen bevarer dagens tilgang for ADMIN og OFFICE, mens montører og
 * kundeportalbrukere får minste privilegium.
 *
 * En administrator kan gi et enkeltfelt eksplisitt med de samme nøklene i
 * brukerens `permissions`-liste (også når listen er tilpasset). Ukjente verdier
 * ignoreres; en rolle kan aldri få mer enn matrisen uten en slik eksplisitt
 * tildeling.
 */

export const FIELD_GROUPS = [
  "customerContact",
  "billingAmounts",
  "reportSignatures",
  "payrollAmounts",
] as const;

export type FieldGroup = (typeof FIELD_GROUPS)[number];

export const FIELD_PERMISSION_KEYS: Record<FieldGroup, string> = {
  customerContact: "fields.customerContact",
  billingAmounts: "fields.billingAmounts",
  reportSignatures: "fields.reportSignatures",
  payrollAmounts: "fields.payrollAmounts",
};

export type FieldAccessLevel = "full" | "own" | "none";

export const FIELD_POLICY_MATRIX: Record<
  FieldGroup,
  Record<"ADMIN" | "OFFICE" | "TECHNICIAN" | "CUSTOMER" | "USER", FieldAccessLevel>
> = {
  customerContact: {
    ADMIN: "full",
    OFFICE: "full",
    TECHNICIAN: "none",
    CUSTOMER: "own",
    USER: "none",
  },
  billingAmounts: {
    ADMIN: "full",
    OFFICE: "full",
    TECHNICIAN: "none",
    CUSTOMER: "own",
    USER: "none",
  },
  reportSignatures: {
    ADMIN: "full",
    OFFICE: "full",
    TECHNICIAN: "full",
    CUSTOMER: "own",
    USER: "none",
  },
  payrollAmounts: {
    ADMIN: "full",
    OFFICE: "full",
    TECHNICIAN: "own",
    CUSTOMER: "none",
    USER: "none",
  },
};

export type FieldPolicyActor = {
  id?: string | null;
  role?: string | null;
  isActive?: boolean | null;
  customerId?: string | null;
  permissions?: string[] | null;
  permissionsCustomized?: boolean | null;
  roleDefinition?: { permissions?: string[] | null } | null;
};

export type FieldPolicyContext = {
  /** Eieren av raden, brukt for «own»-regler. */
  ownerId?: string | null;
  /** Kunden raden tilhører, brukt for kundeportalens egne data. */
  customerId?: string | null;
};

export type FieldAccess = {
  level: FieldAccessLevel;
  /** True når feltene skal maskeres/fjernes. */
  masked: boolean;
  /** Hvorfor tilgangen ble gitt, nyttig i tester og admin-matrisen. */
  source: "role" | "explicit" | "scope" | "denied";
};

function roleLevel(
  role: string | null | undefined,
  group: FieldGroup,
): FieldAccessLevel {
  if (!role) return "none";
  const row = FIELD_POLICY_MATRIX[group];
  return row[role as keyof typeof row] ?? "none";
}

/** Er nøkkelen eksplisitt tildelt brukeren (rolle eller tilpasset liste)? */
export function explicitFieldPermission(
  actor: FieldPolicyActor | null | undefined,
  group: FieldGroup,
): boolean {
  if (!actor) return false;
  const key = FIELD_PERMISSION_KEYS[group];
  const candidates = [
    ...(actor.permissions ?? []),
    ...(actor.permissionsCustomized === true
      ? []
      : actor.roleDefinition?.permissions ?? []),
  ];
  return candidates.includes(key);
}

/**
 * Avgjør om en aktør får se hele feltgruppen, bare egne rader, eller ingenting.
 * En inaktiv konto får aldri tilgang.
 */
export function fieldAccess(
  actor: FieldPolicyActor | null | undefined,
  group: FieldGroup,
  context: FieldPolicyContext = {},
): FieldAccess {
  if (!actor?.isActive) {
    return { level: "none", masked: true, source: "denied" };
  }

  if (explicitFieldPermission(actor, group)) {
    return { level: "full", masked: false, source: "explicit" };
  }

  const level = roleLevel(actor.role, group);
  if (level === "full") {
    return { level, masked: false, source: "role" };
  }
  if (level === "own") {
    const ownsRow =
      (actor.id && context.ownerId && actor.id === context.ownerId) ||
      (actor.customerId &&
        context.customerId &&
        actor.customerId === context.customerId);
    if (ownsRow) {
      return { level: "full", masked: false, source: "scope" };
    }
    return { level: "own", masked: true, source: "denied" };
  }
  return { level: "none", masked: true, source: "denied" };
}

export function canSeeField(
  actor: FieldPolicyActor | null | undefined,
  group: FieldGroup,
  context: FieldPolicyContext = {},
): boolean {
  return !fieldAccess(actor, group, context).masked;
}

/** E-post: behold første tegn og domenets TLD, masker resten. */
export function maskEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.trim();
  const at = cleaned.lastIndexOf("@");
  if (at <= 0) return "•••";
  const local = cleaned.slice(0, at);
  const domain = cleaned.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const tld = dot > 0 ? domain.slice(dot) : "";
  return `${local.slice(0, 1)}•••@•••${tld}`;
}

/** Telefon: vis bare de to siste sifrene. */
export function maskPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 2) return "•• ••";
  return `•• •• •• ${digits.slice(-2)}`;
}

export function maskText(value: string | null | undefined): string | null {
  return value ? "••••" : (value ?? null);
}

/** Beløp returneres som null, med feltnavnet i `redactedFields`. */
export function maskAmount(value: unknown): null {
  void value;
  return null;
}

export function maskSignatureUrl(value: string | null | undefined): null {
  void value;
  return null;
}

export type RedactionKind = "email" | "phone" | "text" | "amount" | "signature";

export type RedactOptions = FieldPolicyContext & {
  group: FieldGroup;
  /** Felt som skal maskeres dersom gruppen ikke er synlig. */
  fields: Record<string, RedactionKind>;
};

export type Redacted<T> = T & { redactedFields?: string[] };

/**
 * Maskerer de oppgitte feltene på en kopi. Felt som ikke er med i `fields`
 * røres aldri, slik at hver lesetjeneste eksplisitt må navngi dataene sine.
 */
export function redactRecord<T extends object>(
  actor: FieldPolicyActor | null | undefined,
  record: T,
  options: RedactOptions,
): Redacted<T> {
  const access = fieldAccess(actor, options.group, options);
  if (!access.masked) return record;

  const result = { ...record } as Record<string, unknown>;
  const redactedFields: string[] = [];
  for (const [field, kind] of Object.entries(options.fields)) {
    if (!(field in result)) continue;
    redactedFields.push(field);
    switch (kind) {
      case "email":
        result[field] = maskEmail(result[field] as string | null);
        break;
      case "phone":
        result[field] = maskPhone(result[field] as string | null);
        break;
      case "text":
        result[field] = maskText(result[field] as string | null);
        break;
      case "amount":
        result[field] = maskAmount(result[field]);
        break;
      case "signature":
        result[field] = maskSignatureUrl(result[field] as string | null);
        break;
    }
  }
  if (redactedFields.length > 0) result.redactedFields = redactedFields;
  return result as Redacted<T>;
}

export function redactRecords<T extends object>(
  actor: FieldPolicyActor | null | undefined,
  records: readonly T[],
  options: RedactOptions,
): Array<Redacted<T>> {
  return records.map((record) => redactRecord(actor, record, options));
}

/** Feltkart for de vanlige lesetjenestene, slik at de ikke kan divergere. */
export const CUSTOMER_CONTACT_FIELDS: Record<string, RedactionKind> = {
  email: "email",
  phone: "phone",
  contactEmail: "email",
  contactPhone: "phone",
  customerEmail: "email",
  customerPhone: "phone",
};

export const BILLING_AMOUNT_FIELDS: Record<string, RedactionKind> = {
  subtotal: "amount",
  vatTotal: "amount",
  total: "amount",
  paidTotal: "amount",
  creditedTotal: "amount",
  outstanding: "amount",
  amount: "amount",
  unitPrice: "amount",
  lineTotal: "amount",
  lineVat: "amount",
  vatAmount: "amount",
  pendingAmount: "amount",
  approvedAmount: "amount",
  mileageAmount: "amount",
  expenseAmount: "amount",
  expenseVat: "amount",
};

export const REPORT_SIGNATURE_FIELDS: Record<string, RedactionKind> = {
  technicianSignatureUrl: "signature",
  customerSignatureUrl: "signature",
  signatureUrl: "signature",
};

export const PAYROLL_AMOUNT_FIELDS: Record<string, RedactionKind> = {
  amount: "amount",
  vatAmount: "amount",
  rate: "amount",
  pendingAmount: "amount",
  approvedAmount: "amount",
  mileageAmount: "amount",
  expenseAmount: "amount",
  expenseVat: "amount",
};
