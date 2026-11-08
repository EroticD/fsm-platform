# Data Classification, Retention and Disposal Matrix

**Organisation:** `[Legal entity]`
**Scope:** Information processed in the FSM Platform managed service and the
supporting ISMS.
**Version:** 0.1 readiness draft, 2026-11-08.
**Owner:** Privacy Officer (personal data), Security Lead (classification).
**Approver:** Managing Director.
**Review cadence:** annual, or when law, contract or data flow changes.

> This matrix is an operational baseline, not legal advice. Retention periods
> marked **confirm** must be approved by counsel and the Privacy Officer before
> they are published in a customer contract or privacy notice. The existing
> implementation details are in [audit-retention.md](../audit-retention.md) and
> [privacy-erasure.md](../privacy-erasure.md); this document does not replace
> those runbooks.

## 1. Classification scheme

| Class | Definition | Examples | Who may access |
| --- | --- | --- | --- |
| **Public** | Approved for public release. | Marketing site, public documentation, published security contact. | Anyone. |
| **Internal** | Routine business information not intended for the public. | Internal procedures, non-sensitive metrics, meeting notes, supplier catalogue. | Workforce with a need to know. |
| **Confidential** | Business information whose disclosure could harm the organisation or a customer. | Source code, architecture, contracts, non-personal customer operational data, internal reports. | Named roles with a need to know; contractors under NDA. |
| **Restricted** | Sensitive personal data, credentials, security records or data whose loss triggers notification or contractual harm. | Customer contact data, portal users, signed reports, photos, audit logs, secrets, backups, HR records. | Explicitly authorised named individuals only; logged where practical. |

### 1.1 Handling rules

| Activity | Public | Internal | Confidential | Restricted |
| --- | --- | --- | --- | --- |
| Storage | Any approved system | Approved internal system | Access-controlled repository/cloud | Encrypted, access-controlled, approved store only |
| Transmission | HTTPS | HTTPS | HTTPS; no personal email | HTTPS/TLS; approved transfer only; no chat/email without approval |
| Sharing | Open | Team need-to-know | Need-to-know + NDA | Explicit owner approval; DPA/transfer check; logged |
| Endpoint copy | Allowed | Allowed | Allowed if encrypted and approved | Avoid; if required, encrypted and approved, removed after use |
| Print | Allowed | Allowed | Avoid; secure print | Prohibited unless approved and logged; secure disposal |
| Disposal | Normal | Normal | Secure delete | Secure delete/crypto-erase; certificate where required |
| Labelling | Public | Internal | Confidential | Restricted — owner and handling note |

### 1.2 Labelling

Documents and exports intended for external use must carry a classification
header when they contain non-public information. The application UI does not
currently display classification labels; access control is the primary
protection. This is a known partial control (ISO 5.13). Customer-facing exports
must be reviewed before release.

## 2. Data inventory and flows

| Data set | Classification | System / location | Purpose | Personal data | Owner |
| --- | --- | --- | --- | --- | --- |
| Customer/tenant master data | Restricted | PostgreSQL | Contract, service delivery, billing reference | Yes (company contact, address, org. no.) | Privacy Officer |
| Customer contacts and portal users | Restricted | PostgreSQL | Communication and customer self-service | Yes | Privacy Officer |
| Sites, equipment and service history | Confidential | PostgreSQL | Service delivery and history | May contain personal data | Operations Lead |
| Jobs, schedules, SLA clocks | Confidential | PostgreSQL | Dispatch and contractual service | May contain personal data | Operations Lead |
| Service reports, revisions, signatures | Restricted | PostgreSQL + uploads | Proof of service | Yes | Operations Lead |
| Photos, attachments, documents, OCR text | Restricted | Uploads + PostgreSQL | Service evidence and document library | Yes | Operations Lead |
| Audit log, holds, tombstones | Restricted | PostgreSQL | Security and accountability | May contain identifiers | Operations Lead |
| Application logs and metrics | Confidential | Container logs, Prometheus | Operations and security | May contain user ID/IP | Operations Lead |
| Backups | Restricted | Local + off-site storage | Recovery | Yes | Operations Lead |
| Workforce accounts and roles | Restricted | Application DB + IdP | Access control | Yes | Operations Lead |
| HR and contractor records | Restricted | HR system | Employment | Yes | People/HR Lead |
| Supplier contracts and DPAs | Confidential | Contract repository | Supplier management | May contain names | Finance/Admin Lead |
| Source code and CI metadata | Confidential | GitHub/GHCR | Product delivery | May contain test data (synthetic) | Engineering Lead |
| Security evidence packs | Confidential/Restricted | Evidence storage | Audit and assurance | May contain personal data | Security Lead |

