# POL-11 Privacy and GDPR

| Field | Value |
| --- | --- |
| Policy ID | POL-11 |
| Version | 0.1 readiness draft |
| Owner | Privacy Officer |
| Approver | Managing Director |
| Review cadence | Annual, and when processing, law or suppliers change |
| Scope | Personal data processed in the FSM Platform and the organisation's own workforce/supplier data |
| Related ISO Annex A | 5.31, 5.34, 5.14 |
| Related SOC 2 | P1.1–P1.8, C1.1, C1.2 |
| Evidence | Article 30 record, notices, DPAs, DPIA, request log, breach record, retention matrix |

> This policy is an operational framework, not legal advice. The organisation
> must confirm controller/processor roles, lawful bases, transfer mechanisms and
> retention with counsel and the Privacy Officer.

## 1. Purpose

Protect personal data and meet GDPR and Norwegian data-protection obligations
through lawful, transparent, minimised and secure processing.

## 2. Roles

| Role | Responsibility |
| --- | --- |
| Managing Director | Accountable executive; approves notices, DPAs and high-risk processing. |
| Privacy Officer / DPO contact | Day-to-day privacy programme, records, DSRs, DPIAs, breach assessment, supplier terms. |
| Security Lead | Security controls, incident response, access and logging. |
| Operations Lead | Data location, backups, retention settings and deletion execution. |
| All workers | Follow policy, minimise data, report incidents and route requests. |

The organisation may act as **controller** for workforce, supplier, marketing and
website data, and as **processor** for customer content in managed hosting. The
customer is usually the controller for its own customer/contact/service data.
Record the role per processing activity; do not assume one role for everything.

## 3. Principles

1. **Lawfulness, fairness and transparency.** Identify a lawful basis and publish
   a clear notice.
2. **Purpose limitation.** Collect for specified, explicit and legitimate
   purposes.
3. **Data minimisation.** Collect only what is needed. Avoid free-text fields
   for unnecessary personal data.
4. **Accuracy.** Provide correction paths and respond to rectification requests.
5. **Storage limitation.** Follow the retention matrix and legal hold rules.
6. **Integrity and confidentiality.** Apply access control, encryption, logging
   and supplier safeguards.
7. **Accountability.** Maintain records, DPIAs, training, supplier terms and
   evidence.

## 4. Records of processing (Article 30)

The organisation must maintain a record for each processing activity. At
minimum:

| Field | Content |
| --- | --- |
| Activity | Customer service management, portal, SMS reminders, support, billing, HR |
| Controller/processor | Organisation or customer |
| Purpose | Service delivery, communication, support, contract, legal obligation |
| Data categories | Contact, address, job/report, signature, photo, credentials, usage |
| Data subjects | Customer contacts, portal users, technicians, signatories |
| Recipients/subprocessors | Azure, SMTP, SMS, maps, identity provider |
| Transfers | EEA/third country, mechanism |
| Retention | Link to retention matrix |
| Security measures | Access, encryption, logging, backup |
| Lawful basis | Contract, legal obligation, legitimate interest, consent |

The Article 30 record is a gap (G-13). Create it before a Type II observation
period.

## 5. Notices and consent

- Publish a privacy notice for the website, managed service and customer portal.
- Tell data subjects what is collected, why, how long, who receives it and how to
  exercise rights.
- Where consent is the basis (for example marketing SMS), record consent,
  timestamp, source and withdrawal. Do not bundle consent with terms.
- Customer content notices are usually the customer's responsibility as
  controller; provide accurate processor information and a DPA.
- Do not use production customer data for marketing, analytics or model training
  without a lawful basis, notice and approval.

## 6. Data subject rights

Follow the procedure and target in
[DATA-CLASSIFICATION-RETENTION.md](../DATA-CLASSIFICATION-RETENTION.md#5-data-subject-rights-procedure).
Use [privacy-erasure.md](../../../docs/privacy-erasure.md) for erasure. Verify the
requester, log the request, check legal hold, respond within one month
(extendable by two months with notice), and record the outcome.

The request log is a gap (G-13). Until it exists, use a restricted register with
date received, requester, scope, decision, response date and evidence.

## 7. Data protection impact assessment (DPIA)

A DPIA is required for processing likely to result in high risk, including:

- large-scale sensitive data or systematic monitoring;
- new technology or profiling with legal/significant effect;
- large-scale customer data migration to a new region/supplier;
- a new integration that sends personal data to a third party;
- a material change to retention or access.

The DPIA records necessity, proportionality, risks and mitigations. The Privacy
Officer approves; high residual risk requires consultation with the supervisory
authority before processing.

## 8. Breach notification

Follow [POL-06](06-incident-response.md). The Privacy Officer assesses:

- what data, whose data, how many;
- confidentiality, integrity or availability impact;
- likelihood and severity of harm;
- whether the data was encrypted/unknown to the attacker;
- controller/customer notification;
- regulator notification within 72 hours where required.

Record the decision even when no notification is required.

## 9. Transfers and suppliers

- Prefer EEA hosting and support.
- For third-country transfers, use an approved mechanism (adequacy, SCCs with
  transfer impact assessment) and record it.
- Suppliers processing personal data require a DPA and subprocessor disclosure.
  See [POL-09](09-supplier-management.md).
- Do not send personal data to a supplier or region not covered by the register
  and notice.

## 10. Security and privacy by design

- Apply access control, encryption, logging and retention at design time.
- Use synthetic data in test.
- Avoid personal data in logs, URLs, filenames, error messages and analytics.
- Mask or minimise data in support tools and exports.
- Review new features with the Privacy Officer before release.

## 11. Training and awareness

All workers complete privacy awareness at onboarding and annually. Role-specific
training is required for support, engineering and anyone handling DSRs or
breaches. See [POL-19](19-training-awareness.md).

## 12. Evidence and metrics

| Metric | Target | Source |
| --- | --- | --- |
| Article 30 record current | 100% | Record |
| DSRs answered within one month | 100% | Request log |
| Suppliers with DPA | 100% | Supplier register |
| DPIAs completed for high-risk changes | 100% | DPIA record |
| Breach decisions recorded | 100% | Incident register |
| Privacy training completion | 100% | Training register |

## 13. Related documents

- [Data classification and retention](../DATA-CLASSIFICATION-RETENTION.md)
- [Incident response](06-incident-response.md)
- [Supplier management](09-supplier-management.md)
- [Data retention and disposal](10-data-retention-disposal.md)
- [privacy-erasure.md](../../../docs/privacy-erasure.md)
