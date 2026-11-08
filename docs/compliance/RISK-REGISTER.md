# Risk Register and Initial Risk Assessment

**Organisation:** `[Legal entity]`
**Scope:** FSM Platform managed service and supporting ISMS.
**Version:** 0.1 readiness draft, 2026-11-08.
**Risk owner:** Security Lead.
**Approver:** Managing Director.
**Review cadence:** quarterly, after a material change, and after any severity-1
or severity-2 incident.

> This register is a working risk assessment, not a completed risk treatment
> programme. Several treatments are planned, not operated. See
> [GAP-ANALYSIS.md](GAP-ANALYSIS.md) for the remediation roadmap.

## 1. Method

### 1.1 Scoring

Likelihood and impact are scored 1–5. The score is `likelihood × impact`.

| Score | Rating | Response expectation |
| --- | --- | --- |
| 17–25 | **Critical** | Stop or contain; executive decision; treatment plan within 7 days. |
| 10–16 | **High** | Treatment plan within 30 days; owner and due date required. |
| 5–9 | **Medium** | Treatment or acceptance within 90 days. |
| 1–4 | **Low** | Monitor; accept with rationale. |

**Likelihood**

| Score | Meaning |
| --- | --- |
| 1 | Rare — no known path in the next 3 years. |
| 2 | Unlikely — plausible but not expected in the next year. |
| 3 | Possible — could occur within a year. |
| 4 | Likely — expected within a year without treatment. |
| 5 | Almost certain — occurring now or repeatedly. |

**Impact**

| Score | Meaning |
| --- | --- |
| 1 | Negligible — no customer, legal or financial effect. |
| 2 | Minor — limited internal effort, no data or service impact. |
| 3 | Moderate — service degradation, internal data exposure or contract issue. |
| 4 | Major — customer data exposure, extended outage, regulatory notification likely. |
| 5 | Severe — widespread sensitive data breach, prolonged outage, legal or existential impact. |

### 1.2 Risk appetite

| Area | Appetite | Rationale |
| --- | --- | --- |
| Privacy and legal compliance | **Low** | Personal data and service records are central to customer trust. |
| Security of customer data | **Low** | A breach can affect many customers and trigger notification duties. |
| Availability | **Moderate** | The service is important but not life-critical; documented RTO/RPO may be acceptable. |
| Financial and commercial | **Moderate** | Small vendor; treat risks that could threaten continuity. |
| Innovation and change | **Moderate** | Controlled experimentation is allowed with review and rollback. |

### 1.3 Treatment options

- **Mitigate** — reduce likelihood or impact with a control.
- **Transfer** — insurance or contractual allocation (does not remove
  accountability).
- **Avoid** — stop the activity or remove the feature.
- **Accept** — documented residual risk within appetite, approved by the risk
  owner.

## 2. Initial risk assessment

`Inherent` is the score before the listed treatment. `Residual` is the expected
score after the treatment is implemented and evidenced. A residual score is not
valid until the treatment is operated.

