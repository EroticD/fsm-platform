# Quarterly Access Review

**Review period:** `[YYYY-QN]`
**Reviewer:** `[Name / role]`
**Approver:** `[Name / role]`
**Systems covered:** application, database, cloud, GitHub, CI, secret store,
supplier portals
**Date completed:** `[YYYY-MM-DD]`

> Complete one row per identity. Do not mark "no change" without confirming the
> role, last activity and business need. Retain the export/screenshot that
> supports each decision. Do not include passwords, tokens or secret values.

## 1. Scope and population

| System | Population | Source of truth | Export date |
| --- | --- | --- | --- |
| Application users |  | Admin user list |  |
| Privileged admins |  | Role report |  |
| Database roles |  | `\du` / role query |  |
| Cloud identities |  | Azure/IdP export |  |
| GitHub org/repo |  | GitHub export |  |
| API keys / SCIM tokens |  | Settings/key inventory |  |
| Supplier access |  | Supplier register/tickets |  |

## 2. Application users

| User / ID | Role | Department | Last login | Business need confirmed | Decision (retain/reduce/disable/delete) | Action owner | Date done |
| --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |

## 3. Privileged access

| Identity | Privilege | MFA | Last use | Approver | Decision | Action | Date done |
| --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |

## 4. Leavers and movers since last review

| Person | Change | Access removed | Sessions invalidated | Assets returned | Date | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |

## 5. API keys, SCIM and integration tokens

| Key/token ID (not value) | Owner | Scope | Created | Expires | Last used | Decision | Date done |
| --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |

## 6. Supplier access

| Supplier / person | System | Purpose | Time-bound? | MFA | Approved by | Decision | Date removed |
| --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |

## 7. Exceptions

| Identity | Exception | Risk ID | Compensating control | Expiry | Approved by |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

## 8. Summary and sign-off

| Metric | Count |
| --- | --- |
| Identities reviewed |  |
| Access reduced |  |
| Accounts disabled/deleted |  |
| Orphaned accounts found |  |
| MFA gaps |  |
| Exceptions created/closed |  |

**Reviewer signature:** `[Name]`  **Date:** `[YYYY-MM-DD]`

**Approver signature:** `[Name]`  **Date:** `[YYYY-MM-DD]`

Open actions must have an owner and due date and be tracked to closure. A review
with no evidence export is not complete.
