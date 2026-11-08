# POL-06 Incident Response

| Field | Value |
| --- | --- |
| Policy ID | POL-06 |
| Version | 0.1 readiness draft |
| Owner | Security Lead |
| Approver | Managing Director |
| Review cadence | Annual; exercise annually and after a severity-1 incident |
| Scope | Security, privacy, availability and supplier incidents affecting the FSM Platform |
| Related ISO Annex A | 5.24–5.28, 6.8 |
| Related SOC 2 | CC7.2–CC7.5, CC2.3, P1.8 |
| Evidence | Incident register, timeline, notifications, post-incident review, exercise report |

## 1. Purpose

Detect, assess, contain, eradicate, recover from and learn from incidents while
meeting legal, contractual and customer communication obligations.

## 2. Scope and examples

- Unauthorized access to production, source code, customer data or backups.
- Credential compromise, lost device, phishing success or malicious insider.
- Ransomware, malware, destructive command or data deletion.
- Data breach or accidental disclosure (email, export, logs, support copy).
- Extended outage, database corruption, failed restore or backup loss.
- Vulnerability exploitation or supplier compromise.
- Privacy incident, including loss of confidentiality, integrity or availability
  of personal data.

## 3. Reporting

| Channel | Use | Owner |
| --- | --- | --- |
| Security email / GitHub private vulnerability report | External vulnerability reports | Security Lead |
| Incident channel / on-call alert | Internal detection and escalation | Operations Lead |
| `ALERT_WEBHOOK_URL` and monitoring alerts | Automated operational alerts | Operations Lead |
| Direct escalation to Security Lead / Managing Director | Suspected breach or high impact | Any worker |

Every worker must report suspected incidents immediately. Do not investigate
alone, delete logs, power off a compromised host or contact the suspected actor.

## 4. Triage and severity

| Severity | Criteria | Response target | Escalation |
| --- | --- | --- | --- |
| **SEV-1** | Confirmed or likely breach of restricted data; production compromise; extended outage; ransomware. | Acknowledge immediately; incident lead within 30 minutes; containment started within 2 hours. | Managing Director, Security Lead, Privacy Officer, legal counsel |
| **SEV-2** | Credential compromise with limited access; single-customer data exposure; significant degradation. | Incident lead within 2 hours; containment same business day. | Security Lead, Operations Lead |
| **SEV-3** | Limited security event, failed attack, low-impact vulnerability. | Triage within 1 business day; fix in normal change. | Security Lead |
| **SEV-4** | Suspicious activity or policy question with no confirmed impact. | Review within 3 business days. | Security Lead |

When in doubt, start at a higher severity. Downgrade only with a documented
reason.

## 5. Response procedure

1. **Prepare.** Maintain contacts, roles, access paths, runbooks, backups and
   evidence collection. Test annually.
2. **Detect and record.** Create an incident ID and timeline. Record who saw
   what, when, and from which system. Preserve logs and artefacts.
3. **Assess.** Determine scope, affected customers/data, containment options,
   legal/contractual notification triggers and whether the attacker is still
   active.
4. **Contain.** Revoke sessions/tokens, disable accounts, block IPs, isolate the
   host, rotate secrets, stop a compromised integration. Prefer containment that
   preserves evidence.
5. **Eradicate.** Remove malware, close the vulnerability, patch, rebuild from a
   trusted image, restore clean data.
6. **Recover.** Restore service, verify integrity, monitor for recurrence, and
   confirm with the business owner before closing.
7. **Notify.** Notify affected customers, regulators and insurers as required.
   The Privacy Officer leads GDPR assessment; legal counsel approves wording.
8. **Learn.** Complete a post-incident review within 10 business days for SEV-1
   and 20 business days for SEV-2.

## 6. Privacy and regulatory notification

- Assess whether personal data was breached (confidentiality, integrity or
  availability).
- GDPR controller notification is generally within **72 hours** of awareness
  where required. The customer may be the controller; notify them without undue
  delay so they can meet their deadline.
- Do not notify a regulator or data subject without legal/privacy approval unless
  a delay would itself cause harm.
- Record the decision, legal basis, recipients, content and time of every
  notification.
- A near miss is recorded as a security event, even if no notification is
  required.

## 7. Evidence

Preserve, with integrity:

- application and audit logs, metrics, alerts and screenshots;
- relevant database rows and audit-chain export;
- affected files with hashes, not copies that overwrite originals;
- email/chat/ticket records;
- identity and access logs;
- backup identifiers and restore points;
- timeline, decisions and approvers.

Use the audit/evidence export described in
[audit-retention.md](../../../docs/audit-retention.md) where relevant. Never edit
the original evidence.

## 8. Post-incident review

The review is blameless and answers:

1. What happened, and what was the actual impact?
2. How was it detected, and how long did detection/containment/recovery take?
3. What worked, and what failed?
4. Which control was missing or ineffective?
5. What actions, owners and due dates will prevent recurrence?
6. Does the risk register, SoA, policy or supplier assessment need updating?
7. Was any notification required, and was it timely?

Track actions to closure and report them at management review.

## 9. Exercises

At least annually:

- tabletop a ransomware or data-breach scenario with the incident lead,
  Privacy Officer and Managing Director;
- test the contact list and out-of-hours escalation;
- test restoration from backup and evidence export;
- record gaps and actions.

A backup restore test is necessary but not a substitute for an incident
exercise.

## 10. Roles

| Role | Responsibility |
| --- | --- |
| Incident Lead | Runs the response, owns timeline and decisions. |
| Security Lead | Investigation, containment, evidence, post-incident review. |
| Operations Lead | Infrastructure recovery, backups, monitoring. |
| Privacy Officer | Breach assessment, notification, data-subject impact. |
| Managing Director | Executive decisions, customer/legal communication, resources. |
| Communications | Approved customer/status messages (may be a role held by the MD). |

## 11. Metrics

| Metric | Target |
| --- | --- |
| SEV-1 acknowledged within 30 minutes | 100% |
| Incidents with a recorded timeline | 100% |
| Post-incident reviews on time | 100% |
| Corrective actions closed by due date | ≥ 90% |
| Annual exercise completed | 100% |

## 12. Related documents

- [Business continuity and DR](07-business-continuity-dr.md)
- [Backup and restore](08-backup-restore.md)
- [Logging and monitoring](14-logging-monitoring.md)
- [Privacy and GDPR](11-privacy-gdpr.md)
- [SECURITY.md](../../../SECURITY.md)
- [Incident register template](../templates/INCIDENT-REGISTER.md)
