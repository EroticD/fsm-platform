# POL-12 Acceptable Use, Endpoints and Remote Working

| Field | Value |
| --- | --- |
| Policy ID | POL-12 |
| Version | 0.1 readiness draft |
| Owner | Security Lead |
| Approver | Managing Director |
| Review cadence | Annual, and at onboarding |
| Scope | All workers, contractors, devices, accounts, data and remote access |
| Related ISO Annex A | 5.10, 5.11, 6.7, 7.7, 7.9, 8.1 |
| Related SOC 2 | CC1.1, CC6.7, CC6.5 |
| Evidence | Signed acknowledgement, device inventory, MDM/encryption status, exit checklist |

## 1. Purpose

Set clear expectations for acceptable use of organisation systems, customer data,
endpoints and remote access, and protect against loss, theft and misuse.

## 2. Scope

This policy applies to employees, contractors, interns and anyone with access to
the FSM Platform, source code, production, customer data or backups. It covers
organisation-owned and personally owned devices used for work.

## 3. Accounts and credentials

1. Use only your named account. Do not share passwords, tokens, API keys or
   sessions.
2. Use a password manager for unique passwords. Never reuse a work password on a
   personal site.
3. Enable 2FA on email, GitHub, cloud, domain, backup and social accounts.
4. Do not send credentials by email, chat, SMS or tickets. Use the approved
   secret store or a time-bound sharing mechanism.
5. Report suspected compromise immediately; do not wait to "clean it up".
6. Do not connect production credentials to personal devices or personal cloud
   storage.

## 4. Endpoint requirements

| Requirement | Minimum |
| --- | --- |
| Disk encryption | Full-disk encryption enabled and recovery key escrowed |
| Screen lock | Auto-lock after 5 minutes or less; require password/biometric |
| Patching | OS and browser updates within 7 days; critical within 48 hours |
| Anti-malware | Platform protection enabled; no disabling without approval |
| Firewall | Host firewall enabled |
| Local admin | Separate admin account where practical; no routine admin use |
| Backups | Work files stored in approved systems, not only on the endpoint |
| Device inventory | Asset ID, owner, serial, encryption status, last check |
| Lost/stolen | Report immediately; remote wipe/lock; reset credentials if exposed |

Personally owned devices are allowed only if they meet the same requirements and
the organisation can remote-wipe work data. If that cannot be assured, use an
organisation device.

## 5. Clear desk and clear screen

- Lock the screen when leaving a device, even briefly.
- Do not leave restricted data, notebooks, printouts or removable media in view
  of visitors or in shared spaces.
- Use privacy screens in public/transport.
- Shred restricted paper; do not put it in general waste.
- Clear whiteboards containing customer or security information.

## 6. Remote working

- Use a trusted network; avoid open Wi-Fi without a VPN or trusted TLS path.
- Do not allow family, friends or visitors to use a work device or account.
- Use headphones for customer calls in shared spaces.
- Do not print restricted data at home unless approved; if printed, secure it
  and shred it.
- Keep devices with you during travel; do not check them in unattended luggage.
- Production access from personal devices is prohibited unless explicitly
  approved and the device meets endpoint requirements.
- Report loss/theft immediately, including out of hours.

## 7. Return of assets and access

On leaving or role change, return:

- laptop, phone, chargers, security keys and access cards;
- any paper records, removable media and printed material;
- organisation credit cards and equipment.

Access is revoked the same day: accounts, sessions, API keys, SSH keys, GitHub,
cloud, database, secret stores, supplier portals and email. The leaver must
confirm they have no copies of customer data and remain bound by
confidentiality. The checklist is
[templates/ACCESS-REVIEW.md](../templates/ACCESS-REVIEW.md) or the HR
offboarding record.

## 8. Prohibited use

Do not:

- access data you do not need, including browsing customer records out of
  curiosity;
- copy production data to personal devices, email, chat or AI tools;
- install unapproved software, browser extensions or agents on production hosts;
- use production for crypto-mining, personal services or illegal activity;
- attempt to bypass security controls or conceal a mistake;
- use another person's account or share a 2FA code;
- take screenshots of customer data for marketing without approval;
- connect an unapproved USB device to a production host.

## 9. Breaches and disciplinary process

A suspected breach is investigated under the incident and HR processes. The
organisation considers intent, harm, repeat behaviour and legal obligations.
Possible outcomes include coaching, access restriction, disciplinary action or
contract termination. Do not destroy evidence. Good-faith reporting of a mistake
is treated as learning, not as a reason to hide the incident.

## 10. Evidence and metrics

| Metric | Target | Source |
| --- | --- | --- |
| Workers with signed acknowledgement | 100% | HR/training register |
| Devices with encryption enabled | 100% | MDM/inventory |
| Devices patched within target | ≥ 95% | MDM/inventory |
| Lost devices reported and wiped | 100% | Incident record |
| Leaver access revoked within one business day | 100% | Offboarding checklist |
| Unapproved production software | 0 | Configuration review |

## 11. Related documents

- [Access control](02-access-control.md)
- [Information security policy](01-information-security-policy.md)
- [Data classification and retention](../DATA-CLASSIFICATION-RETENTION.md)
- [Cryptography and key management](13-cryptography-key-management.md)
- [SECURITY.md](../../../SECURITY.md)
