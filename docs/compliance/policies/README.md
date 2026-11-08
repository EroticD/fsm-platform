# Policy and Procedure Index

**Organisation:** `[Legal entity]`
**Version:** 0.1 readiness draft, 2026-11-08.
**Owner:** Security Lead.
**Approver:** Managing Director.
**Review:** annual, or after a material change, incident or audit finding.

> Policies are approved by the Managing Director and owned by the named role.
> A policy without an approval record is a draft, not an operating control.
> Each policy states its control owners, review cadence, evidence sources and
> related runbooks. The technical runbooks remain authoritative for commands.

## 1. Policy set

| ID | Policy | Owner | Review | Primary ISO Annex A | Primary SOC 2 | Evidence source |
| --- | --- | --- | --- | --- | --- | --- |
| POL-01 | [Information security policy](01-information-security-policy.md) | Managing Director | Annual | 5.1, 5.2, 5.4, 6.1–6.6 | CC1, CC2, CC5 | Signed approval, acknowledgements, management review |
| POL-02 | [Access control and access review](02-access-control.md) | Operations Lead | Annual; review quarterly | 5.15–5.18, 8.2–8.5, 8.18 | CC6.1–CC6.3, CC6.5 | Access review, joiner/mover/leaver records, IdP export |
| POL-03 | [Change management](03-change-management.md) | Engineering Lead | Annual | 8.19, 8.32 | CC8.1 | PRs, CI runs, release approvals, rollback records |
| POL-04 | [Secure SDLC](04-secure-sdlc.md) | Engineering Lead | Annual | 5.8, 8.25–8.29, 8.31, 8.33 | CC8.1, PI1.2 | PR checklist, tests, threat model, scan results |
| POL-05 | [Vulnerability management](05-vulnerability-management.md) | Platform Lead | Annual; review monthly | 5.7, 8.7, 8.8 | CC7.1, CC6.6 | Dependabot, npm audit, Trivy, vulnerability register |
| POL-06 | [Incident response](06-incident-response.md) | Security Lead | Annual; exercise annually | 5.24–5.28, 6.8 | CC7.2–CC7.5, CC2.3 | Incident log, exercise report, notifications |
| POL-07 | [Business continuity and disaster recovery](07-business-continuity-dr.md) | Operations Lead | Annual; exercise annually | 5.29, 5.30, 8.14 | A1.1–A1.3, CC7.5 | BIA, BCP, DR exercise, RTO/RPO measurements |
| POL-08 | [Backup and restore](08-backup-restore.md) | Operations Lead | Annual; test quarterly | 8.13, 5.33 | A1.2, A1.3, C1.2 | Backup status, checksums, restore-test log |
| POL-09 | [Supplier and subprocessor management](09-supplier-management.md) | Finance/Admin Lead | Annual | 5.19–5.23 | CC9.2, CC6.4 | Supplier register, DPA, attestation review |
| POL-10 | [Data retention and disposal](10-data-retention-disposal.md) | Privacy Officer | Annual | 5.33, 8.10, 8.12 | C1.2, P1.4 | Retention matrix, deletion records, disposal certificates |
| POL-11 | [Privacy and GDPR](11-privacy-gdpr.md) | Privacy Officer | Annual | 5.31, 5.34 | P1.1–P1.8 | Article 30 record, notices, DPAs, request log |
| POL-12 | [Acceptable use](12-acceptable-use.md) | Security Lead | Annual | 5.10, 5.11, 6.7, 7.7, 7.9, 8.1 | CC1.1, CC6.7 | Signed acknowledgement, device inventory, exit checklist |
| POL-13 | [Cryptography and key management](13-cryptography-key-management.md) | Platform Lead | Annual and on algorithm change | 5.14, 5.17, 8.20, 8.24 | CC6.1, CC6.7 | Key inventory, rotation record, TLS/backup config |
| POL-14 | [Logging and monitoring](14-logging-monitoring.md) | Operations Lead | Annual | 8.15–8.18 | CC7.1–CC7.3, CC2.1 | Log config, alerts, retention, clock sync |
| POL-15 | [Physical and environmental security](15-physical-environmental.md) | Operations Lead | Annual | 7.1–7.14 | CC6.4, A1.2 | Azure attestations, office access, disposal records |
| POL-16 | [Risk management](16-risk-management.md) | Security Lead | Annual; review quarterly | 5.1, 6.1 (ISO risk) | CC3, CC5, CC9 | Risk register, treatment plans, acceptance records |
| POL-17 | [Internal audit](17-internal-audit.md) | Internal Auditor | Annual | 5.35, 5.36 | CC4.1, CC4.2 | Audit plan, report, corrective actions |
| POL-18 | [Management review](18-management-review.md) | Managing Director | Annual, plus mid-year | 5.4, 5.36 | CC1.2, CC4, CC5.3 | Minutes, actions, KPI pack |
| POL-19 | [Training and awareness](19-training-awareness.md) | People/HR Lead | Annual | 6.3, 6.1 | CC1.4, CC2.2 | Training register, completion records, phishing exercise |

## 2. Required approval and acknowledgement

1. The Managing Director approves each policy and records the approval date in
   the policy header or the management review minutes.
2. Every worker and contractor with access to production, source code or
   restricted data acknowledges the information security policy, acceptable use
   policy and incident reporting procedure at onboarding and annually.
3. A policy change that affects customer commitments is reviewed by the Privacy
   Officer and, where relevant, legal counsel.
4. The Security Lead maintains the policy index and ensures the evidence pack
   contains the current versions.

## 3. Exceptions

An exception to a policy must be recorded with:

- the policy and requirement being waived;
- the reason and affected assets/data;
- the compensating control;
- the risk ID and residual score;
- the approver (Managing Director for High/Critical risk);
- an expiry date of no more than 12 months.

Exceptions are reviewed at management review. A permanent exception is a policy
change and must be approved as such.

## 4. Related runbooks

- [Operations and troubleshooting](../../../docs/OPERATIONS.md)
- [Backup and restore](../../../docs/BACKUP-RESTORE.md)
- [Audit log retention and evidence export](../../../docs/audit-retention.md)
- [Privacy erasure](../../../docs/privacy-erasure.md)
- [Security policy and secure defaults](../../../SECURITY.md)
- [Monitoring and alerting](../../../deploy/monitoring/README.md)
- [Systemd backup timers](../../../deploy/systemd/README.md)
- [Azure deployment](../../../docs/AZURE.md)
