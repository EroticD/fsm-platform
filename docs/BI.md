# Lønnsomhet og rapportbygger (BI-01 v1)

Siden **Lønnsomhet** (`/lonnsomhet`) gir kontor og administrator ett samlet
bilde av oppdrag, tid, first-time-fix og **estimert** inntekt per avdeling,
kunde og montør. Rapporten kan filtreres på periode, avdeling, kunde og montør,
og eksporteres til CSV med nøyaktig samme filter og avdelingsomfang.

Modulen er `bi` (avhengig av `reports`). Siden og eksportruten bruker
`requireModulePage("bi")` / `moduleApiGuard("bi")`, så en avslått modul gir 404
også ved direkte URL.

> **Montering:** denne leveransen legger bare til side, API-rute og
> `messages/fragments/bi.<språk>.json`. Modulkatalogen, navigasjonen,
> innstillingsfanen og importen av fragmentene i `src/i18n/messages.ts` wires av
> hovedagenten. Til det er gjort, er `bi` fortsatt en planlagt plassholder og
> fragmentnøklene er ikke med i de sammenslåtte katalogfilene.

## Tilgang og avdelingsomfang

- Bare roller med kontor-/administratorarbeid slipper inn, og bare med
  rettigheten `reports.view`. Montører og kundeportalbrukere får 403/redirect.
- Administrator ser alle aktive avdelinger og kan velge avdeling i filteret.
- Kontor ser bare egen aktiv avdeling. Et filterforsøk på en annen avdeling
  avvises med `forbidden`; omfanget kan ikke utvides via URL-en.
- Kunde- og montørfiltre kombineres alltid med avdelingsomfanget. En kunde i en
  annen avdeling gir ingen rader, ikke ikke tilgang til den.

## Datagrunnlag og beregninger

| Tall | Kilde | Merknad |
| --- | --- | --- |
| Antall oppdrag, status, fullføringsgrad | `WorkOrder.status` og `scheduledFor` | Perioden følger oppdragets planlagte dato (`scheduledFor`). |
| Arbeids- og reisetid | `Visit` via `src/lib/visit-time.ts` | Tilkjøring, arbeid og returkjøring summeres. Kansellerte visiter utelates. |
| Utnyttelse | Visittid mot tilgjengelighet | Eksplisitt `CapacityPlan` vinner, deretter `UserAvailability`, deretter avdelingens `BusinessHours`, deretter 8 timer. |
| First-time-fix | Signerte rapporter og `deviationSourceKey` | Bare fullførte oppdrag med rapport og uten `AVVIK` telles som fikset første gang. Utbedringsoppdrag og oppdrag uten rapport holdes utenfor nevneren. |
| Estimert inntekt | Timepris i avtalens `PriceList` × arbeidstid | Bare rader som uttrykkelig er per time (`unit` time/timer, eller kode `TIME`, `ARBEIDSTIME` osv.) brukes. Reisetid inngår ikke i inntektsestimatet. |
| Estimert resultat | Estimert inntekt − intern kostnadssats × total tid | Beregnes bare når alle oppdrag i utvalget har timepris og `BI_INTERNAL_COST_RATE_NOK` er satt. Ellers vises «ikke beregnet». |

Alle time- og inntektstall er i øre internt og formateres i UI/CSV. Delt visitt
telles for hver deltakende montør i montørtabellen, men bare én gang i totalen.

### Intern kostnadssats

V1 har ingen kostnadsdata i databasen. Sett derfor en bevisst driftsverdi:

```bash
BI_INTERNAL_COST_RATE_NOK=450
```

Uten verdien viser siden estimert inntekt, men resultat står som «ikke
beregnet». Dette er med vilje: uten en kostnadssats ville «resultat» bare vært
omsetning.

## Viktige begrensninger i v1

- **Ingen faktisk omsetning.** Faktureringsmodulen (`invoicing`, REV-02) finnes
  ikke. `actualAvailable` er alltid `false` og `actualRevenueOre` alltid `null`.
  Alle inntekts- og resultattall er merket som estimater i UI og CSV.
- **Ingen kostnadsdata per oppdrag.** Resultat bruker en valgfri intern sats,
  ikke lønn, bil, deler eller utlegg. Kostnadsgrunnlaget står derfor alltid som
  `missing` eller `internal_rate`.
- **Ingen fradrag for fravær** i tilgjengeligheten. Fravær blokkerer
  planlegging, men trekkes ikke fra BI-utnyttelsen ennå.
- **Perioden er oppdragets planlagte dato.** Oppdrag uten `scheduledFor`, eller
  med visitt flyttet inn i perioden, telles ikke med i oppdragsantallet.
- **Maks 5 000 oppdrag og 366 dager per rapport.** Større uttrekk avvises med
  `too_large` i stedet for å belaste serveren ukontrollert.
- **CSV, ikke PDF.** PDF-eksport og egendefinerte rapportbyggere er ikke en del
  av denne leveransen.

## CSV-eksport

Eksporten ligger på `/api/lonnsomhet/eksport` og tar samme parametre som siden:
`fra`, `til`, `avdeling`, `kunde`, `tekniker`. Den bruker samme tjenestefunksjon
som skjermen, så filter og avdelingsomfang er identisk.

- Filnavn: `lonnsomhet-<fra>-<til>.csv`.
- Innholdet har nivåene sammendrag, tekniker, kunde og oppdrag.
- Sorteringen er stabil og filen inneholder ingen tidsstempel. Gjentatt eksport
  med samme filter gir derfor samme innhold og samme SHA-256-sjekksum.
- Hver eksport skrives til revisjonsloggen med filter, radantall, sjekksum og
  `actualRevenueAvailable: false`.
- Alle celler går gjennom `csvCell`/`toCsv`, som nøytraliserer formelinjeksjon i
  Excel/LibreOffice og legger på UTF-8-BOM.

## Testing

- `src/lib/bi.test.ts`: filtervalidering, timeprisvalg, first-time-fix,
  kapasitetsfallback, summering med reise, estimat/faktisk-merking, tomt
  datasett og CSV-injeksjon.
- `src/server/bi.test.ts`: autorisasjon, avdelingsisolering, filterbruk,
  kostnadssats, eksportens determinisme/revisjon og datatak.
- `src/app/lonnsomhet/page.test.ts` og
  `src/app/api/lonnsomhet/eksport/route.test.ts`: modul av (404), redirect for
  montør, filterpasning og CSV-respons.

## Residualer før REV-02

1. Bytt estimat med faktisk omsetning når fakturaer finnes, og vis begge tall
   side om side.
2. Legg inn kostnadsgrunnlag per oppdrag (lønn, bil, deler, utlegg) i stedet
   for én global intern sats.
3. Trekk fra fravær og helligdager i tilgjengeligheten.
4. Vurder PDF-eksport og egendefinert rapportbygger som egen leveranse.
