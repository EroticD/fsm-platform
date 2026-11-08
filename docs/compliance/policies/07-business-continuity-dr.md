# POL-07 Business Continuity and Disaster Recovery

| Field | Value |
| --- | --- |
| Policy ID | POL-07 |
| Version | 0.1 readiness draft |
| Owner | Operations Lead |
| Approver | Managing Director |
| Review cadence | Annual; exercise annually and after a major architecture change |
| Scope | Hosting, database, uploads, backups, DNS/TLS, people, suppliers and customer communications |
| Related ISO Annex A | 5.29, 5.30, 8.14 |
| Related SOC 2 | A1.1–A1.3, CC7.5, CC9.1 |
| Evidence | BIA, BCP, DR plan, exercise report, measured RTO/RPO, action log |

## 1. Purpose

Maintain the delivery of critical services during disruption and recover within
defined objectives. The plan must be realistic for a small vendor with a single
application host and a cloud database.

## 2. Business impact analysis (BIA)

The BIA must be completed before the first DR exercise. It identifies:

- critical services and their maximum tolerable downtime;
- dependencies (Azure, GitHub, DNS, TLS, SMTP/SMS, people, keys);
- data loss tolerance for database and uploads;
- manual workarounds;
- contractual and legal obligations;
- minimum staffing and decision authority.

| Service | Criticality | Max tolerable downtime | RTO target | RPO target | Manual workaround |
| --- | --- | --- | --- | --- | --- |
| Customer login and job dispatch | High | 8 hours | 2 hours | 24 hours | Export job list from last report; contact customers by phone |
| Report completion and signature | High | 8 hours | 2 hours | 24 hours | Paper form approved by customer, entered later |
| Customer portal | Medium | 24 hours | 4 hours | 24 hours | Email/phone |
| PDF/OCR and document library | Medium | 24 hours | 4 hours | 24 hours | Use source documents; regenerate later |
| Audit log and evidence export | High | 24 hours | 4 hours | 24 hours | Do not operate without audit trail; restore before resuming |
| Backups and restore | Critical | 4 hours | 2 hours | Last verified backup | Off-site copy |
| Billing/invoicing integration | Low | 72 hours | 24 hours | 24 hours | Manual invoice |

These are planning targets. The real RTO is the measured time in an exercise.
See [BACKUP-RESTORE.md](../../../docs/BACKUP-RESTORE.md#3-rpo-og-rto).

## 3. Continuity strategies

| Scenario | Strategy | Dependency | Evidence |
| --- | --- | --- | --- |
| Application host failure | Rebuild from pinned image on a new host; restore DB/uploads; update DNS | IaC/runbook, image, backups, DNS | Exercise report |
| Database failure/corruption | Restore latest verified dump; or PITR to a new Azure server | Backup, key, migration role | Restore log |
| Uploads loss | Restore volume from encrypted backup | Off-site copy, age identity | Restore log |
| Ransomware | Isolate, rebuild, restore clean data, rotate keys | Immutable backup, incident plan | Exercise report |
| Loss of key | Use offline copy; if unavailable, data is unrecoverable | Key escrow, two-person access | Key test |
| Azure regional outage | Wait for provider recovery or rebuild in another region; document data residency impact | Secondary region decision | BIA |
| GitHub/GHCR outage | Deploy an already pulled image; source recovery from local clone | Local image/cache, clone | Exercise |
| DNS/TLS failure | Use registrar fallback, reissue certificate | Registrar/TLS account access | Contact list |
| Loss of key person | Deputy performs restore/deploy | Documented runbook, cross-training | Exercise |
| Supplier outage (SMS/SMTP) | Queue and retry; use alternate provider if configured | Provider abstraction | Incident record |

## 4. Roles and decision authority

| Role | Responsibility |
| --- | --- |
| Crisis Lead | Managing Director or delegate; declares disaster, approves spend and customer communication. |
| Recovery Lead | Operations Lead; executes restore and infrastructure rebuild. |
| Security Lead | Confirms clean state, investigates cause, preserves evidence. |
| Privacy Officer | Assesses personal-data impact and notification. |
| Communications | Customer/status updates and support triage. |
| All staff | Follow instructions, avoid ad-hoc restores, document actions. |

If a role holder is unavailable, the deputy acts. Record the delegation.

## 5. Plan maintenance

- Review annually and after a material architecture, supplier, region or key
  change.
- Keep a printed/offline contact list and recovery steps for the case where the
  platform is unavailable.
- Store the plan and keys separately from the production host.
- Update the plan after every exercise or incident.
- Do not store production secrets in the plan.

## 6. Testing

| Test | Frequency | Scope | Evidence |
| --- | --- | --- | --- |
| Automated restore test | Weekly | Latest backup to isolated database | `restore-test.sh` log |
| Full database restore | Quarterly | Database to new database/host | Measured RTO, checks |
| Full disaster exercise | Annually | Database + uploads + app + DNS/TLS simulation | Exercise report |
| Key recovery test | Annually | age identity from offline copy | Record, no key material in evidence |
| Contact/escalation drill | Annually | Incident and crisis roles | Attendance/record |
| Supplier failover | Annually or on change | SMS/SMTP/backup | Test record |

Test rules:

1. Never restore over production without a verified backup and a rollback point.
2. Use an isolated environment; do not expose restored customer data.
3. Record start/end time, backup ID, operator, result and deviations.
4. Delete the test environment and data after verification, unless retention is
   required.
5. A failed test is an incident/action, not a silent retry.

## 7. Communications

- Internal: incident channel, phone tree, named deputies.
- Customer: status page or direct email approved by the Managing Director.
- Regulator: Privacy Officer and legal counsel.
- Supplier: support case and account manager.
- Do not speculate about cause, scope or recovery time. State what is known,
  what is being done and when the next update will come.

## 8. Evidence and metrics

| Metric | Target | Source |
| --- | --- | --- |
| BIA completed and approved | Annual | BIA record |
| Full DR exercise completed | Annual | Exercise report |
| Measured RTO within target | 100% or documented deviation | Exercise report |
| Backup restore verified | Weekly | Restore log |
| Corrective actions closed | ≥ 90% on time | Action log |
| Contact list tested | Annual | Drill record |

## 9. Related documents

- [Backup and restore](08-backup-restore.md)
- [Incident response](06-incident-response.md)
- [Supplier management](09-supplier-management.md)
- [BACKUP-RESTORE.md](../../../docs/BACKUP-RESTORE.md)
- [OPERATIONS.md](../../../docs/OPERATIONS.md)