## 3. Retention schedule

The default application behaviour and the recommended decision are separate.
Where they differ, the organisation must either change the configuration or
document the accepted risk.

| Data set | Default / current behaviour | Recommended retention decision | Legal / contractual basis | Disposal method |
| --- | --- | --- | --- | --- |
| Customer master data | Kept until customer deletion or contract end | Contract term + **confirm** wind-down period; then anonymise/delete | Contract, GDPR storage limitation | [Privacy erasure](../privacy-erasure.md) |
| Customer contacts / portal users | Kept with customer | Same as customer master data; deactivate on contract end | Contract, GDPR | Erasure procedure |
| Jobs, sites, equipment, service history | Kept with customer | **Confirm** operational/limitation period (assumed 5 years after last service) | Contract, Norwegian limitation/record rules to confirm | Anonymise/delete |
| Signed service reports and report PDFs | Kept as evidence; PDF retained unchanged on erasure | **Confirm** legal retention (assumed 5 years after service); legal hold overrides | Service evidence, bookkeeping/documentation rules to confirm | Retain until expiry; then secure deletion |
| Report photos and technician signatures | Kept as evidence | Same as report | Service evidence | Secure deletion |
| Customer attachments / documents | Deleted by erasure | Customer-controlled; delete on request unless legal hold | Contract, GDPR | File + metadata deletion |
| Audit log (`AuditLog`) | 365 days default; configurable; holds override | **365 days minimum**, extend for contractual/legal need; legal hold overrides | Security, accountability, dispute | Retention job with tombstones; see [audit-retention.md](../audit-retention.md) |
| Audit holds / tombstones | Until released / as long as needed to prove chain | Keep while the related record or dispute exists | Legal hold, integrity | Controlled deletion by maintenance role |
| Application logs | Rotated at 10 MB × 3 per container by default | 30–90 days operational; security-relevant logs longer if required | Operations, security | Rotation/deletion |
| Metrics | Prometheus retention (deployment-specific) | 30–90 days, or as needed for capacity/incident review | Operations | Prometheus retention |
| Local backups | 30 days default (`RETENTION_DAYS`) | 30 days local; **confirm** off-site lifecycle (often 90–365 days) | Recovery, contract, legal hold | Lifecycle + secure deletion |
| Off-site backups | Deployment-specific | Minimum 30 days; align with RPO/RTO and legal hold | Recovery, contract | Lifecycle + deletion certificate |
| Workforce accounts | Life of employment | Disable at exit; retain minimal audit record | Employment, security | Anonymise/delete after retention |
| HR records | HR system policy | **Confirm** with HR/counsel | Employment law | HR secure disposal |
| Supplier contracts / DPAs | Contract term | Contract term + limitation period (**confirm**) | Contract, tax/accounting | Secure deletion |
| Security evidence (access reviews, incidents, tests) | Ad hoc | At least current audit cycle + 1 year (3 years recommended) | Audit, contract | Secure deletion |
| Training records | Ad hoc | Employment + 3 years (**confirm**) | Audit, employment | Secure deletion |
| Incident records | Ad hoc | 3 years after closure (**confirm**) | Legal, audit | Secure deletion |
| Consent records (SMS/marketing) | Application records | Withdrawal + 3 years (**confirm**) | GDPR accountability | Secure deletion |
| Test data | Synthetic | Not retained in production; CI ephemeral | Data minimisation | Ephemeral |

