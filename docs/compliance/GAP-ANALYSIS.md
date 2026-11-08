# Gap Analysis and Remediation Roadmap

**Organisation:** `[Legal entity]`
**Scope:** ISO/IEC 27001:2022 and SOC 2 readiness for the FSM Platform managed
service.
**Version:** 0.1 readiness draft, 2026-11-08.
**Owner:** Security Lead.
**Approver:** Managing Director.

> **Disclaimer.** This gap analysis is not a certification, audit opinion or
> legal conclusion. Code, policies and evidence packs alone do not certify the
> organisation. An accredited ISO/IEC 27001 certification body and an
> independent CPA firm are required. Do not tell customers that the service is
> "ISO 27001 certified" or "SOC 2 compliant" until the relevant certificate or
> report is issued and its scope matches the customer's use.

## 1. Summary

The platform has strong technical building blocks: role-based access, 2FA, SSO/
SCIM, hash-chained audit logs, encrypted backups, restore automation, CI gates,
dependency and image scanning, and detailed operating runbooks. The main gaps
are **operating evidence and governance records**, not missing application
features.

| Priority | Meaning | Count |
| --- | --- | --- |
| **P0** | Blocks a credible Type I/Stage 2; must close before starting a SOC 2 observation period. | 6 |
| **P1** | Required for a clean audit; close before the audit start. | 7 |
| **P2** | Important improvement; can be planned during the observation period with a compensating control. | 3 |

**Top gaps**

1. No operated risk treatment programme (the register is an initial assessment).
2. No independent internal audit or management review record.
3. No signed supplier DPAs/subprocessor register or reviewed cloud attestations.
4. No vulnerability SLAs or vulnerability register.
5. No HR onboarding/offboarding, screening, NDA or training evidence.
6. No SOC 2 observation period or CPA engagement.

## 2. Prioritised gaps

### G-01 No formal risk treatment programme

| Field | Value |
| --- | --- |
| Priority | **P0** |
| Effort | 5–8 person-days, then 1 day/quarter |
| Owner | Security Lead; risk owners |
| Dependencies | Management approval of appetite; asset/data inventory |
| Current state | [RISK-REGISTER.md](RISK-REGISTER.md) has a method, appetite and 20 initial risks, but no approved treatment plans, residual acceptance or quarterly review record. |
| Required state | Approved appetite; treatment plans for every High/Critical risk; owners/dates; quarterly review minutes; evidence of completed treatments; risk acceptance records. |
| Closure evidence | Signed register v1.0, treatment plans, two quarterly review records, closed actions. |
| Blocks | ISO 6.1/6.2, SOC 2 CC3, CC5, CC9 |

### G-02 No independent internal audit

| Field | Value |
| --- | --- |
| Priority | **P0** |
| Effort | 8–12 person-days (external reviewer) |
| Owner | Internal Auditor (independent); Managing Director |
| Dependencies | Policies approved; evidence pack; access to systems |
| Current state | [POL-17](policies/17-internal-audit.md) and a template exist; no audit has been performed. |
| Required state | Approved annual audit plan; independent auditor; tested sample; report with findings; corrective actions; follow-up. |
| Closure evidence | Audit plan, working papers, report, action tracker, management review minutes. |
| Blocks | ISO 5.35/5.36, 9.2/9.3, SOC 2 CC4 |

### G-03 Supplier DPAs and subprocessor register

| Field | Value |
| --- | --- |
| Priority | **P0** |
| Effort | 5–8 person-days plus legal review |
| Owner | Finance/Admin Lead; Privacy Officer; Security Lead |
| Dependencies | Contract inventory; data-flow map; legal counsel |
| Current state | [POL-09](policies/09-supplier-management.md) and a register template exist. No signed DPAs, current attestations or subprocessor list are on file. |
| Required state | Register for all Critical/High suppliers; DPAs signed; Azure/GitHub attestations reviewed; subprocessor list published internally; annual review. |
| Closure evidence | Signed DPAs, attestation review notes, register, subprocessor list, access review. |
| Blocks | ISO 5.19–5.23, SOC 2 CC9.2, P1.6 |

### G-04 No vulnerability SLAs or register

