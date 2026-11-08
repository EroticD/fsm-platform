# POL-10 Data Retention and Disposal

| Field | Value |
| --- | --- |
| Policy ID | POL-10 |
| Version | 0.1 readiness draft |
| Owner | Privacy Officer |
| Approver | Managing Director |
| Review cadence | Annual, and when law, contract or data flow changes |
| Scope | Customer data, personal data, audit records, backups, logs, documents and media |
| Related ISO Annex A | 5.33, 8.10, 8.12 |
| Related SOC 2 | C1.2, P1.4, P1.5 |
| Evidence | Retention matrix, deletion records, legal-hold checks, disposal certificates |

## 1. Purpose

Keep information only as long as necessary, delete it securely when the
retention period ends, and never destroy records that are under a legal hold or
required for an investigation.

## 2. Scope and authority

The authoritative retention decisions are in
[DATA-CLASSIFICATION-RETENTION.md](../DATA-CLASSIFICATION-RETENTION.md). The
implementation details are in:

- [audit-retention.md](../../../docs/audit-retention.md) — audit log hash chain,
  retention setting, holds, tombstones and export;
- [privacy-erasure.md](../../../docs/privacy-erasure.md) — customer erasure and
  anonymisation;
- [BACKUP-RESTORE.md](../../../docs/BACKUP-RESTORE.md) — backup retention and
  restoration.

Where those documents conflict with this policy, the stricter legal requirement
and the approved retention matrix prevail. Do not change a retention setting
without Privacy Officer approval.

## 3. Principles

1. **Documented purpose.** Every data set has a purpose, owner and retention
   decision.
2. **Storage limitation.** Retain only as long as needed for the purpose,
   contract, law or legal hold.
3. **Legal hold overrides deletion.** Check holds before any purge.
4. **Backups are not edited in place.** They expire through lifecycle or
   crypto-erasure; a data-subject request may require a restore-to-isolated-
   environment procedure.
5. **Audit records are protected.** The audit log is append-only and
   hash-chained. Retention runs through the documented job and leaves
   tombstones.
6. **Deletion is verified.** A record that says "deleted" without a check is not
   evidence.
7. **No covert retention.** Do not keep "just in case" copies outside the
   approved systems.

## 4. Retention operation

| Activity | Frequency | Owner | Evidence |
| --- | --- | --- | --- |
| Review retention matrix | Annual | Privacy Officer | Approved matrix |
| Configure audit retention | On change | Operations Lead | Setting export/screenshot |
| Run audit purge | Daily via job | Operations Lead | Job log, tombstones |
| Review legal holds | Quarterly and on request | Privacy Officer | Hold register |
| Delete/anonymise customer data | On request/contract end | Privacy Officer | Erasure audit row |
| Expire backups | Per lifecycle | Operations Lead | Lifecycle policy, deletion log |
| Dispose of media/endpoints | On retirement | Operations Lead | Certificate/record |

## 5. Deletion procedure

1. Confirm the data set and legal basis.
2. Check `legalHold` on jobs/reports and `AuditHold` for audit records.
3. Confirm whether the customer is controller and whether instructions are
   required.
4. Take a backup if the operation is unusual or large; record the backup ID.
5. Execute the approved deletion/anonymisation (application function or
   maintenance task).
6. Verify: row counts, file existence, search/export, cache and derived data
   (OCR text, thumbnails, PDFs).
7. Record who, what, when, why, scope, result and approver.
8. Update the request log and, where relevant, the customer.

Never delete audit rows directly. The audit chain would break and the
accountability record would be lost. Use the retention job and holds.

## 6. Equipment and media disposal

| Item | Method | Evidence |
| --- | --- | --- |
| Laptop/phone | Full-disk crypto-erase, then factory reset; or certified destruction | Disposal certificate or signed record |
| Disk/SSD | Crypto-erase or physical destruction | Certificate |
| Backup media | Crypto-erase by key destruction where supported; otherwise physical destruction | Key destruction record |
| Paper | Cross-cut shred or confidential waste | Disposal log |
| USB/removable media | Crypto-erase or destroy | Record |

Before disposal, remove accounts, tokens, certificates, local caches and
customer data. A factory reset without encryption is not sufficient for
restricted data.

## 7. Legal hold

A hold may arise from litigation, a regulator, a customer dispute or an
investigation. The Managing Director or Privacy Officer issues it in writing.
The hold:

- identifies the data, systems and custodians;
- overrides normal retention and erasure;
- is logged in the hold register;
- is reviewed at least quarterly;
- is released only in writing by the issuer.

Do not delete backups that may contain held data. Document the backup retention
decision.

## 8. Exceptions

A retention exception requires a legal basis, Privacy Officer approval and a
risk record. "We need it for analytics" is not a legal basis unless the purpose
is lawful, documented and minimised.

## 9. Evidence and metrics

| Metric | Target | Source |
| --- | --- | --- |
| Data sets with an approved retention decision | 100% | Matrix |
| Deletion requests completed within one month | 100% | Request log |
| Audit purges with tombstones | 100% | Job log |
| Legal holds reviewed quarterly | 100% | Hold register |
| Media disposal records | 100% | Disposal log |
| Unapproved retention settings | 0 | Configuration review |

## 10. Related documents

- [Data classification and retention](../DATA-CLASSIFICATION-RETENTION.md)
- [Privacy and GDPR](11-privacy-gdpr.md)
- [Backup and restore](08-backup-restore.md)
- [audit-retention.md](../../../docs/audit-retention.md)
- [privacy-erasure.md](../../../docs/privacy-erasure.md)
