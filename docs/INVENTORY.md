# Lager og reservedeler (OPS-05)

Modulnøkkel: `inventory` (avhenger av `equipment`).

## Flater

| Rute | Innhold |
| --- | --- |
| `/lager` | Vareliste, lokasjoner, kjøpsforslag og skjema for ny vare/lokasjon |
| `/lager/varer/[id]` | Beholdning per lokasjon, bevegelser, reservasjoner, justering og reservasjon |
| `/lager/lokasjoner/[id]` | Beholdning og bevegelser for ett lager eller én montørbil |
| `/lager/oppdrag/[id]` | Reservedeler for ett oppdrag, med reservasjon, frigjøring og forbruk |

Oppdragsiden `/oppdrag/[id]` viser en modulstyrt lenke til reservedelssiden.

## Datamodell

- `InventoryLocation` – lager (`WAREHOUSE`) eller montørbil (`VAN`), med
  valgfri avdeling og ansvarlig bruker.
- `InventoryItem` – SKU, navn, enhet, bestillingspunkt og aktiv-flagg.
- `StockLevel` – mengde per vare og lokasjon (`DECIMAL(12,3)`).
- `StockMovement` – `IN`, `OUT`, `ADJUST`, `RESERVE`, `RELEASE`, `CONSUME`.
- `InventoryReservation` – aktiv, frigitt eller forbrukt mengde mot oppdrag
  og/eller arbeidsøkt.

Kjøpsforslag beregnes på lesetid: `bestillingspunkt − (på lager − aktive
reservasjoner)`. Det er bevisst ingen egen tabell, slik at forslaget alltid
følger faktisk beholdning.

## Samtidighet og regler

- Alle endringer går i en transaksjon. `StockLevel` låses med
  `SELECT ... FOR UPDATE` før beholdningen leses.
- Manglende beholdningsrad opprettes med `INSERT ... ON CONFLICT DO NOTHING`,
  slik at to samtidige førstebevegelser ikke kolliderer.
- `IN`, `OUT`, reservasjon og forbruk avviser negativ beholdning.
- Bare `ADJUST` er en eksplisitt korrigering og kan gi negativ beholdning.
- Hver mutasjon skriver revisjonslogg i samme transaksjon.

## Rettigheter

| Handling | Rettighet |
| --- | --- |
| Se lager | `equipment.view` |
| Vare/lokasjon/justering | `equipment.manage` |
| Reservere, frigjøre, forbruke | `workorders.update` eller `equipment.manage` |

Avdelingssperren følger lokasjonen. Administrator ser alle avdelinger.

## Forbruk ved fullført arbeid

Kjernen i visittflyten er ikke endret. Forbruk gjøres eksplisitt fra
`/lager/oppdrag/[id]`, enten per reservasjon eller samlet for en arbeidsøkt
(`consumeReservationsForVisit`). Det gir ingen skjulte sideeffekter når en
visitt settes til `DONE`.