| Field | Value |
| --- | --- |
| Priority | **P0** |
| Effort | 3–5 person-days, then 0.5 day/month |
| Owner | Platform Lead |
| Dependencies | CI scan outputs; issue tracker |
| Current state | Dependabot, `npm audit` and Trivy run. There is no vulnerability register, severity SLA, monthly review or exception process in operation. |
| Required state | Register with source/severity/owner/due; SLAs from [POL-05](policies/05-vulnerability-management.md); monthly review; verification of deployed fixes; exception approvals. |
| Closure evidence | Register, two monthly reviews, closed findings with deployed digest, exception records. |
| Blocks | ISO 8.8, SOC 2 CC7.1, CC6.8 |

### G-05 No HR onboarding and offboarding evidence

| Field | Value |
| --- | --- |
| Priority | **P0** |
| Effort | 4–6 person-days |
| Owner | People/HR Lead |
| Dependencies | HR system/templates; legal review; IdP access |
| Current state | Policies and an access-review template exist. No screening records, signed NDAs/acknowledgements, onboarding checklists or completed offboarding records. |
| Required state | Screening per role; contract/NDA clauses; onboarding checklist before access; annual acknowledgements; same-day leaver revocation; asset return; training records. |
| Closure evidence | Redacted onboarding/offboarding files, NDA register, access revocation samples, training register. |
| Blocks | ISO 6.1–6.6, SOC 2 CC1.1, CC1.4, CC6.2, CC6.5 |

### G-06 No SOC 2 observation period

| Field | Value |
| --- | --- |
| Priority | **P0** |
| Effort | 3–6 months elapsed; CPA fees |
| Owner | Managing Director; Security Lead; CPA firm |
| Dependencies | G-01–G-05 closed; control description; evidence process |
| Current state | No CPA engagement, system description, period, sampling plan or operating evidence over time. |
| Required state | Engaged CPA firm; agreed scope/categories; Type I then Type II period; evidence collected continuously; exceptions assessed. |
| Closure evidence | Engagement letter, system description, Type I report, Type II report. |
| Blocks | SOC 2 report |

### G-07 No management review minutes

| Field | Value |
| --- | --- |
| Priority | **P1** |
| Effort | 1–2 person-days per review |
| Owner | Managing Director |
| Dependencies | KPI pack, risk register, internal audit |
| Current state | [POL-18](policies/18-management-review.md) and a template exist; no meeting or minutes. |
| Required state | Annual review with inputs/outputs, decisions, actions and follow-up; mid-year checkpoint. |
| Closure evidence | Agenda, KPI pack, signed minutes, action tracker. |
| Blocks | ISO 5.4/9.3, SOC 2 CC1.2, CC4 |

### G-08 Access reviews not operated

| Field | Value |
| --- | --- |
| Priority | **P1** |
| Effort | 2–3 person-days/quarter |
| Owner | Operations Lead; Security Lead |
| Dependencies | IdP/application exports; role inventory |
| Current state | RBAC and a review template exist. No completed quarterly review or privileged monthly review. |
| Required state | Quarterly all-user review; monthly privileged review; API/SCIM key review; supplier access review; actions closed. |
| Closure evidence | Completed [ACCESS-REVIEW.md](templates/ACCESS-REVIEW.md), exports, disabled-account evidence. |
| Blocks | ISO 5.18, SOC 2 CC6.2/CC6.3/CC6.5 |

### G-09 Incident exercises and log missing

| Field | Value |
| --- | --- |
| Priority | **P1** |
| Effort | 2–4 person-days |
| Owner | Security Lead |
| Dependencies | Contact list; incident policy; backup/restore |
| Current state | Incident policy, alerting and an incident register template exist. No exercise, incident log or post-incident review. |
| Required state | At least one tabletop exercise; contact-list test; incident register; post-incident review; corrective actions. |
| Closure evidence | Exercise report, attendee list, incident register entries, review minutes. |
| Blocks | ISO 5.24–5.27, SOC 2 CC7.2–CC7.5 |

### G-10 Backup restore and DR evidence missing

| Field | Value |
| --- | --- |
| Priority | **P1** |
| Effort | 2–5 person-days |
| Owner | Operations Lead |
| Dependencies | Weekly restore test; off-site backup; key access |
| Current state | Backup scripts, timers, monitoring and a runbook exist. No retained restore-test results, full DR exercise or measured RTO/RPO. |
| Required state | Weekly test results; quarterly full restore; annual DR exercise; measured RTO/RPO; off-site copy proven; key recovery test. |
| Closure evidence | [BACKUP-RESTORE-TEST-LOG.md](templates/BACKUP-RESTORE-TEST-LOG.md), exercise report, alert history. |
| Blocks | ISO 5.30/8.13, SOC 2 A1.2/A1.3, PI1.5 |

