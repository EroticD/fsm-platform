# POL-14 Logging and Monitoring

| Field | Value |
| --- | --- |
| Policy ID | POL-14 |
| Version | 0.1 readiness draft |
| Owner | Operations Lead |
| Approver | Managing Director |
| Review cadence | Annual; alert review quarterly |
| Scope | Application logs, audit log, access logs, metrics, alerts, proxy and host logs |
| Related ISO Annex A | 8.15–8.18 |
| Related SOC 2 | CC7.1–CC7.3, CC2.1, CC4.1 |
| Evidence | Log configuration, alert rules, acknowledgement records, retention settings, clock sync |

## 1. Purpose

Detect security and operational events, support investigation and accountability,
and retain logs long enough to investigate incidents and meet contractual
obligations without logging secrets or unnecessary personal data.

## 2. What must be logged

| Event class | Examples | Destination | Retention |
| --- | --- | --- | --- |
| Authentication | Login success/failure, 2FA setup/reset, SSO/SCIM events, logout | Application log/audit log | 30–90 days operational; audit per retention |
| Authorization | Denied access, cross-department attempt, API scope denial | Application log | 30–90 days |
| Administrative change | User/role/permission, API key, SSO/SCIM, settings | Audit log | Audit retention |
| Customer data change | Create/update/delete of jobs, reports, customers, files | Audit log where implemented | Audit retention |
| Security-sensitive action | Break-glass, export, legal hold, erasure, restore | Audit log | Audit retention |
| System/ops | Start/stop, readiness, migrations, backup, restore, job failure | Container/systemd log, metrics | 30 days local; provider per config |
| Network/proxy | TLS errors, rate limits, blocked requests | Proxy log | 30–90 days |
| Supplier | Delivery failures, webhook signature failure, dead letters | Application log/metrics | 30–90 days |

The application audit log is hash-chained and append-only; see
[audit-retention.md](../../../docs/audit-retention.md). Do not confuse operational
logs with the business audit trail.

## 3. Prohibited log content

Never log:

- passwords, password hashes, 2FA codes, recovery codes;
- session cookies, `Authorization` headers, API keys, SCIM/iCal tokens;
- private keys, age identities, `NEXTAUTH_SECRET`, database URLs with passwords;
- full customer reports, signatures, photos or free-text personal data unless
  necessary and approved;
- payment card data or special-category data.

Redact at the logger boundary, not in the viewer. A log line that contains a
secret is a security incident even if access is restricted.

## 4. Log integrity and access

- Application logs are structured JSON with timestamp, level, message, request
  ID and, where appropriate, user ID.
- Audit log integrity is protected by the SHA-256 chain, a database transaction
  lock and restricted grants. Runtime may insert but not update/delete audit
  rows.
- Log access is limited to operations/security roles. Do not use production logs
  as a data source for analytics without approval.
- Export or share logs only through an approved channel with redaction.
- Protect logs from tampering; centralize where practical.

## 5. Clock synchronization

- Hosts and databases use NTP/provider time synchronization.
- Application ordering that must be reliable uses the database sequence
  (`AuditLog.seq`), not wall-clock timestamps alone.
- Time zone is documented (Europe/Oslo for display; UTC for storage/export).
- A large clock drift is an operational incident; investigate before trusting
  timelines.

## 6. Monitoring and alerting

Required signals:

- readiness/database/uploads;
- disk usage and capacity;
- process restart/uptime;
- backup age, freshness, checksum and remote copy;
- failed document/OCR jobs;
- SMS dead letters and notification email failures;
- SLA cleanup staleness/failure;
- authentication anomaly (where available);
- certificate expiry;
- error rate/latency (where available).

Alert routing and thresholds are in
[deploy/monitoring/README.md](../../../deploy/monitoring/README.md). Every alert
must have an owner, a first response step and a route that someone actually
monitors. An alert that nobody acknowledges is not a control.

## 7. Review and response

| Activity | Frequency | Owner | Evidence |
| --- | --- | --- | --- |
| Alert review/tuning | Quarterly | Operations Lead | Review notes |
| Failed login/access anomaly review | Monthly (or automated) | Security Lead | Review record |
| Backup/restore alert review | Weekly | Operations Lead | Alert acknowledgement |
| Audit log integrity check | Monthly/quarterly | Operations Lead | `npm run audit:verify` output |
| Log retention check | Quarterly | Operations Lead | Configuration/size report |
| Incident from alert | As incurred | Incident Lead | Incident record |

## 8. Retention

Operational logs are rotated (for example 10 MB × 3 per container). Security-
relevant logs may need longer retention for investigations. The audit log
default is 365 days and is configurable; legal hold overrides deletion. Do not
shorten retention without Privacy Officer approval. See
[DATA-CLASSIFICATION-RETENTION.md](../DATA-CLASSIFICATION-RETENTION.md).

## 9. Evidence

- Logging configuration and redaction tests.
- Alert rules and notification test.
- Sample alert acknowledgement and incident record.
- Audit-chain verification output.
- Clock synchronization configuration.
- Retention setting and rotation policy.
- Access list for log systems.

## 10. Related documents

- [Incident response](06-incident-response.md)
- [Cryptography and key management](13-cryptography-key-management.md)
- [Data retention and disposal](10-data-retention-disposal.md)
- [audit-retention.md](../../../docs/audit-retention.md)
- [deploy/monitoring/README.md](../../../deploy/monitoring/README.md)
- [OPERATIONS.md](../../../docs/OPERATIONS.md)