| ID | Category | Risk | Cause / scenario | Impact | L | I | Inherent | Treatment | Residual | Owner | Due | Status | Linked controls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R-01 | Hosting | Single application host or database failure causes prolonged outage. | One VM/container host; no automatic failover; DNS/TLS recovery depends on one region. | Customers cannot dispatch, complete reports or access history. | 4 | 4 | 16 High | Document RTO/RPO, test full restore, evaluate warm standby or managed HA, add status communication. | 8 Medium | Operations Lead | 2027-01-31 | Open | 5.29, 5.30, 8.6, 8.14 |
| R-02 | Secrets | Secret is committed, logged, pasted into a ticket or exposed through a backup. | `.env` misuse, debug logging, support copy, CI variable leak, token in URL. | Credential compromise; unauthorized access; full customer-data breach. | 3 | 5 | 15 High | Secret scanning, pre-commit hook, Key Vault/managed identity, rotation runbook, no secrets in logs, least-privilege tokens. | 6 Medium | Platform Lead | 2026-12-15 | Open | 5.17, 8.15, 8.24 |
| R-03 | Access | Too many people have administrative or production database access. | Small team, convenience accounts, shared credentials, broad roles. | Unauthorized change or data access; weak attribution. | 3 | 5 | 15 High | Named accounts, 2FA for admins, runtime DML role, break-glass procedure, quarterly access review. | 6 Medium | Operations Lead | 2026-12-15 | Open | 5.15, 5.18, 8.2 |
| R-04 | Access | A leaver or moved employee retains access. | No completed offboarding checklist; tokens, SSH keys, API keys or sessions forgotten. | Unauthorized access after employment ends. | 3 | 4 | 12 High | Joiner/mover/leaver checklist, same-day revocation, session invalidation, access review, asset return. | 6 Medium | People/HR Lead | 2026-12-31 | Open | 5.11, 6.5, 8.2 |
| R-05 | Access | One person can both make and approve a sensitive change. | Small team; no independent approver for some changes. | Undetected error or fraud; audit finding. | 4 | 3 | 12 High | Two-person rule for production/destructive changes, PR review, audit log, compensating monitoring. | 9 Medium | Security Lead | 2027-01-15 | Open | 5.3, 8.32 |
| R-06 | Backup | Backup is missing, corrupted, encrypted with a lost key or deleted by ransomware. | Failed timer, wrong retention, key stored with backup, compromised host. | Permanent data loss; inability to meet RPO. | 3 | 5 | 15 High | Encrypted off-site copy, checksum/freshness alerts, offline key copy, immutability/soft delete, restore tests. | 6 Medium | Operations Lead | 2026-12-31 | Open | 5.33, 8.13 |
| R-07 | Backup | Restore is not tested or takes longer than the stated RTO. | Weekly test not retained; full DR never exercised; dependency on DNS/TLS/keys. | Extended outage; false recovery confidence. | 3 | 4 | 12 High | Weekly automated restore test, quarterly full exercise, record measured RTO, update runbook. | 6 Medium | Operations Lead | 2027-01-31 | Open | 5.30, 8.13 |
| R-08 | Supplier | A critical supplier has no DPA, security schedule or current attestation. | Hosting, SMS, SMTP, maps, identity or backup supplier onboarded without procurement review. | Contractual gap; unauthorised subprocessing; no assurance. | 3 | 4 | 12 High | Supplier register, DPA/security schedule, annual attestation review, subprocessor list. | 8 Medium | Finance/Admin Lead | 2027-02-28 | Open | 5.19, 5.20, 5.22 |
| R-09 | Supplier | Personal data is transferred outside the EEA without a valid mechanism. | Cloud region, support access or subprocessor located outside EEA. | GDPR transfer breach; regulatory exposure. | 2 | 5 | 10 High | Data-flow map, region selection, SCC/transfer assessment, supplier disclosure. | 4 Low | Privacy Officer | 2027-02-28 | Open | 5.31, 5.34 |
| R-10 | Code change | A malicious or unsafe change reaches production. | Compromised dependency, unreviewed PR, bypassed CI, compromised maintainer account. | Data breach, outage or malicious code execution. | 3 | 4 | 12 High | Branch protection, required review, CI gates, dependency pinning, Trivy, SBOM, signed releases. | 6 Medium | Engineering Lead | 2027-01-31 | Open | 8.25, 8.28, 8.32 |
| R-11 | Vulnerability | A known critical vulnerability is not remediated within a defined SLA. | No owner, no SLA, scanner findings not triaged, upgrade blocked. | Exploitation, outage or data loss. | 3 | 4 | 12 High | Vulnerability register, severity SLAs, monthly review, patch cadence, compensating controls. | 6 Medium | Platform Lead | 2026-12-31 | Open | 5.7, 8.8 |
| R-12 | Incident | An incident is not detected, contained or communicated in time. | No 24/7 SOC, alert fatigue, unclear roles, no exercise, missing contact list. | Larger impact, regulatory notification failure, customer trust loss. | 3 | 4 | 12 High | Alert routing, severity matrix, on-call rota, tabletop exercise, contact list, post-incident review. | 6 Medium | Security Lead | 2027-01-31 | Open | 5.24–5.27 |
| R-13 | Data rights | A data-subject request is missed or mishandled. | No intake log, no deadline tracking, legal hold conflict, unclear controller/processor role. | Regulatory complaint; loss of trust. | 3 | 5 | 15 High | Request procedure, deadline tracker, erasure runbook, DPA roles, privacy notice, training. | 6 Medium | Privacy Officer | 2026-12-31 | Open | 5.34, 8.10 |
| R-14 | Retention | Data is kept longer than necessary or deleted while under legal hold. | Retention not configured, backup retention misunderstood, hold not checked. | Unlawful retention or destruction of evidence. | 3 | 4 | 12 High | Approved retention matrix, audit-hold checks, deletion approval, backup lifecycle, annual review. | 6 Medium | Privacy Officer | 2027-01-31 | Open | 5.33, 8.10 |
| R-15 | Insider | A worker or contractor exfiltrates customer data. | Broad access, exports, removable media, no DLP, weak monitoring. | Confidentiality breach; notification and contractual impact. | 2 | 5 | 10 High | Least privilege, export logging, DLP/endpoint controls, acceptable use, exit interview, audit review. | 5 Medium | Security Lead | 2027-03-31 | Open | 5.10, 8.11, 8.12 |
| R-16 | Endpoint | A laptop or phone with production access or cached data is lost or stolen. | No disk encryption, no MDM, offline cache, password in browser. | Credential and customer-data exposure. | 3 | 5 | 15 High | Full-disk encryption, screen lock, MDM/remote wipe, no production data offline, device inventory. | 6 Medium | Security Lead | 2026-12-31 | Open | 6.7, 7.9, 8.1 |
| R-17 | CI/CD | GitHub, GHCR or CI account is compromised. | Weak 2FA, over-scoped token, malicious action, dependency confusion. | Malicious image or source change; supply-chain compromise. | 2 | 5 | 10 High | Hardware 2FA, least-privilege tokens, pinned Actions, branch protection, environment approvals, image signing. | 4 Low | Platform Lead | 2027-02-28 | Open | 5.21, 8.4, 8.31 |
| R-18 | Compliance | A legal or contractual obligation is missed. | No legal register, no owner, regulatory change not monitored. | Fines, contract breach, audit finding. | 2 | 3 | 6 Medium | Legal/contract register, annual review, counsel review, customer contract checklist. | 3 Low | Managing Director | 2027-03-31 | Open | 5.31, 5.36 |
| R-19 | Customer deployment | A self-hosted customer misconfigures the platform and suffers a breach. | Weak TLS, exposed database, no backups, shared admin accounts. | Reputational damage and support burden even though the customer operates it. | 2 | 3 | 6 Medium | Secure defaults, deployment guide, hardening checklist, support boundary, customer responsibility statement. | 4 Low | Platform Lead | 2027-03-31 | Open | 5.23, 8.9, 8.20 |
| R-20 | Evidence | The organisation cannot prove that controls operated. | No evidence retention, no review records, staff turnover, ad-hoc collection. | Audit exception, delayed certification, customer assurance failure. | 3 | 4 | 12 High | Evidence pack automation, evidence owner, quarterly collection, retention of records, internal audit. | 4 Low | Security Lead | 2026-12-31 | Open | 5.35, 5.36, 7.5 (records) |