### G-11 No BIA and capacity plan

| Field | Value |
| --- | --- |
| Priority | **P1** |
| Effort | 3–5 person-days |
| Owner | Operations Lead |
| Dependencies | Business input; monitoring history |
| Current state | RTO/RPO guidance and monitoring exist; no approved BIA, capacity forecast or monthly capacity review. |
| Required state | BIA with critical services and tolerances; capacity forecast; monthly review; scaling triggers. |
| Closure evidence | Approved BIA, capacity report, review notes. |
| Blocks | ISO 5.29/8.6, SOC 2 A1.1 |

### G-12 No DLP and limited export monitoring

| Field | Value |
| --- | --- |
| Priority | **P1** |
| Effort | 3–6 person-days plus tooling |
| Owner | Security Lead; Platform Lead |
| Dependencies | Data classification; export logging; endpoint tooling |
| Current state | Access control and audit logging exist. No DLP, export approval, removable-media control or egress monitoring. |
| Required state | Export approval/logging; endpoint DLP or equivalent; removable-media rule; monitoring of anomalous exports; acceptable-use acknowledgement. |
| Closure evidence | Configuration, export logs, approval records, DLP/endpoint report. |
| Blocks | ISO 8.12, SOC 2 CC6.7, C1.1 |

### G-13 Privacy programme and data subject request log

| Field | Value |
| --- | --- |
| Priority | **P1** |
| Effort | 6–10 person-days plus legal review |
| Owner | Privacy Officer |
| Dependencies | Counsel; data-flow map; customer contracts |
| Current state | Erasure and audit-retention procedures exist. No Article 30 record, approved privacy notice, DSR log, DPIA register or complaint log. |
| Required state | Article 30 record; notices; DSR log with deadlines; DPIA process; breach assessment; supplier DPAs; training. |
| Closure evidence | Article 30 record, published notice, DSR log, DPIA(s), training register. |
| Blocks | ISO 5.31/5.34, SOC 2 P1.1–P1.8 |

### G-14 Endpoint hardening and web filtering not evidenced

| Field | Value |
| --- | --- |
| Priority | **P2** |
| Effort | 3–5 person-days |
| Owner | Security Lead |
| Dependencies | MDM/endpoint tooling; device inventory |
| Current state | Acceptable-use policy defines requirements; no device inventory, encryption attestation, patching report or web filtering. |
| Required state | Device inventory with encryption/patch status; MDM or equivalent; web filtering or risk acceptance; lost-device procedure tested. |
| Closure evidence | Device report, MDM export, risk acceptance. |
| Blocks | ISO 8.1/8.23, SOC 2 CC6.8 |

### G-15 Change approval, branch protection and SBOM gaps

| Field | Value |
| --- | --- |
| Priority | **P2** |
| Effort | 3–5 person-days |
| Owner | Engineering Lead; Platform Lead |
| Dependencies | GitHub admin access; release pipeline |
| Current state | PR review and CI exist; branch protection settings are not exported; no SBOM, image signature/provenance or formal release approval record. |
| Required state | Branch protection export; required checks; release approval; SBOM; image signing/provenance; configuration drift review. |
| Closure evidence | GitHub settings export, release records, SBOM, signature verification. |
| Blocks | ISO 8.32/5.21, SOC 2 CC8.1 |

### G-16 Asset/data reconciliation and processing integrity metrics

| Field | Value |
| --- | --- |
| Priority | **P2** |
| Effort | 3–5 person-days |
| Owner | Operations Lead; Platform Lead |
| Dependencies | Cloud resource inventory; data-flow map |
| Current state | Asset register and data inventory are baselines; no reconciliation with live cloud resources, supplier contract IDs or processing-integrity metrics. |
| Required state | Reconciled asset register; data-flow owners; processing-integrity checks/output reconciliation; quarterly review. |
| Closure evidence | Reconciled register, review record, integrity metrics. |
| Blocks | ISO 5.9, SOC 2 CC2.1, PI1.1/PI1.4 |

## 3. Roadmap

