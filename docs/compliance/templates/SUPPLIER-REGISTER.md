# Supplier and Subprocessor Register

**Owner:** Finance/Admin Lead
**Security review:** Security Lead
**Privacy review:** Privacy Officer
**Review:** annual and on contract/service/subprocessor change

> Record one row per supplier. A supplier that processes personal data without a
> signed DPA is an open gap. Do not write contract values or secrets here.

## Register

| ID | Supplier | Service | Criticality | Data categories | Personal data? | Location/region | Subprocessors | DPA signed | Security terms/attestation | Attestation date | Next review | Access (who/how) | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SUP-01 | Microsoft Azure | Hosting, PostgreSQL, Key Vault, Blob | Critical | Customer data, backups, logs | Yes | EU/EEA `[confirm]` | Microsoft subprocessors | Yes/No | SOC 2/ISO report |  |  | Managed identity/RBAC | Operations Lead | Active |
| SUP-02 | GitHub/GHCR | Source, CI, registry | Critical | Source, build metadata, synthetic test data | No/limited | US/EU `[confirm]` | GitHub subprocessors | Yes/No | SOC 2/ISO report |  |  | Org roles, 2FA | Platform Lead | Active |
| SUP-03 | SMTP provider | Email delivery | High | Names, email, message content | Yes | `[confirm]` | `[list]` | Yes/No | `[terms]` |  |  | API key | Operations Lead | Active |
| SUP-04 | SMS provider | SMS delivery | High | Phone numbers, message content | Yes | `[confirm]` | `[list]` | Yes/No | `[terms]` |  |  | API key/webhook secret | Operations Lead | Active |
| SUP-05 | Map/tile/geocoding provider | Maps/address lookup | Medium | Address/coordinates, IP | Yes/possibly | `[confirm]` | `[list]` | Yes/No | `[terms]` |  |  | Publishable key | Platform Lead | Active |
| SUP-06 | Identity provider | SSO | High | Identity attributes, auth events | Yes | `[confirm]` | `[list]` | Yes/No | `[terms]` |  |  | OIDC client | Platform Lead | Active |
| SUP-07 | Off-site backup storage | Backup copy | Critical | Encrypted customer data | Yes (encrypted) | `[confirm]` | `[list]` | Yes/No | `[terms]` |  |  | Managed identity/RBAC | Operations Lead | Active |
| SUP-08 | DNS registrar / TLS CA | DNS and certificates | High | Domain metadata | No | `[confirm]` | `[list]` | N/A | `[terms]` |  |  | Registrar account | Operations Lead | Active |

## Due diligence record template

```markdown
### SUP-XX — [Supplier]

- Service and purpose:
- Data categories and data subjects:
- Controller/processor role:
- Data location and transfer mechanism:
- Subprocessors:
- Security attestation (type, date, scope, exceptions):
- Encryption in transit/at rest:
- Access model and MFA:
- Breach notification terms:
- Deletion/return on exit:
- Insurance/liability:
- Open issues and risk ID:
- Decision and approver:
- Next review:
```

## Annual review record

| Date | Supplier | Attestation current? | DPA current? | Access reviewed? | Incidents | Decision | Reviewer |
| --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |
