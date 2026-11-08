# POL-15 Physical and Environmental Security

| Field | Value |
| --- | --- |
| Policy ID | POL-15 |
| Version | 0.1 readiness draft |
| Owner | Operations Lead |
| Approver | Managing Director |
| Review cadence | Annual, and on office, region or supplier change |
| Scope | Cloud data centres, office, home-working spaces, endpoints, media and visitors |
| Related ISO Annex A | 7.1–7.14 |
| Related SOC 2 | CC6.4, A1.2 |
| Evidence | Azure attestations, office access list, visitor log, disposal certificates |

## 1. Purpose

Protect information systems and media from physical and environmental threats,
while recognising that most production physical controls are inherited from the
cloud provider.

## 2. Shared responsibility

| Layer | Organisation | Azure/provider |
| --- | --- | --- |
| Data centre perimeter, entry, CCTV, security staff | Reviews attestations; selects region | Implements and monitors |
| Power, cooling, fire, flood, seismic | Relies on provider; plans for regional outage | Implements and maintains |
| Hardware maintenance and disposal | Relies on provider | Implements and certifies |
| Hypervisor and physical network | Relies on provider | Implements |
| VM/container configuration, OS patching, firewall/NSG, TLS | **Organisation** | Provides platform controls |
| Database roles, encryption keys, backups | **Organisation** | Provides service capabilities |
| Office, home, endpoints, media, visitors | **Organisation** | Not applicable |

"Inherited" means the organisation must still obtain and review the provider's
attestation and configure its own layer correctly. It does not mean "not our
problem".

## 3. Scope and exclusions

**N/A:** 7.6 working in secure areas and 7.12 cabling security. The organisation
does not operate a secure production area or production cabling. Production is
in provider data centres; customer sites are visited under customer supervision.
Revisit if the organisation opens a server room, processes paper records in a
secure area, or operates co-located hardware.

## 4. Cloud inheritance

Before relying on a provider:

1. Obtain the current SOC 2/ISO 27001 attestation and the shared-responsibility
   matrix.
2. Confirm the region and data residency.
3. Review exceptions and complementary controls.
4. Record the review and the next attestation date.
5. Monitor provider status/incidents and have a continuity plan.

Azure physical controls do not cover the organisation's VM configuration,
network rules, database roles, keys, backups or endpoints.

## 5. Endpoint and office equipment

- Endpoints follow [POL-12](12-acceptable-use.md): encryption, screen lock,
  patching and anti-malware.
- Servers and network equipment are not kept in unsecured offices. If a local
  server is unavoidable, lock it in a dedicated room/cabinet with access control,
  power protection and environmental monitoring.
- Protect equipment from water, heat, dust and unauthorized movement.
- Maintain an asset inventory and assign an owner.
- Maintenance is performed by approved providers; remove data before service if
  a third party gets physical access.

## 6. Visitors and office access

- Visitors sign in and are escorted in areas where restricted data or
  infrastructure is visible.
- Office keys/cards are issued to named people and returned on exit.
- Lost keys/cards are reported and the lock/card is changed.
- Cleaners/maintenance staff are supervised where restricted information is
  accessible.
- Do not leave restricted paper or devices in meeting rooms.

## 7. Media and disposal

- Store removable media in a locked location; encrypt it.
- Do not use personal USB drives for customer data.
- Dispose of media and endpoints per
  [POL-10](10-data-retention-disposal.md#6-equipment-and-media-disposal).
- Obtain a certificate for certified destruction or record the crypto-erase.

## 8. Environmental and utility resilience

- Cloud: rely on provider power/cooling/fire controls; plan for regional outage
  and provider maintenance.
- Office: use surge protection/UPS for network equipment where appropriate;
  protect against water and heat; keep a backup network path (mobile hotspot) for
  critical support.
- Home: secure the device, use a locked screen, avoid working in public areas
  with restricted data.

## 9. Evidence and metrics

| Metric | Target | Source |
| --- | --- | --- |
| Provider attestation reviewed annually | 100% | Supplier register |
| Office access list current | 100% | Access review |
| Visitor log maintained | 100% | Visitor log |
| Device encryption enabled | 100% | MDM/inventory |
| Media disposal records | 100% | Disposal log |
| Lost key/card reported and changed | 100% | Incident record |

## 10. Related documents

- [Supplier management](09-supplier-management.md)
- [Acceptable use](12-acceptable-use.md)
- [Data retention and disposal](10-data-retention-disposal.md)
- [Azure deployment](../../../docs/AZURE.md)
- [Asset register](../ASSET-REGISTER.md)
