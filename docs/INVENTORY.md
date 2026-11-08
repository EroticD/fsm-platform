# Lager og reservedeler (OPS-05)

Modulnøkkel: `inventory` (ingen harde modulavhengigheter).

## Flater

| Rute | Innhold |
| --- | --- |
| `/lager` | Vareliste, lokasjoner, kjøpsforslag og skjema for ny vare/lokasjon |
| `/lager/varer/[id]` | Beholdning per lokasjon, bevegelser, reservasjoner, justering og reservasjon |
| `/lager/lokasjoner/[id]` | Beholdning og bevegelser for ett lager eller én montørbil |
| `/lager/oppdrag/[id]` | Reservedeler for ett oppdrag, med reservasjon, frigjøring og forbruk |
| `/lager/innkjop` | Innkjøpsordrer, filter og utkast fra kjøpsforslag |
| `/lager/innkjop/[id]` | Ordrelinjer, bestilling, avbestilling og varemottak |
| `/lager/innkjop/leverandorer` | Leverandørliste og ny leverandør |

Oppdragsiden `/oppdrag/[id]` viser en modulstyrt lenke til reservedelssiden.

## Datamodell

- `InventoryLocation` – lager (`WAREHOUSE`) eller montørbil (`VAN`), med
  valgfri avdeling og ansvarlig bruker.
- `InventoryItem` – SKU, navn, enhet, bestillingspunkt og aktiv-flagg.
- `StockLevel` – mengde per vare og lokasjon (`DECIMAL(12,3)`).
- `StockMovement` – `IN`, `OUT`, `ADJUST`, `RESERVE`, `RELEASE`, `CONSUME`.
- `InventoryReservation` – aktiv, frigitt eller forbrukt mengde mot oppdrag
  og/eller arbeidsøkt.
- `Supplier` – navn, organisasjonsnummer, e-post, telefon og valgfri
  avdeling. Leverandør uten avdeling er felles for installasjonen.
- `PurchaseOrder` – menneskelig ordrenummer, leverandør, mottakslokasjon,
  status, forventet levering, notat og tidsstempler for bestilt/mottatt/
  avbestilt.
- `PurchaseOrderLine` – én vare per ordre med bestilt mengde
  (`DECIMAL(12,3)`), mottatt mengde og enhetskost (`DECIMAL(12,2)`).

Ordrenummeret tildeles fra PostgreSQL-sekvensen `PurchaseOrder_number_seq` som
`PO-ÅÅÅÅ-NNNNN`, slik at to samtidige opprettelser aldri kolliderer.
Linjesum og ordretotaler beregnes alltid på lesetid; verken klienten eller
databasen lagrer et klientberegnet beløp.

## Innkjøpsflyt

| Status | Betydning | Tillatte overganger |
| --- | --- | --- |
| `DRAFT` | Utkast som kan redigeres | `ORDERED`, `CANCELLED` |
| `ORDERED` | Bestilt, ingen varer mottatt | `PARTIALLY_RECEIVED`, `RECEIVED`, `CANCELLED` |
| `PARTIALLY_RECEIVED` | Noe er mottatt | `RECEIVED` |
| `RECEIVED` | Alt er mottatt | – |
| `CANCELLED` | Avbestilt før mottak | – |

- Bare utkast kan få endrede linjer, leverandør, lokasjon, notat og
  forventet dato. Bestilling krever minst én linje.
- Avbestilling er bare mulig før første vare er mottatt. Etter et delvis
  mottak er ordren låst til de varene som allerede er på lager.
- Varemottak tar hele eller deler av gjenstående mengde. Mottak øker
  `StockLevel` på mottakslokasjonen og skriver `StockMovement` av typen `IN`
  i samme transaksjon som linje- og ordrestatus.
- Overmottak og negative mengder avvises. Ordren låses med
  `SELECT ... FOR UPDATE`, så to samtidige mottak serialiseres; den andre ser
  oppdatert mottatt mengde og kan ikke motta mer enn det som gjenstår.
- Hver mutasjon skriver revisjonslogg i samme transaksjon.

## Kjøpsforslag og utkast

Et utkast kan bygges fra kjøpsforslagene på `/lager`. Forslaget er fortsatt
`bestillingspunkt − (på lager − aktive reservasjoner)`, aggregert over
lokasjonene aktøren ser. Valgte varer slås sammen til én linje per vare, og
mengden regnes på nytt på serveren. Enhetskost settes til `0` til den
redigeres manuelt; totalsummen er derfor `0` til kostnad er fylt inn.

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
| Se innkjøp og leverandører | `equipment.view` |
| Vare/lokasjon/justering | `equipment.manage` |
| Leverandør, innkjøpsordre, linjer, bestilling, avbestilling og mottak | `equipment.manage` |
| Reservere, frigjøre, forbruke | `workorders.update` eller `equipment.manage` |

Avdelingssperren følger lokasjonen. Innkjøpsordren fryses til
mottakslokasjonens avdeling, og leverandører uten avdeling er felles.
Administrator ser alle avdelinger.

## Forbruk ved fullført arbeid

Kjernen i visittflyten er ikke endret. Forbruk gjøres eksplisitt fra
`/lager/oppdrag/[id]`, enten per reservasjon eller samlet for en arbeidsøkt
(`consumeReservationsForVisit`). Det gir ingen skjulte sideeffekter når en
visitt settes til `DONE`.

## Residual (v1)

Varemottak med atomisk beholdning er levert; innkjøpsflyten stopper der.
Følgende er bevisst ikke levert:

- Leverandørfaktura, fakturakontroll og regnskapsintegrasjon. Mottatte varer
  gir økt beholdning, men ingen bilag eller leverandørgjeld.
- Utsending av ordre til leverandør (PDF/e-post/EDI), ordrebekreftelse og
  prishistorikk.
- Delvis avbestilling, retur/kreditnota mot leverandør og serie-/lotsporing
  på mottatte varer.
- Automatisk bestilling eller varsling når bestillingspunktet nås; forslaget
  er fortsatt bare en beregnet lesevisning.
