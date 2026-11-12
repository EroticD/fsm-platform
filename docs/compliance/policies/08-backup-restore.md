# POL-08 Backup and Restore

| Field | Value |
| --- | --- |
| Policy ID | POL-08 |
| Version | 0.1 readiness draft |
| Owner | Operations Lead |
| Approver | Managing Director |
| Review cadence | Annual; restore test weekly, full exercise quarterly |
| Scope | PostgreSQL, uploads volume, configuration/secrets recovery material, audit evidence |
| Related ISO Annex A | 8.13, 5.33 |
| Related SOC 2 | A1.2, A1.3, C1.2, PI1.5 |
| Evidence | Backup status, checksums, freshness alerts, restore-test log, DR exercise report |

## 1. Purpose

Protect the confidentiality, integrity and availability of platform data by
taking encrypted, verified backups and proving that they can be restored within
the documented objectives.

## 2. Scope

| Item | Backup method | Frequency | Retention |
| --- | --- | --- | --- |
| PostgreSQL database | `pg_dump` streamed through gzip, optionally age-encrypted; Azure PITR where used | Daily (timer); PITR continuous | Local 30 days default; off-site per lifecycle |
| Uploads volume | `tar` streamed and optionally age-encrypted | Daily | Same as database |
| Application image/version | Pinned image digest and release metadata | Every release | Supported versions |
| Configuration | `.env.example`, compose, proxy, systemd, infrastructure docs in git | Every change | Git history |
| Secrets recovery material | Key Vault/offline copy; age identity | On rotation | As long as backups exist |
| Audit exports | Application evidence/audit export | Per audit/incident | Per retention matrix |

The authoritative commands are in
[BACKUP-RESTORE.md](../../../docs/BACKUP-RESTORE.md) and
[scripts/backup.sh](../../../scripts/backup.sh). This policy does not replace them.

## 3. Requirements

1. **Encryption.** Production backups must be encrypted with age. `backup.sh`
   fails closed when `NODE_ENV=production` or `REQUIRE_BACKUP_ENCRYPTION=true`
   and `BACKUP_AGE_RECIPIENT` is missing.
2. **Key separation.** The private age identity must not be stored with the
   backups. Keep an offline copy and a protected on-host copy only where needed
   for automated restore tests.
3. **Integrity.** Every backup has a SHA-256 checksum. Freshness and checksum are
   monitored; a failed check alerts.
4. **Off-site copy.** At least one copy is outside the primary host/region.
   `BACKUP_REMOTE` or Azure Blob with immutability/soft delete.
5. **3-2-1.** At least three copies, two media/locations, one off-site. The
   quarter exercise must prove the off-site copy is usable.
6. **Access.** Only the backup operator and named deputies can read backups.
   Backup files are `0600`/`0700`; cloud access uses least-privilege RBAC or
   managed identity.
7. **No unencrypted data on disk.** Encryption happens in the stream; a
   half-written file is removed.
8. **Legal hold.** Do not delete a backup that may contain evidence under a hold
   until the hold is released and legal confirms.
9. **Restore safety.** Never restore over production without a verified backup and
   a rollback point. Use an isolated environment for tests.

## 4. Schedule and monitoring

- Backup timer: daily, as configured in
  [deploy/systemd/fsm-backup.timer](../../../deploy/systemd/fsm-backup.timer).
- Freshness check: daily, threshold `BACKUP_MAX_AGE_HOURS` (default 26).
- Restore test: weekly, `scripts/restore-test.sh`.
- Full exercise: quarterly or annually as defined in [POL-07](07-business-continuity-dr.md).
- Alerts: `FsmBackupStale`, `FsmBackupAgeHigh`, checksum failure, remote copy
  failure, disk low. See [deploy/monitoring/README.md](../../../deploy/monitoring/README.md).

## 5. Restore procedure (summary)

1. Declare the need and choose the recovery point. Record why.
2. Verify the backup checksum and, for encrypted backups, the matching identity.
3. Prepare an isolated target database/volume. Do not overwrite production.
4. Restore with `ON_ERROR_STOP=1`; never use `prisma migrate reset` or `db push`
   in production.
5. Run the application readiness check and smoke tests.
6. Verify row counts, recent records, audit-chain integrity and a sample of
   uploads.
7. Cut over with a recorded rollback point; monitor.
8. Record operator, timestamps, backup ID, result, deviations and measured RTO.
9. Delete the isolated test environment and data after verification.

The detailed runbook, including PITR and uploads-only restore, is in
[BACKUP-RESTORE.md](../../../docs/BACKUP-RESTORE.md#6-gjenoppretting--runbook).

## 6. Testing

| Test | Frequency | Pass criteria | Evidence |
| --- | --- | --- | --- |
| Backup completes | Daily | Non-empty, checksum written, freshness within threshold | Status file, alert |
| Checksum verification | Daily | Stored hash matches | `backup-freshness.sh` |
| Remote copy verification | Daily | `rclone check` or Azure equivalent passes | Log |
| Automated restore | Weekly | Database starts, migrations match, smoke query passes | Restore-test log |
| Full DR | Quarterly/annual | RTO/RPO met, uploads and app restored | Exercise report |
| Key recovery | Annual | Offline identity decrypts a test backup | Record |

A restore test that only checks that a dump file exists does not prove
recoverability. It must start a database and query real tables.

## 7. Roles

| Role | Responsibility |
| --- | --- |
| Operations Lead | Owns backup jobs, keys, restore execution and records. |
| Backup Operator | Runs backup/restore under the procedure; may be the same person with a second approver. |
| Security Lead | Reviews encryption, access and incident evidence. |
| Managing Director | Approves destructive restore and retention exceptions. |

Destructive restore or deletion of backups requires two-person approval where
staffing allows. Record the approver.

## 8. Retention and disposal

- Local `RETENTION_DAYS` defaults to 30 and is used by `backup.sh`.
- Application soft-delete retention also uses `RETENTION_DAYS` in some paths;
  do not share the same value blindly. See
  [BACKUP-RESTORE.md](../../../docs/BACKUP-RESTORE.md#42-miljøvariabler).
- Off-site lifecycle is provider/contract-specific; align it with the retention
  matrix and customer commitments.
- Destroy keys only after all backups encrypted with them have expired, unless
  crypto-erasure is the intended disposal method and is documented.

## 9. Evidence

- Dated backup status and checksum files.
- Alert history and acknowledgement.
- Restore-test log with operator, backup ID, timestamps and result.
- Full exercise report with measured RTO/RPO.
- Key rotation and recovery records (no key material).
- Retention/lifecycle configuration screenshots or exports.

## 10. Related documents

- [Business continuity and DR](07-business-continuity-dr.md)
- [Data retention and disposal](10-data-retention-disposal.md)
- [Cryptography and key management](13-cryptography-key-management.md)
- [BACKUP-RESTORE.md](../../../docs/BACKUP-RESTORE.md)
- [deploy/systemd/README.md](../../../deploy/systemd/README.md)
