# POL-17 Internal Audit and Independent Review

| Field | Value |
| --- | --- |
| Policy ID | POL-17 |
| Version | 0.1 readiness draft |
| Owner | Internal Auditor |
| Approver | Managing Director |
| Review cadence | Annual audit programme; policy reviewed annually |
| Scope | ISMS, controls, suppliers, privacy, operations and the SOC 2 control set |
| Related ISO Annex A | 5.35, 5.36, 5.31 |
| Related SOC 2 | CC4.1, CC4.2, CC1.2 |
| Evidence | Audit plan, scope, sampling, working papers, report, corrective actions |

## 1. Purpose

Provide independent assurance that the ISMS and controls are designed and
operating as described, and give management a factual basis for corrective
action.

## 2. Independence

- The Internal Auditor must not audit their own operational work. For a small
  organisation, use an external auditor, a qualified peer, or a consultant who
  does not operate the controls under review.
- The auditor reports to the Managing Director and has access to records,
  systems and people.
- The Security Lead may facilitate but must not direct the conclusion.
- An internal audit is not a certification audit and does not replace the
  accredited body.

## 3. Audit programme

| Area | Frequency | Example tests |
| --- | --- | --- |
| Governance and risk | Annual | Policy approval, risk review, treatment evidence, management review |
| Access control | Annual + quarterly sample | Joiners/movers/leavers, privileged access, MFA, access reviews |
| Change management | Annual + release sample | PR review, CI gates, migrations, emergency changes |
| Secure SDLC | Annual | Threat model, tests, dependency scans, release notes |
| Operations and availability | Annual | Backups, restore tests, monitoring, capacity, incidents |
| Supplier management | Annual | DPAs, attestations, subprocessors, access |
| Privacy | Annual | Article 30, notices, DSR log, DPIA, retention, breach records |
| Physical/environmental | Annual | Azure attestation, office access, disposal |
| Training and HR | Annual | Onboarding, acknowledgements, training completion, exit |

## 4. Process

1. **Plan.** Define scope, criteria, period, sampling, owner and schedule.
2. **Prepare.** Request evidence in advance; avoid disrupting operations.
3. **Fieldwork.** Interview, observe, inspect records and test samples. Record
   what was tested and why.
4. **Evaluate.** Compare evidence with the control description and framework
   criteria. Classify findings:
   - **Critical** — immediate risk or systemic control failure;
   - **High** — significant gap, remediation required before certification;
   - **Medium** — partial control or documentation gap;
   - **Low** — improvement opportunity.
5. **Report.** State scope, method, findings, evidence, root cause, risk and
   recommended action. Do not soften a finding to protect a person.
6. **Manage actions.** Assign owner and due date; track to closure; verify
   evidence.
7. **Follow up.** Re-test closed findings at the next audit or earlier for
   Critical/High.
8. **Report to management review.** Include open findings, overdue actions and
   trends.

## 5. Sampling

- Use a risk-based sample, not only convenient items.
- For a Type II period, sample across the period, not just the last month.
- Record the population, sample size, selection method and exceptions.
- A sample that finds an exception requires expansion or a finding; do not ignore
  it because the rest of the sample passed.

## 6. Audit testing rules

- Do not use production data in audit working papers beyond what is necessary;
  redact personal data.
- Do not alter production records, configurations or logs to test a control.
- Read-only access is preferred. Any test account is time-bound, approved and
  removed afterwards.
- Preserve evidence with hashes/screenshots and date.
- If a test could affect availability, schedule it with Operations and have a
  rollback.
- Report any discovered security issue immediately; do not wait for the report.

## 7. Roles

| Role | Responsibility |
| --- | --- |
| Internal Auditor | Plans, tests, reports independently. |
| Managing Director | Approves plan, receives report, resources actions. |
| Control owners | Provide evidence, remediate, respond to findings. |
| Security Lead | Coordinates schedule and tracks actions; does not approve closure alone. |

## 8. Evidence and metrics

| Metric | Target | Source |
| --- | --- | --- |
| Audit plan approved | Annual | Plan |
| Audit completed on schedule | 100% | Report |
| Critical/High findings with owner and due date | 100% | Action log |
| Actions closed by due date | ≥ 90% | Action log |
| Follow-up completed | 100% | Follow-up report |
| Management review receives report | 100% | Minutes |

## 9. Related documents

- [Risk management](16-risk-management.md)
- [Management review](18-management-review.md)
- [Statement of Applicability](../ISO27001-SOA.md)
- [Evidence checklist](../EVIDENCE-CHECKLIST.md)
- [Internal audit template](../templates/INTERNAL-AUDIT.md)