### 2.1 Risk heat map (inherent)

| Impact ↓ / Likelihood → | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- |
| **5** |  | R-09, R-15, R-17 | R-02, R-03, R-06, R-13, R-16 |  |  |
| **4** |  |  | R-04, R-07, R-08, R-10, R-11, R-12, R-14, R-20 | R-01 |  |
| **3** |  | R-18, R-19 |  | R-05 |  |
| **2** |  |  |  |  |  |
| **1** |  |  |  |  |  |

## 3. Risk treatment plan template

Use this template for each High or Critical risk. Attach it to the risk row or
link a ticket.

```markdown
### Treatment plan for R-XX

- Risk owner:
- Treatment option: mitigate / transfer / avoid / accept
- Actions:
  1. [Action, owner, due date]
  2. [Action, owner, due date]
- Evidence of completion:
- Residual likelihood / impact / score:
- Residual accepted by:
- Acceptance date:
- Next review:
```

## 4. Risk acceptance record

A risk may be accepted only by the Managing Director (or delegate) within the
approved appetite. Record:

| Field | Value |
| --- | --- |
| Risk ID |  |
| Residual score |  |
| Why treatment is not proportionate |  |
| Compensating controls |  |
| Accepted by |  |
| Acceptance date |  |
| Expiry / next review |  |

Critical risks may not be accepted without an executive decision and a dated
remediation plan. A risk accepted because "the team is small" must state the
compensating control and the date the decision will be revisited.

## 5. Review record

| Review date | Participants | Changes | New risks | Closed risks | Approved by |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

The register is reviewed quarterly. A review that only changes dates without
changing treatment is not evidence of operation; record what was tested or
decided.