### 3.1 Overloaded `RETENTION_DAYS`

`RETENTION_DAYS` is used by `scripts/backup.sh` for local backup retention
(default 30) and by the application job worker for hard deletion of soft-deleted
jobs (default 365). Do not source the application `.env` into the backup job
without overriding it. See
[BACKUP-RESTORE.md](../BACKUP-RESTORE.md#42-miljøvariabler). A single
misconfigured value can either delete backups too early or retain data too long.

## 4. Legal hold and conflict resolution

1. A legal hold on a job, report or audit record overrides normal deletion.
2. Before any erasure or retention purge, check:
   - `legalHold` on jobs and reports;
   - `AuditHold` for the relevant entity or audit row;
   - contractual or litigation instructions from the Managing Director.
3. If a data-subject erasure request conflicts with a legal hold, do not delete.
   Record the decision, the legal basis and the reviewer. Inform the data
   subject according to legal advice.
4. Backups are not edited in place. If data must be corrected or deleted, follow
   the documented restore-to-isolated-environment procedure and record why the
   backup copy remains until its lifecycle expires.

## 5. Data-subject rights procedure

The organisation must determine whether it is controller or processor for each
data set before responding. In managed hosting, the customer is usually the
controller for customer content and the organisation is the processor. For
workforce and supplier data, the organisation is the controller.

| Right | Procedure | Owner | Target |
| --- | --- | --- | --- |
| Access | Verify identity, locate data by customer/tenant, export relevant records, redact third-party data | Privacy Officer | 1 month (extendable by 2 months with notice) |
| Rectification | Correct inaccurate data in the application or instruct the controller | Privacy Officer | 1 month |
| Erasure | Use [privacy-erasure.md](../privacy-erasure.md); check legal hold; document outcome | Privacy Officer | 1 month |
| Restriction | Suspend processing for the affected records; record the restriction | Privacy Officer | 1 month |
| Portability | Export structured data in a common format | Privacy Officer | 1 month |
| Objection | Assess compelling legitimate grounds; stop processing if required | Privacy Officer | 1 month |
| Automated decision-making | Confirm whether any exists; currently no solely automated decisions with legal effect are documented | Privacy Officer | 1 month |

All requests must be logged with date received, requester, scope, decision,
response date and evidence. The request log is not yet implemented
([GAP G-13](GAP-ANALYSIS.md#g-13-privacy-programme-and-data-subject-request-log)).
Do not use the erasure runbook without checking the request log requirement.

## 6. Disposal

| Media / data | Method | Evidence |
| --- | --- | --- |
| Database rows | Application deletion/anonymisation in a transaction; audit log entry | Erasure audit row, counts |
| Files | Delete file and metadata; verify no orphan remains | Deletion log, spot check |
| Backups | Lifecycle expiry; crypto-erase by destroying the key where supported | Lifecycle policy, deletion record |
| Endpoints | Full-disk crypto-erase or certified sanitisation | Disposal certificate or signed record |
| Paper | Cross-cut shred or approved confidential waste | Disposal log |
| Removable media | Crypto-erase or physical destruction | Certificate/record |
| Secrets | Revoke/rotate, delete from secret store, invalidate sessions | Rotation record, audit log |

Deletion of customer data does not automatically delete backups. Document the
backup retention decision in the privacy notice and the customer contract. See
[data retention](../privacy-erasure.md) and
[backup security](../BACKUP-RESTORE.md#8-sikkerhet-personvern-og-etterlevelse).

## 7. Retention review record

| Review date | Data set | Current setting | Decision | Legal check by | Approved by |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

A retention period is not approved until the legal basis is recorded. "We have
always kept it" is not a legal basis.
