# Kjøreturer, utlegg og lønnsgrunnlag (FLD-01)

Modulnøkkel: `fieldExpenses` (avhenger av `calendar`).

## Flater

| Rute | Innhold |
| --- | --- |
| `/utlegg` | Montørens egne kjøreturer og utlegg, med kvitteringsopplasting |
| `/utlegg/kontor` | Godkjenning/avvisning, forhåndsvisning og eksport per periode |
| `/utlegg/kontor/eksport?start=…&end=…` | Nedlasting av låst CSV |

Oppdragsiden `/oppdrag/[id]` viser en modulstyrt lenke til
`/utlegg?oppdrag=<id>`.

## Datamodell

- `MileageTrip` – bruker, dato, fra/til, km, sats, beregnet beløp, status,
  oppdrag/visitt, godkjenner og eksportmarkør.
- `Expense` – bruker, dato, kategori, bruttobeløp, mva-del, kvittering
  (`/uploads/…`) eller dokument-id, status, godkjenner og eksportmarkør.
- `PayrollExport` – låst avdeling + periode, kontrollsum og ferdig CSV.
- `PayrollExportLine` – linjene i eksporten, med stabil referanse.

## Beregning

- Kjøregodtgjørelse: `km × sats`, avrundet til øre på serveren.
- Mva: `brutto × sats / (100 + sats)`, avrundet til øre. Klienten kan ikke
  sende et ferdig beløp som avviker.
- Standardverdier er 3,50 kr/km og 25 % mva når skjemaet ikke oppgir annet.
  Satsene lagres per rad, slik at historiske eksporter ikke endres av senere
  satsendringer.

## Godkjenning

Kjøretur og utlegg starter som `PENDING` (eller `DRAFT` når klienten ber om
det) og kan godkjennes eller avvises av kontobruker med
`workorders.edit`/`workorders.update`/`settings.manage`. Avvisning krever
begrunnelse. Avdelingssperren gjør at kontor A ikke kan godkjenne rader i
kontor B.

## Lønns-CSV – kontrakt

Filen er UTF-8 med BOM, semikolonseparert og med `\r\n`-linjeskift, klar for
norsk Excel. Første rad er alltid:

```text
type;bruker;dato;referanse;beskrivelse;mengde;enhet;belop;mva
```

- `type`: `WORK`, `TRAVEL`, `MILEAGE` eller `EXPENSE`.
- `bruker`: visningsnavn fra brukerregisteret.
- `dato`: `YYYY-MM-DD`.
- `referanse`: oppdrags-id når raden er knyttet til et oppdrag, ellers en
  stabil intern referanse.
- `mengde`: timer for `WORK`/`TRAVEL`, kilometer for `MILEAGE`, `1` for
  `EXPENSE`.
- `belop` og `mva`: desimaltall med komma, to desimaler.

Tid og reisetid hentes fra eksisterende `Visit`-felter (`enRouteAt`,
`onSiteAt`, `doneAt`, `travelFromEndedAt`). Modulen lager ingen egen
timeføring. Bare godkjente kjøreturer og utlegg eksporteres; avviste og
uavklarte rader er alltid utelatt.

## Idempotens

`PayrollExport` har unik nøkkel `(departmentId, periodStart, periodEnd)`.
Samme avdeling og periode returnerer nøyaktig samme CSV og kontrollsum uten nye
rader. Overlappende perioder avvises med `expenses.errors.periodOverlap`, slik
at tid, kjøreturer og utlegg ikke kan eksporteres to ganger. Kjøreturer og
utlegg merkes med `payrollExportId` og `exportedAt` når de låses.

## Revisjon

Registrering, endring, innsending, godkjenning, avvisning og eksport skriver
revisjonslogg i samme transaksjon som endringen.

## Ikke inkludert

Ingen ekstern lønnsleverandør er integrert. CSV-kontrakten over er grensesnittet
mot lønnssystemet, og må eventuelt mappes av en integrasjon utenfor denne
modulen.
