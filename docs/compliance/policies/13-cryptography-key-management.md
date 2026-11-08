# POL-13 Cryptography and Key Management

| Field | Value |
| --- | --- |
| Policy ID | POL-13 |
| Version | 0.1 readiness draft |
| Owner | Platform Lead |
| Approver | Managing Director |
| Review cadence | Annual, and on algorithm, provider or key change |
| Scope | TLS, passwords, backups, API keys, audit signing, tokens, secrets and key recovery |
| Related ISO Annex A | 5.14, 5.17, 8.20, 8.24 |
| Related SOC 2 | CC6.1, CC6.7, C1.1 |
| Evidence | TLS configuration, key inventory, rotation records, backup encryption config |

## 1. Purpose

Protect data in transit and at rest with approved cryptography, and manage keys
so that compromise, loss or staff departure does not cause data loss or
unauthorised access.

## 2. Approved algorithms and uses

| Use | Approved implementation | Notes |
| --- | --- | --- |
| Transport | TLS 1.2+ (prefer TLS 1.3), HSTS at the proxy | No plaintext HTTP for production; redirect or reject |
| Password storage | bcrypt (`bcryptjs`) with a current cost factor | Never reversible encryption or unsalted hashes |
| Session/token secrets | Cryptographically random values (at least 32 bytes) | Do not derive from passwords |
| API keys / SCIM / iCal tokens | Random token, stored as SHA-256 hash, prefixed for display | Scope, expiry and revocation required |
| Audit integrity | SHA-256 hash chain; HMAC-SHA256 signature for exports when configured | `AUDIT_EXPORT_SIGNING_KEY` is a secret |
| Backup encryption | age (X25519) with a recipient; production fails closed without it | Private identity kept offline/separate |
| Database transport | `sslmode=require` or stronger for external PostgreSQL | Verify provider certificate where supported |
| File/disk encryption | Cloud disk encryption and OS full-disk encryption | Encrypt endpoints and backup storage |
| Webhook authenticity | HMAC-SHA256 with a shared secret and constant-time comparison | Reject unsigned/expired requests |

Do not introduce a new algorithm, library or key store without Security Lead
review. Deprecated algorithms (MD5, SHA-1 for security, DES/3DES, RC4, TLS 1.0/1.1,
static shared secrets for user authentication) are prohibited.

## 3. Secrets management

1. **Storage.** Production secrets live in Azure Key Vault or a protected
   environment file (`0600`) on the host, never in git, images, tickets, chat or
   logs.
2. **Access.** Least privilege; managed identity or a dedicated secret-reader
   role. Humans retrieve secrets only when required and with approval.
3. **Inventory.** Maintain a key inventory with owner, purpose, location,
   creation date, rotation date, expiry and recovery method. The inventory lists
   secret names, not values.
4. **Rotation.** Rotate on schedule, on suspected compromise, on staff departure
   with access, and after a supplier change. Rotate dependent values together.
5. **Revocation.** Revoking a key invalidates sessions/tokens where applicable.
6. **Logging.** Never log secret values, full tokens, passwords, private keys or
   `Authorization` headers. Redact at the logger boundary.
7. **Backups.** Backups never contain the plaintext data; the age identity is
   stored separately. Do not put the identity in the same storage account or
   backup directory.

## 4. Key lifecycle

| Stage | Requirement | Evidence |
| --- | --- | --- |
| Generate | Approved library/CLI; sufficient entropy; no human-chosen secrets | Generation record |
| Distribute | Secret store or encrypted channel; no email/chat | Access record |
| Store | Key Vault/0600 file/offline safe; access list | Inventory |
| Use | Least privilege; application identity; no interactive sharing | Audit log |
| Rotate | Schedule/compromise; overlap where needed; revoke old | Rotation record |
| Recover | Offline copy, two-person access, tested annually | Recovery test |
| Destroy | Only after dependent data/backups expire; certificate | Destruction record |

### 4.1 Suggested rotation intervals

| Secret | Interval | Trigger |
| --- | --- | --- |
| `NEXTAUTH_SECRET` | 12 months | Compromise, staff departure |
| Database passwords | 12 months | Compromise, role change |
| `METRICS_SECRET` | 12 months | Compromise |
| SMTP/SMS/API keys | Per supplier, at least 12 months | Compromise, supplier change |
| SSO client secret | Per IdP policy, at least 12 months | Compromise |
| SCIM/API keys | 90 days default (max 365) | Expiry, compromise |
| `AUDIT_EXPORT_SIGNING_KEY` | 12 months | Compromise |
| Backup age identity | 24 months, with overlap | Compromise, staff departure |
| TLS certificate | Automated renewal (e.g. 90-day) | Expiry, key compromise |

A rotation that breaks restore or login is worse than a planned rotation. Test in
a non-production environment and keep a rollback.

## 5. Key compromise

1. Revoke/rotate the key immediately; invalidate sessions and tokens.
2. Assess what the key protected and for how long.
3. Check logs for misuse; preserve evidence.
4. Notify the Security Lead and Privacy Officer; treat as an incident.
5. If customer data or backups may be affected, follow
   [POL-06](06-incident-response.md).
6. Record the timeline, actions and root cause.

## 6. Key loss

- If a backup identity is lost and no offline copy exists, the affected backups
  are unrecoverable. That is a Critical risk (R-06/R-22).
- Test recovery from the offline copy annually.
- Do not generate a new identity for old backups; it cannot decrypt them.
- Document the decision to destroy unrecoverable backups and the data impact.

## 7. Post-quantum and agility

- Prefer providers/libraries that support crypto-agility.
- Track industry guidance for TLS and key exchange.
- Do not claim post-quantum protection. Plan a migration when standards and
  libraries are production-ready.
- Keep certificate and key inventories so a future migration can identify
  affected systems.

## 8. Roles and evidence

| Role | Responsibility |
| --- | --- |
| Platform Lead | Algorithms, libraries, TLS configuration, key inventory. |
| Operations Lead | Secret store access, rotation execution, backup keys. |
| Security Lead | Reviews compromises, approves exceptions, audits access. |
| Managing Director | Approves high-risk key destruction or exception. |

Evidence: TLS scan/config, key inventory (names only), rotation tickets, secret
store access logs, backup encryption test, restore/key recovery record, incident
records.

## 9. Related documents

- [Access control](02-access-control.md)
- [Backup and restore](08-backup-restore.md)
- [Logging and monitoring](14-logging-monitoring.md)
- [SECURITY.md](../../../SECURITY.md)
- [audit-retention.md](../../../docs/audit-retention.md)
