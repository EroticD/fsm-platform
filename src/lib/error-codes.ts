/**
 * Sentralt register over presise feilkoder.
 *
 * Tjenestene returnerer `{ ok: false, reason, details: { code } }`, og
 * action-wrapperne sender `details.code` videre til UI-et som en query-verdi.
 * Før dette registeret var kodene bare utypede strenger: en skrivefeil ble
 * stille til «generic» i feedback-mappene, og nye koder var usynlige både for
 * brukeren og for typesjekken.
 *
 * Regler:
 * - Koden er stabil og skal ikke endres; den er kontrakten mot UI, API og tester.
 * - Nøkkelen er den samme strengen som verdien, slik at `keyof` blir unionen av
 *   faktiske koder. Bruk `ERROR_CODES["invoice.locked"]` der koden produseres.
 * - Nye koder legges til her og i modulens `feedback.ts`. `error-codes.test.ts`
 *   feiler hvis en produsert kode mangler, eller hvis registeret inneholder en
 *   kode ingen produserer.
 *
 * HTTP-konvolutten (`ApiErrorCode` i `api-errors.ts`) er et eget register og
 * skal ikke blandes inn her: `code: "conflict"` på toppnivå er status, mens
 * `details.code` er den presise årsaken.
 */
export const ERROR_CODES = {
  // ── Oppdrag: visiter (src/server/visits.ts) ─────────────────────────────
  "visits.errors.overlap": "visits.errors.overlap",
  "visits.errors.invalidTimeRange": "visits.errors.invalidTimeRange",
  "visits.errors.durationTooLong": "visits.errors.durationTooLong",
  "visits.errors.invalidTechnician": "visits.errors.invalidTechnician",
  "visits.errors.invalidInput": "visits.errors.invalidInput",
  "visits.errors.legalHold": "visits.errors.legalHold",
  "visits.errors.workOrderLocked": "visits.errors.workOrderLocked",
  "visits.errors.visitLocked": "visits.errors.visitLocked",
  "visits.errors.statusTransition": "visits.errors.statusTransition",
  "visits.errors.noChange": "visits.errors.noChange",
  "visits.errors.invalidSequence": "visits.errors.invalidSequence",
  "visits.errors.invalidDateRange": "visits.errors.invalidDateRange",
  "visits.errors.visitInProgress": "visits.errors.visitInProgress",
  "visits.errors.loggedDayConflict": "visits.errors.loggedDayConflict",
  "visits.errors.pastDayConflict": "visits.errors.pastDayConflict",
  "visits.errors.travelFromNotAvailable": "visits.errors.travelFromNotAvailable",

  // ── Oppdrag: utsending og ruteplan (dispatch.ts, route-plan.ts) ────────
  "dispatch.errors.invalid": "dispatch.errors.invalid",
  "dispatch.errors.forbidden": "dispatch.errors.forbidden",
  "dispatch.errors.notFound": "dispatch.errors.notFound",
  "dispatch.errors.noCandidate": "dispatch.errors.noCandidate",
  "dispatch.errors.conflict": "dispatch.errors.conflict",
  "dispatch.errors.applyFailed": "dispatch.errors.applyFailed",
  "route.errors.invalid": "route.errors.invalid",
  "route.errors.forbidden": "route.errors.forbidden",
  "route.errors.notFound": "route.errors.notFound",
  "route.errors.conflict": "route.errors.conflict",
  "route.errors.absence": "route.errors.absence",
  "route.errors.overlap": "route.errors.overlap",
  "route.errors.orderMismatch": "route.errors.orderMismatch",
  "route.errors.applyFailed": "route.errors.applyFailed",

  // ── Bookinger (src/server/bookings.ts) ──────────────────────────────────
  invalid_time: "invalid_time",
  needs_planning: "needs_planning",
  no_technician: "no_technician",
  technician_unavailable: "technician_unavailable",

  // ── Sporing av oppdrag (src/server/tracking.ts) ─────────────────────────
  "tracking.errors.invalidInput": "tracking.errors.invalidInput",
  "tracking.errors.disabled": "tracking.errors.disabled",
  "tracking.errors.visitLocked": "tracking.errors.visitLocked",
  "tracking.errors.expired": "tracking.errors.expired",
  "tracking.errors.invalidCoordinates": "tracking.errors.invalidCoordinates",

  // ── Faktura (invoices.ts, accounting.ts, payments.ts) ───────────────────
  "invoice.locked": "invoice.locked",
  "invoice.notDraft": "invoice.notDraft",
  "invoice.notPayable": "invoice.notPayable",
  "invoice.notCreditable": "invoice.notCreditable",
  "invoice.amountTooHigh": "invoice.amountTooHigh",
  "invoice.duplicate": "invoice.duplicate",
  "invoice.duplicateNumber": "invoice.duplicateNumber",
  "accounting.notConfigured": "accounting.notConfigured",
  "accounting.disabled": "accounting.disabled",
  "accounting.concurrent": "accounting.concurrent",
  "accounting.syncFailed": "accounting.syncFailed",
  "payments.disabled": "payments.disabled",
  "payments.unsupportedCurrency": "payments.unsupportedCurrency",
  "payments.providerError": "payments.providerError",

  // ── Tilbud (quotes.ts) ──────────────────────────────────────────────────
  "quote.locked": "quote.locked",
  "quote.expired": "quote.expired",
  "quote.notDraft": "quote.notDraft",
  "quote.notSent": "quote.notSent",
  "quote.notAccepted": "quote.notAccepted",
  "quote.duplicate": "quote.duplicate",
  "quote.conversionRace": "quote.conversionRace",
  "token.expired": "token.expired",
  "token.used": "token.used",

  // ── Lager og innkjøp (inventory.ts, purchasing.ts) ──────────────────────
  "inventory.negativeStock": "inventory.negativeStock",
  "inventory.insufficientStock": "inventory.insufficientStock",
  "inventory.invalidMovement": "inventory.invalidMovement",
  "inventory.invalidLocation": "inventory.invalidLocation",
  "inventory.invalidItem": "inventory.invalidItem",
  "inventory.duplicateSku": "inventory.duplicateSku",
  "inventory.reservationNotActive": "inventory.reservationNotActive",
  "inventory.workOrderRequired": "inventory.workOrderRequired",
  "inventory.workOrderLocked": "inventory.workOrderLocked",
  "purchasing.invalidSupplier": "purchasing.invalidSupplier",
  "purchasing.duplicateSupplier": "purchasing.duplicateSupplier",
  "purchasing.invalidOrder": "purchasing.invalidOrder",
  "purchasing.invalidLine": "purchasing.invalidLine",
  "purchasing.duplicateLine": "purchasing.duplicateLine",
  "purchasing.invalidTransition": "purchasing.invalidTransition",
  "purchasing.overReceipt": "purchasing.overReceipt",
  "purchasing.nothingToOrder": "purchasing.nothingToOrder",

  // ── Utlegg og kjøregodtgjørelse (src/server/expenses.ts) ────────────────
  "expenses.errors.invalidInput": "expenses.errors.invalidInput",
  "expenses.errors.invalidDate": "expenses.errors.invalidDate",
  "expenses.errors.invalidAmount": "expenses.errors.invalidAmount",
  "expenses.errors.invalidVat": "expenses.errors.invalidVat",
  "expenses.errors.invalidReceipt": "expenses.errors.invalidReceipt",
  "expenses.errors.invalidStatus": "expenses.errors.invalidStatus",
  "expenses.errors.reasonRequired": "expenses.errors.reasonRequired",
  "expenses.errors.periodOverlap": "expenses.errors.periodOverlap",
  "expenses.errors.invalidPeriod": "expenses.errors.invalidPeriod",

  // ── Utstyr og enheter (equipment.ts) ────────────────────────────────────
  "equipment.errors.invalidInput": "equipment.errors.invalidInput",
  "equipment.errors.invalidStatus": "equipment.errors.invalidStatus",
  "equipment.errors.invalidCriticality": "equipment.errors.invalidCriticality",
  "equipment.errors.invalidDate": "equipment.errors.invalidDate",
  "equipment.errors.invalidCategory": "equipment.errors.invalidCategory",
  "equipment.errors.invalidParent": "equipment.errors.invalidParent",
  "equipment.errors.customerMismatch": "equipment.errors.customerMismatch",
  "equipment.errors.hierarchyCycle": "equipment.errors.hierarchyCycle",
  "equipment.errors.categoryCycle": "equipment.errors.categoryCycle",
  "equipment.errors.categoryInUse": "equipment.errors.categoryInUse",
  "equipment.errors.childrenInUse": "equipment.errors.childrenInUse",
  "equipment.errors.equipmentInUse": "equipment.errors.equipmentInUse",
  "equipment.errors.retired": "equipment.errors.retired",
  "equipment.errors.invalidReading": "equipment.errors.invalidReading",
  "equipment.errors.qrMissing": "equipment.errors.qrMissing",
  "equipment.errors.qrInvalid": "equipment.errors.qrInvalid",
  "equipment.errors.qrDuplicate": "equipment.errors.qrDuplicate",
  // Enhetsflytting (equipment-move.ts) bruker både prefiksede koder og korte
  // blokkerings-/varselkoder som mappes til `equipment.errors.<kode>` i API-et.
  "equipment.errors.targetCustomerNotFound": "equipment.errors.targetCustomerNotFound",
  "equipment.errors.targetCustomerDeleted": "equipment.errors.targetCustomerDeleted",
  "equipment.errors.targetSiteMismatch": "equipment.errors.targetSiteMismatch",
  "equipment.errors.crossCustomerChild": "equipment.errors.crossCustomerChild",
  "equipment.errors.contractBlocked": "equipment.errors.contractBlocked",
  "equipment.errors.workOrderCustomerMismatch": "equipment.errors.workOrderCustomerMismatch",
  "equipment.errors.workOrderNumberConflict": "equipment.errors.workOrderNumberConflict",
  "equipment.errors.documentCustomerMismatch": "equipment.errors.documentCustomerMismatch",
  "equipment.errors.targetDepartmentMissing": "equipment.errors.targetDepartmentMissing",
  "equipment.errors.subtreeTooLarge": "equipment.errors.subtreeTooLarge",
  "equipment.errors.stalePreview": "equipment.errors.stalePreview",
  subtreeTooLarge: "subtreeTooLarge",
  crossCustomerChild: "crossCustomerChild",
  workOrderCustomerMismatch: "workOrderCustomerMismatch",
  documentCustomerMismatch: "documentCustomerMismatch",
  contractBlocked: "contractBlocked",
  targetCustomerNotFound: "targetCustomerNotFound",
  targetCustomerDeleted: "targetCustomerDeleted",
  targetSiteMismatch: "targetSiteMismatch",
  targetDepartmentMissing: "targetDepartmentMissing",
  departmentFallback: "departmentFallback",
  noTargetSelected: "noTargetSelected",
  workOrderContractCleared: "workOrderContractCleared",
  workOrderNumberConflict: "workOrderNumberConflict",
  oldContactCleared: "oldContactCleared",

  // ── Vedlikehold (src/server/maintenance.ts) ─────────────────────────────
  "maintenance.errors.invalidInput": "maintenance.errors.invalidInput",
  "maintenance.errors.invalidTrigger": "maintenance.errors.invalidTrigger",
  "maintenance.errors.invalidInterval": "maintenance.errors.invalidInterval",
  "maintenance.errors.invalidMeterInterval": "maintenance.errors.invalidMeterInterval",
  "maintenance.errors.invalidDueDate": "maintenance.errors.invalidDueDate",
  "maintenance.errors.productRequired": "maintenance.errors.productRequired",
  "maintenance.errors.customerMismatch": "maintenance.errors.customerMismatch",
  "maintenance.errors.invalidCustomer": "maintenance.errors.invalidCustomer",
  "maintenance.errors.invalidDepartment": "maintenance.errors.invalidDepartment",
  "maintenance.errors.invalidTemplate": "maintenance.errors.invalidTemplate",
  "maintenance.errors.planInUse": "maintenance.errors.planInUse",
  "maintenance.errors.alreadyGenerated": "maintenance.errors.alreadyGenerated",

  // ── Ordrer (src/server/external-orders.ts) ──────────────────────────────
  "orders.invalidPayload": "orders.invalidPayload",
  "orders.customerRequired": "orders.customerRequired",
  "orders.idempotencyConflict": "orders.idempotencyConflict",
  "orders.invalidPriority": "orders.invalidPriority",
  "orders.invalidDate": "orders.invalidDate",
  "orders.invalidLines": "orders.invalidLines",
  "orders.invalidSite": "orders.invalidSite",

  // ── Anmeldelser (src/server/reviews.ts) ─────────────────────────────────
  "reviews.errors.invalidInput": "reviews.errors.invalidInput",
  "reviews.errors.invalidToken": "reviews.errors.invalidToken",
  "reviews.errors.invalidScore": "reviews.errors.invalidScore",
  "reviews.errors.notDone": "reviews.errors.notDone",
  "reviews.errors.alreadySubmitted": "reviews.errors.alreadySubmitted",
  "reviews.errors.rateLimited": "reviews.errors.rateLimited",

  // ── E-postutsending (src/server/email-outbox.ts) ────────────────────────
  smtp_not_configured: "smtp_not_configured",
  enqueue_failed: "enqueue_failed",
  send_failed: "send_failed",

  // ── SMS (src/server/messaging.ts) ───────────────────────────────────────
  "sms.errors.noConsent": "sms.errors.noConsent",

  // ── Moduler (src/server/modules.ts) ─────────────────────────────────────
  "mod.coreLocked": "mod.coreLocked",
  "module.missingDependencies": "module.missingDependencies",
  "module.hasDependents": "module.hasDependents",
} as const;

/** Unionen av alle kjente feilkoder. */
export type ErrorCode = keyof typeof ERROR_CODES;

/** Er verdien en kode fra registeret? Brukes av feedback-mapper og API-klienter. */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.hasOwn(ERROR_CODES, value);
}
