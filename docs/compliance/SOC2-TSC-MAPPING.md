# SOC 2 Trust Services Criteria Mapping

**Organisation:** `[Legal entity]`
**Service:** FSM Platform managed service (see [scope](README.md#2-scope)).
**Framework:** AICPA Trust Services Criteria (2017, including the 2022 points of
focus revisions).
**Version:** 0.1 readiness draft, 2026-11-08.
**Owner:** Security Lead.
**Auditor:** `[CPA firm]` — not engaged at the time of this draft.

> This is a control-design mapping, not a SOC 2 report. A SOC 2 examination must
> be performed by an independent CPA firm. A Type I report covers design at a
> point in time; a Type II report covers design and operating effectiveness over
> an observation period. See [EVIDENCE-CHECKLIST.md](EVIDENCE-CHECKLIST.md).

## 1. Scoped trust services categories

| Category | In scope | Rationale |
| --- | --- | --- |
| **Security** | **Yes, mandatory** | The platform processes customer operational data, credentials and service reports. Security is the common-criteria baseline and is always included. |
| **Availability** | Yes | Managed customers depend on the service to run field operations and retrieve reports. Commitments must be stated in the service description. |
| **Confidentiality** | Yes | Customer data, reports, attachments and credentials are confidential. |
| **Processing Integrity** | Yes, limited | The platform calculates SLA clocks, reminders, report totals and exports. Material processing errors could affect customers. |
| **Privacy** | Yes, limited | The platform processes personal data of customer contacts, portal users, technicians and signatories. Privacy is included where personal data is in scope; it is not a claim of GDPR certification. |

If a category is excluded from a customer commitment, remove it from the audit
scope and explain the exclusion in the system description. Do not map a
category merely to make the report look broader.

## 2. Mapping conventions

- The **Internal control** column references ISO/IEC 27001:2022 Annex A control
  numbers and the policy that describes the control. The SoA has the detailed
  applicability decision.
- **Designed** means the control exists and has repository evidence. It does not
  mean the control operated throughout the period.
- **Partial** means the design exists but a required operating record, SLA,
  supplier term or review is missing.
- **Gap** means the criterion is not adequately addressed. The linked gap in
  [GAP-ANALYSIS.md](GAP-ANALYSIS.md) is the remediation item.
- Evidence in this repository is **design evidence** unless it is a dated
  record. Type II evidence must be collected over the observation period and
  retained in the evidence pack.

## 3. Coverage summary

| Status | Count |
| --- | --- |
| Designed | 12 |
| Partial | 35 |
| Gap | 4 |
| **Total** | **51** |

| Category | Criteria | Designed | Partial | Gap |
| --- | --- | --- | --- | --- |
| Security (CC1–CC9) | 33 | 8 | 23 | 2 |
| Availability (A1) | 3 | 1 | 2 | 0 |
| Confidentiality (C1) | 2 | 1 | 1 | 0 |
| Processing Integrity (PI1) | 5 | 2 | 3 | 0 |
| Privacy (P1) | 8 | 0 | 6 | 2 |
| **Total** | **51** | **12** | **35** | **4** |

## 4. Common criteria (Security)

### CC1 — Control environment

| TSC | Criterion (paraphrased) | Internal control / Annex A | Status | Evidence and expected operating evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| CC1.1 | Demonstrates commitment to integrity and ethical values. | 5.1, 5.2, 5.10; [information security policy](policies/01-information-security-policy.md), [acceptable use policy](policies/12-acceptable-use.md) | Partial | Policies define expected conduct. Need signed acknowledgement from every worker and a disciplinary/exception record. | G-05 |
| CC1.2 | Board or equivalent exercises oversight of internal control. | 5.2, 5.4; [management review policy](policies/18-management-review.md) | Partial | Role table and review policy exist. Need dated management-review minutes showing oversight. | G-07 |
| CC1.3 | Establishes structures, reporting lines, authority and responsibility. | 5.2, 5.3; [README roles](README.md#5-roles-and-owners) | Designed | Role table, deputies and owners are documented. Need annual acknowledgement and org chart. |  |
| CC1.4 | Demonstrates commitment to competence. | 6.1, 6.3; [training policy](policies/19-training-awareness.md) | Partial | Training curriculum and register template exist. Need completion records and role-specific competency requirements. | G-05 |
| CC1.5 | Holds individuals accountable for internal control responsibilities. | 5.4, 6.4; [acceptable use policy](policies/12-acceptable-use.md) | Partial | Accountability and disciplinary expectations are described. Need evidence that reviews and consequences operate. | G-05 |

### CC2 — Communication and information

| TSC | Criterion (paraphrased) | Internal control / Annex A | Status | Evidence and expected operating evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| CC2.1 | Obtains or generates relevant, quality information to support internal control. | 5.9, 5.12, 8.15; [asset register](ASSET-REGISTER.md), [logging policy](policies/14-logging-monitoring.md) | Partial | Asset register, audit log and metrics exist. Need confirmation that information is complete, current and used in reviews. | G-16 |
| CC2.2 | Communicates internal control information internally. | 5.1, 5.2, 6.3; [policies index](policies/README.md) | Partial | Policies are published in the repository. Need acknowledgement, onboarding communication and change notices. | G-05 |
| CC2.3 | Communicates with external parties about relevant matters. | 5.5, 5.19, 5.31; [incident policy](policies/06-incident-response.md), [supplier policy](policies/09-supplier-management.md) | Partial | Security contact and incident communication paths exist. Need customer notice templates, regulator contacts and supplier communication records. | G-03 |

### CC3 — Risk assessment

| TSC | Criterion (paraphrased) | Internal control / Annex A | Status | Evidence and expected operating evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| CC3.1 | Specifies objectives to enable risk identification and assessment. | 5.1, 6.1 (ISO risk); [risk register](RISK-REGISTER.md) | Partial | Risk methodology, appetite and objectives are drafted. Need management approval of objectives and appetite. | G-01 |
| CC3.2 | Identifies and analyses risks to objectives. | 5.7, 6.1 (ISO risk); [risk register](RISK-REGISTER.md) | Partial | Initial risk assessment covers hosting, secrets, access, backups, suppliers, changes, incidents and data rights. Need quarterly operation and treatment plans. | G-01 |
| CC3.3 | Considers fraud risk. | 5.3, 5.10, 6.4; [access control policy](policies/02-access-control.md) | Partial | Segregation-of-duties and audit-log controls exist. No fraud-risk workshop or fraud scenario in the register. | G-01 |
| CC3.4 | Identifies and assesses changes that could affect the system. | 5.8, 8.32; [change management policy](policies/03-change-management.md) | Partial | PR/CI change control exists. Need risk assessment for significant architecture, supplier and scope changes. | G-15 |

### CC4 — Monitoring activities

| TSC | Criterion (paraphrased) | Internal control / Annex A | Status | Evidence and expected operating evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| CC4.1 | Conducts ongoing and separate evaluations of internal control. | 5.35, 5.36; [internal audit policy](policies/17-internal-audit.md) | Gap | Internal audit is planned but not performed. Monitoring metrics are not a substitute for independent evaluation. | G-02 |
| CC4.2 | Evaluates and communicates deficiencies. | 5.27, 5.36; [management review policy](policies/18-management-review.md) | Partial | Incident and review policies require corrective action. Need a deficiency log with owners and closure evidence. | G-02 |

### CC5 — Control activities

| TSC | Criterion (paraphrased) | Internal control / Annex A | Status | Evidence and expected operating evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| CC5.1 | Selects and develops control activities to mitigate risks. | 6.1 (ISO risk), 5.1; [risk register](RISK-REGISTER.md) | Partial | Controls are mapped to risks in the register. Need treatment plans and evidence that controls are selected from the risk assessment. | G-01 |
| CC5.2 | Selects and develops general controls over technology. | 8.2, 8.9, 8.13, 8.32; [access](policies/02-access-control.md), [backup](policies/08-backup-restore.md), [change](policies/03-change-management.md) | Designed | Technical controls are documented and partly evidenced. Need configuration baseline, access-review operation and restore-test records. | G-08 |
| CC5.3 | Deploys control activities through policies and procedures. | 5.1, 5.37; [policies index](policies/README.md) | Designed | Policy set and operating runbooks exist. Need approval signatures and annual review. | G-07 |

### CC6 — Logical and physical access

| TSC | Criterion (paraphrased) | Internal control / Annex A | Status | Evidence and expected operating evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| CC6.1 | Implements logical access security over infrastructure, software and data. | 5.15, 8.2, 8.3, 8.5; [access control policy](policies/02-access-control.md) | Designed | RBAC, department scoping, customer-portal isolation, 2FA and session invalidation exist. Need quarterly access-review evidence. | G-08 |
| CC6.2 | Registers and authorizes users and authenticates access. | 5.16, 5.17, 8.5; [access control policy](policies/02-access-control.md) | Designed | Local accounts, SSO, SCIM, invites and API keys are implemented. Need joiner/mover/leaver records. | G-05 |
| CC6.3 | Authorizes, modifies or removes access based on roles and least privilege. | 5.18, 8.2; [access review template](templates/ACCESS-REVIEW.md) | Partial | Role model and review template exist. No completed review. | G-08 |
| CC6.4 | Restricts physical access to facilities and protected information assets. | 7.1–7.5; [physical policy](policies/15-physical-environmental.md) | Partial | Azure inheritance and office rules are described. Need provider attestations and office access records. | G-03 |
| CC6.5 | Removes logical and physical access when no longer required. | 5.11, 6.5; [access control policy](policies/02-access-control.md#7-joiner-mover-leaver) | Partial | Offboarding checklist is documented. No completed leaver records. | G-05 |
| CC6.6 | Protects against threats from outside the system boundary. | 8.20, 8.21, 8.22; [SECURITY.md](../../SECURITY.md) | Designed | TLS, proxy, firewall/NSG, rate limits, upload controls and PDF sanitisation exist. Need vulnerability SLAs and external attack-surface review. | G-04 |
| CC6.7 | Restricts transmission, movement and removal of information. | 5.14, 8.24; [cryptography policy](policies/13-cryptography-key-management.md) | Partial | TLS and encrypted backups exist. No DLP, export approval or removable-media control. | G-12 |
| CC6.8 | Prevents or detects malicious software. | 8.7; [vulnerability policy](policies/05-vulnerability-management.md) | Partial | Trivy scans images and npm audit scans dependencies. No endpoint anti-malware attestation. | G-14 |

### CC7 — System operations

| TSC | Criterion (paraphrased) | Internal control / Annex A | Status | Evidence and expected operating evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| CC7.1 | Detects and monitors configuration vulnerabilities and new vulnerabilities. | 8.8, 8.9; [vulnerability policy](policies/05-vulnerability-management.md) | Partial | Dependabot, npm audit and Trivy run in CI. No vulnerability register, SLA or monthly review record. | G-04 |
| CC7.2 | Monitors system components and detects anomalies. | 8.15, 8.16; [monitoring policy](policies/14-logging-monitoring.md) | Designed | Metrics, alerts, readiness, backup freshness and queue failures are monitored. Need alert-response records. | G-09 |
| CC7.3 | Evaluates security events to determine whether an incident occurred. | 5.25; [incident policy](policies/06-incident-response.md#4-triage-and-severity) | Partial | Severity and triage criteria exist. No incident log or triage records. | G-09 |
| CC7.4 | Responds to identified security incidents. | 5.26; [incident policy](policies/06-incident-response.md#5-response-procedure) | Partial | Response procedure, roles and notification paths exist. No exercise or real incident record. | G-09 |
| CC7.5 | Recovers from identified security incidents. | 5.29, 5.30, 8.13; [BC/DR policy](policies/07-business-continuity-dr.md), [backup policy](policies/08-backup-restore.md) | Partial | Backup/restore and PITR are documented. Need a full recovery exercise and measured RTO/RPO. | G-10 |

### CC8 — Change management

| TSC | Criterion (paraphrased) | Internal control / Annex A | Status | Evidence and expected operating evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| CC8.1 | Authorizes, designs, develops, configures, documents, tests, approves and implements changes. | 8.25, 8.31, 8.32; [change management policy](policies/03-change-management.md) | Designed | PR review, CI gates, migration checks, image pinning and rollback are documented. Need branch-protection export and release approvals. | G-15 |

### CC9 — Risk mitigation

| TSC | Criterion (paraphrased) | Internal control / Annex A | Status | Evidence and expected operating evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| CC9.1 | Identifies, selects and develops risk mitigation activities. | 6.1 (ISO risk), 5.29; [risk register](RISK-REGISTER.md) | Partial | Initial treatments exist. Need approved treatment plans, due dates and residual-risk acceptance. | G-01 |
| CC9.2 | Assesses and manages risks associated with vendors and business partners. | 5.19–5.22; [supplier policy](policies/09-supplier-management.md) | Gap | Supplier policy and register template exist, but no signed DPAs, attestations or annual reviews. | G-03 |

## 5. Availability (A1)

| TSC | Criterion (paraphrased) | Internal control / Annex A | Status | Evidence and expected operating evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| A1.1 | Maintains, monitors and evaluates capacity to meet availability commitments. | 8.6; [BC/DR policy](policies/07-business-continuity-dr.md), [monitoring](../../deploy/monitoring/README.md) | Partial | Memory limits, disk alerts, metrics and sizing guidance exist. No formal capacity forecast or monthly review. | G-11 |
| A1.2 | Authorizes, designs, develops, implements and maintains environmental protections, backup and recovery infrastructure. | 7.5, 8.13, 8.14; [backup policy](policies/08-backup-restore.md), [BACKUP-RESTORE.md](../BACKUP-RESTORE.md) | Designed | Encrypted backups, checksums, off-site copy, PITR and restore runbook exist. Need provider attestations and restore-test records. | G-10 |
| A1.3 | Tests recovery plan procedures to meet availability commitments. | 5.30, 8.13; [backup policy](policies/08-backup-restore.md#6-testing) | Partial | Weekly restore test is documented and scripted. No retained test results or full DR exercise. | G-10 |

## 6. Confidentiality (C1)

| TSC | Criterion (paraphrased) | Internal control / Annex A | Status | Evidence and expected operating evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| C1.1 | Identifies and maintains confidential information to meet commitments. | 5.12, 5.13, 8.3; [classification](DATA-CLASSIFICATION-RETENTION.md) | Designed | Classification, access control and retention matrix exist. Need customer-specific confidentiality commitments and handling evidence. | G-12 |
| C1.2 | Disposes of confidential information to meet commitments. | 5.33, 8.10, 8.13; [privacy erasure](../privacy-erasure.md), [retention policy](policies/10-data-retention-disposal.md) | Partial | Customer erasure and audit retention exist. Backup copies, media disposal and supplier deletion evidence are incomplete. | G-10 |

## 7. Processing Integrity (PI1)

| TSC | Criterion (paraphrased) | Internal control / Annex A | Status | Evidence and expected operating evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| PI1.1 | Obtains or generates relevant, quality information about processing objectives. | 5.9, 8.15; [asset register](ASSET-REGISTER.md) | Partial | Data model and audit trail exist. No documented processing-integrity objectives or data-quality metrics. | G-16 |
| PI1.2 | Authorizes system inputs completely and accurately. | 8.26, 8.33; [secure SDLC policy](policies/04-secure-sdlc.md) | Designed | Server-side validation, authorization checks and synthetic test data are implemented. Need input-integrity test evidence per release. |  |
| PI1.3 | Processes data completely, accurately and timely. | 8.25, 8.29; [CI](../../.github/workflows/ci.yml) | Designed | Tests, type checks, SLA cleanup and reminder workers exist. Need production processing monitoring and exception review. |  |
| PI1.4 | Produces complete, accurate and timely outputs. | 8.26; [SECURITY.md](../../SECURITY.md) | Partial | PDF generation, evidence export and report revision controls exist. No output reconciliation or customer-acceptance record. | G-16 |
| PI1.5 | Stores data completely, accurately and timely. | 8.13, 8.15; [backup policy](policies/08-backup-restore.md) | Partial | Transactions, audit chain and backups exist. Need restore validation and data-integrity checks in operation. | G-10 |

## 8. Privacy (P1)

| TSC | Criterion (paraphrased) | Internal control / Annex A | Status | Evidence and expected operating evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| P1.1 | Provides notice about privacy practices and purposes. | 5.34; [privacy policy](policies/11-privacy-gdpr.md) | Gap | No approved customer-facing privacy notice or internal privacy programme is evidenced. | G-13 |
| P1.2 | Obtains and records consent where required. | 5.34; [privacy policy](policies/11-privacy-gdpr.md) | Partial | SMS consent and portal controls exist in the application. Need consent records and lawful-basis mapping. | G-13 |
| P1.3 | Collects personal information consistent with objectives. | 5.34, 8.11; [privacy policy](policies/11-privacy-gdpr.md) | Partial | Data minimisation is considered in erasure and retention. No Article 30 record of processing. | G-13 |
| P1.4 | Uses, retains and disposes of personal information consistent with objectives. | 5.33, 8.10; [retention matrix](DATA-CLASSIFICATION-RETENTION.md) | Partial | Retention and erasure procedures exist. Legal retention periods and backup deletion need approval. | G-10 |
| P1.5 | Provides data subjects with access to their information. | 5.34; [privacy erasure](../privacy-erasure.md) | Partial | Erasure is implemented. Subject-access request procedure and response log are missing. | G-13 |
| P1.6 | Discloses personal information only for defined purposes. | 5.14, 5.19; [supplier policy](policies/09-supplier-management.md) | Partial | Supplier and transfer rules are described. DPAs and subprocessor disclosures are missing. | G-03 |
| P1.7 | Maintains accurate, complete and relevant personal information. | 8.26; [privacy policy](policies/11-privacy-gdpr.md) | Partial | Customer-maintained data and correction UI exist. No data-quality or correction-request log. | G-13 |
| P1.8 | Monitors and enforces privacy compliance. | 5.35, 5.36; [internal audit policy](policies/17-internal-audit.md) | Gap | No privacy monitoring, independent review or complaint log. | G-02 |

## 9. System description inputs

The SOC 2 report requires a system description. The following inputs must be
approved before the Type I start date:

1. **Services and customers:** managed hosting, support, updates and optional
   self-hosted software. State clearly which service is examined.
2. **Infrastructure:** Azure region(s), VM/container host, PostgreSQL, Key Vault,
   backup storage, DNS, TLS and monitoring.
3. **Software:** application modules, APIs, portal, PWA/offline behaviour, PDF and
   OCR pipeline, integrations.
4. **People:** role owners, staffing, contractors and support access.
5. **Data:** data types, classification, flow, retention and deletion.
6. **Procedures:** change, access, backup, incident, supplier and privacy.
7. **Complementary customer responsibilities:** network, SSO configuration,
   customer users, customer backups in self-hosted mode and customer content.
8. **Complementary subservice organisation responsibilities:** Azure, GitHub,
   SMTP, SMS and other suppliers. Obtain carve-out or inclusive method decision
   from the CPA firm.

## 10. Type I versus Type II expectations

| Item | Type I | Type II |
| --- | --- | --- |
| Period | A point in time | Defined observation period, typically 3–12 months |
| Focus | Fairness of description and suitability of design | Design and operating effectiveness |
| Evidence | Policies, control descriptions, design walkthroughs, configuration snapshots | All Type I evidence plus dated operating records, samples, tickets, logs and review sign-offs |
| Gaps | Open gaps may prevent a clean opinion | Exceptions must be evaluated and disclosed |
| Start condition | Control owners approve the description and evidence index | Evidence collection starts before the period and runs continuously |

Do not start a Type II observation period until the priority-0 gaps in
[GAP-ANALYSIS.md](GAP-ANALYSIS.md) are closed. An observation period with known
missing controls creates avoidable exceptions.