| Phase | Window | Work | Exit criteria |
| --- | --- | --- | --- |
| **0. Approve and assign** | Week 1–2 | Fill legal entity/roles; approve policy set, risk appetite, scope; assign gap owners. | Signed approvals; gap tracker live. |
| **1. Close P0 governance** | Week 2–8 | G-01 risk treatment, G-03 suppliers, G-04 vulnerability SLA, G-05 HR evidence. | Treatment plans, DPAs, register, HR files. |
| **2. Operate and evidence** | Week 4–16 | G-08 access review, G-09 incident exercise, G-10 restore evidence, G-13 privacy. | Two cycles of records; exercise report; DSR log. |
| **3. Independent review** | Week 10–18 | G-02 internal audit, G-07 management review. | No open Critical; High actions tracked. |
| **4. ISO certification** | Week 14–24 | Stage 1 and Stage 2 with accredited body. | Certificate issued (if successful). |
| **5. SOC 2 Type I** | Week 8–20 | Engage CPA; system description; design evidence. | Type I report. |
| **6. SOC 2 Type II** | Month 5–12 | Observation period; continuous evidence; sampling; exceptions. | Type II report. |

P0 items must be closed before a Type II observation period starts. P1 items
should be closed before the audit start. P2 items can run in parallel with a
documented compensating control.

## 4. Effort and dependencies (summary)

| Gap | Priority | Effort (person-days) | Owner | Depends on |
| --- | --- | --- | --- | --- |
| G-01 Risk treatment | P0 | 5–8 + 1/quarter | Security Lead | Appetite approval |
| G-02 Internal audit | P0 | 8–12 | Internal Auditor | Policies, evidence |
| G-03 Supplier DPAs | P0 | 5–8 + legal | Finance/Privacy | Contract inventory |
| G-04 Vulnerability SLA | P0 | 3–5 + 0.5/month | Platform Lead | CI scans |
| G-05 HR evidence | P0 | 4–6 | People/HR | HR/legal templates |
| G-06 SOC 2 period | P0 | 3–6 months elapsed | MD/Security | G-01–G-05 |
| G-07 Management review | P1 | 1–2/review | MD | KPI pack |
| G-08 Access reviews | P1 | 2–3/quarter | Operations | Exports |
| G-09 Incident exercise | P1 | 2–4 | Security Lead | Contact list |
| G-10 Restore/DR evidence | P1 | 2–5 | Operations | Off-site backup |
| G-11 BIA/capacity | P1 | 3–5 | Operations | Business input |
| G-12 DLP/export | P1 | 3–6 + tooling | Security/Platform | Classification |
| G-13 Privacy programme | P1 | 6–10 + legal | Privacy Officer | Counsel |
| G-14 Endpoint/web | P2 | 3–5 | Security Lead | MDM |
| G-15 Change/SBOM | P2 | 3–5 | Engineering/Platform | GitHub admin |
| G-16 Asset/integrity | P2 | 3–5 | Operations/Platform | Cloud inventory |

## 5. What is already evidence-backed

These are design or technical evidence, not proof of operating effectiveness:

- access control, 2FA, SSO/SCIM and API-key controls in code and
  [SECURITY.md](../../SECURITY.md);
- hash-chained audit log, retention, legal hold and evidence export in
  [audit-retention.md](../../docs/audit-retention.md);
- customer erasure in [privacy-erasure.md](../../docs/privacy-erasure.md);
- encrypted backups, freshness/checksum checks and restore scripts in
  [BACKUP-RESTORE.md](../../docs/BACKUP-RESTORE.md) and `scripts/`;
- CI gates, dependency audit, Trivy image scan and Dependabot in
  [.github/workflows/ci.yml](../../.github/workflows/ci.yml);
- monitoring and alerts in [deploy/monitoring](../../deploy/monitoring/README.md);
- operations, rollback and capacity guidance in
  [OPERATIONS.md](../../docs/OPERATIONS.md).

## 6. What is policy-only

These are described but not yet evidenced as operated:

- risk treatment and acceptance;
- access reviews and joiner/mover/leaver records;
- supplier DPAs, attestations and subprocessor list;
- vulnerability SLAs and register;
- incident exercises, incident log and post-incident reviews;
- restore-test results and full DR exercise;
- BIA and capacity plan;
- privacy notices, Article 30 record, DSR log and DPIAs;
- internal audit, management review and training records;
- HR screening, NDAs and onboarding/offboarding completions;
- endpoint encryption/patching attestations and DLP.

## 7. Acceptance and escalation

The Managing Director accepts the roadmap and resources. The Security Lead
reports progress monthly to the Managing Director and at management review.
Overdue P0 items are escalated immediately. A customer commitment must not be
made on the basis of a planned control.

**Approved by:** `[Name]`  **Date:** `[YYYY-MM-DD]`
