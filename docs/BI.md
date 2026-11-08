# Lønnsomhet og rapportbygger (BI-01 v1)

Siden **Lønnsomhet** (`/lonnsomhet`) gir kontor og administrator ett samlet
bilde av oppdrag, tid, first-time-fix, **estimert** og **faktisk** inntekt per
avdeling, kunde og montør. Rapporten kan filtreres på periode, avdeling, kunde
og montør, og eksporteres til CSV med nøyaktig samme filter og avdelingsomfang.

Modulen er `bi` (ingen hard modulavhengighet; faktisk omsetning krever
`invoicing`). Siden og eksportruten bruker
`requireModulePage("bi")` / `moduleApiGuard("bi")`, så en avslått modul gir 404
også ved direkte URL.

Faktisk omsetning hentes bare når `invoicing`-modulen (REV-02) er slått på.
Er den av, eller finnes det ingen ikke-kladde fakturaer i utvalget, viser
rapporten estimatet alene og forklarer hvorfor faktisk omsetning mangler.

## Tilgang og avdelingsomfang

- Bare roller med kontor-/administratorarbeid slipper inn, og bare med
  rettigheten `reports.view`. Montører og kundeportalbrukere får 403/redirect.
- Administrator ser alle aktive avdelinger og kan velge avdeling i filteret.
- Kontor ser bare egen aktiv avdeling. Et filterforsøk på en annen avdeling
  avvises med `forbidden`; omfanget kan ikke utvides via URL-en.
- Kunde- og montørfiltre kombineres alltid med avdelingsomfanget. En kunde i en
  annen avdeling gir ingen rader, ikke ikke tilgang til den.
- Fakturaer følger nøyaktig samme avdelings-, kunde- og montørfilter som
  oppdragene. En faktura må dessuten tilhøre en avdeling i omfanget.

## Datagrunnlag og beregninger

| Tall | Kilde | Merknad |
| --- | --- | --- |
| Antall oppdrag, status, fullføringsgrad | `WorkOrder.status` og `scheduledFor` | Perioden følger oppdragets planlagte dato (`scheduledFor`). |
| Arbeids- og reisetid | `Visit` via `src/lib/visit-time.ts` | Tilkjøring, arbeid og returkjøring summeres. Kansellerte visiter utelates. |
| Utnyttelse | Visittid mot tilgjengelighet | Eksplisitt `CapacityPlan` vinner, deretter `UserAvailability`, deretter avdelingens `BusinessHours`, deretter 8 timer. |
| First-time-fix | Signerte rapporter og `deviationSourceKey` | Bare fullførte oppdrag med rapport og uten `AVVIK` telles som fikset første gang. Utbedringsoppdrag og oppdrag uten rapport holdes utenfor nevneren. |
| Estimert inntekt | Timepris i avtalens `PriceList` × arbeidstid | Bare rader som uttrykkelig er per time (`unit` time/timer, eller kode `TIME`, `ARBEIDSTIME` osv.) brukes. Reisetid inngår ikke i inntektsestimatet. |
| Faktisk omsetning | `Invoice.subtotal` − netto kreditnotaer | Netto eksklusiv MVA, bare ikke-kladde fakturaer som er knyttet til et oppdrag i utvalget og utstedt i perioden. Se formelen under. |
| Estimert resultat | Estimert inntekt − intern kostnadssats × total tid | Beregnes bare når alle oppdrag i utvalget har timepris og `BI_INTERNAL_COST_RATE_NOK` er satt. Ellers vises «ikke beregnet». |

Alle time- og inntektstall er i øre internt og formateres i UI/CSV. Delt visitt
telles for hver deltakende montør i montørtabellen, men bare én gang i totalen.

### Faktisk omsetning – formel og avgrensning

Faktisk omsetning er **inntektsført på fakturadato**, ikke på betalingsdato:

```text
netto faktura (øre) = round(Invoice.subtotal × 100)
                    − sum(round(CreditNote.amount × 100))
faktisk omsetning    = Σ netto faktura for alle fakturaer i utvalget
```

- `Invoice.subtotal` er lagret eksklusiv MVA. `Invoice.total` og
  `Invoice.creditedTotal` inneholder MVA og brukes derfor ikke.
- `CreditNote.amount` er kreditnotaens netto beløp eksklusiv MVA. Alle
  kreditnotaer som hører til fakturaen trekkes fra, uavhengig av når
  kreditnotaen ble utstedt. En fullt kreditert faktura gir dermed 0.
- Et overkreditert beløp klippes til 0. Rapporten viser aldri negativ omsetning.
- **DRAFT utelates helt.** Statusene `SENT`, `PARTIALLY_PAID`, `PAID`,
  `OVERDUE` og `CREDITED` behandles likt: betalingsstatus påvirker ikke
  inntektsføringen. En forfalt faktura teller altså som omsetning.
- Fakturaen må være knyttet til et oppdrag (`Invoice.workOrderId`) som er med i
  rapportens oppdragssett, og `Invoice.issueDate` må ligge i perioden. Fakturaer
  uten oppdrag (for eksempel en manuell faktura eller en ren tilbudsfaktura)
  inngår ikke i oppdragsøkonomien. Det samme gjelder fakturaer for oppdrag
  utenfor periode-, avdeling-, kunde- eller montørfilteret.
- `actualAvailable` er `true` bare når `invoicing`-modulen er på **og** minst
  én ikke-kladd faktura er i utvalget. Ellers er `actualRevenueOre` `null`.
  Når faktisk omsetning er tilgjengelig, vises 0 for oppdrag/kunder/montører
  uten faktura i perioden.

### Per montør og delte oppdrag

Faktisk omsetning føres til **oppdragets primære montør**, definert som
montøren med lavest bruker-id i `WorkOrder.technicians`. Hele fakturabeløpet
føres til denne montøren; det splittes ikke etter visittdeltakelse. Da blir
delte oppdrag og delte visiter aldri dobbelttalt, og summen per montør er lik
totalen for fakturaer som har en tildelt montør. Oppdrag uten tildelt montør
inngår i total, kunde og oppdrag, men ikke i montørtabellen.

Dette er en bevisst forenkling. Estimatet per montør fordeler fortsatt hele
estimatet til hver montør som deltar på oppdraget, slik at estimat og faktisk
omsetning per montør kan avvike når et oppdrag har flere montører.

### Intern kostnadssats

V1 har ingen kostnadsdata i databasen. Sett derfor en bevisst driftsverdi:

```bash
BI_INTERNAL_COST_RATE_NOK=450
```

Uten verdien viser siden estimert inntekt, men resultat står som «ikke
beregnet». Dette er med vilje: uten en kostnadssats ville «resultat» bare vært
omsetning. Faktisk omsetning påvirker ikke resultatberegningen; resultatet er
fortsatt basert på estimatet.

## Viktige begrensninger

- **Kostnadsgrunnlaget er globalt.** Resultat bruker en valgfri intern sats,
  ikke lønn, bil, deler eller utlegg per oppdrag. Kostnadsgrunnlaget står derfor
  alltid som `missing` eller `internal_rate`.
- **Ingen fradrag for fravær** i tilgjengeligheten. Fravær blokkerer
  planlegging, men trekkes ikke fra BI-utnyttelsen ennå.
- **Perioden er oppdragets planlagte dato** for oppdrag og estimat. Faktisk
  omsetning bruker i tillegg fakturadato. Et oppdrag som planlegges i én måned
  og faktureres i neste, får estimat i første måned og faktisk omsetning i
  andre. Det er en bevisst forskjell mellom periodisering av estimat og
  faktisk inntektsføring.
- **Maks 5 000 oppdrag, 5 000 fakturaer og 366 dager per rapport.** Større
  uttrekk avvises med `too_large` i stedet for å belaste serveren ukontrollert.
- **CSV, ikke PDF.** PDF-eksport og egendefinerte rapportbyggere er ikke en del
  av denne leveransen.

## CSV-eksport

Eksporten ligger på `/api/lonnsomhet/eksport` og tar samme parametre som siden:
`fra`, `til`, `avdeling`, `kunde`, `tekniker`. Den bruker samme tjenestefunksjon
som skjermen, så filter og avdelingsomfang er identisk.

- Filnavn: `lonnsomhet-<fra>-<til>.csv`.
- Innholdet har nivåene sammendrag, tekniker, kunde og oppdrag.
- Kolonnene `Estimert inntekt (NOK)`, `Faktisk inntekt (NOK)` og
  `Faktisk tilgjengelig` er stabile. Faktisk inntekt er tom når den er
  utilgjengelig, ellers formatert med to desimaler.
- Sorteringen er stabil og filen inneholder ingen tidsstempel. Gjentatt eksport
  med samme filter gir derfor samme innhold og samme SHA-256-sjekksum.
- Hver eksport skrives til revisjonsloggen med filter, radantall, sjekksum,
  `actualRevenueAvailable` og `actualInvoiceCount`.
- Alle celler går gjennom `csvCell`/`toCsv`, som nøytraliserer formelinjeksjon i
  Excel/LibreOffice og legger på UTF-8-BOM.

## Testing

- `src/lib/bi.test.ts`: filtervalidering, timeprisvalg, first-time-fix,
  kapasitetsfallback, summering med reise, faktisk omsetning (MVA, kreditnota,
  kladd, delt oppdrag, tomt utvalg, modul av) og CSV-injeksjon.
- `src/server/bi.test.ts`: autorisasjon, avdelingsisolering, filterbruk,
  kostnadssats, modulstyring, fakturaaggregat, eksportens determinisme/revisjon
  og datatak.
- `src/app/lonnsomhet/page.test.ts` og
  `src/app/api/lonnsomhet/eksport/route.test.ts`: modul av (404), redirect for
  montør, filterpasning, faktisk/utilgjengelig visning og CSV-respons.
- `src/server/integration/bi-actual.integration.test.ts`: ekte PostgreSQL med
  to avdelinger, kunder, oppdrag, fakturaer, kreditnota og kladd; kontrollerer
  netto faktisk omsetning, avdelingsisolering og modulstyring.

## Residualer

1. Legg inn kostnadsgrunnlag per oppdrag (lønn, bil, deler, utlegg) i stedet
   for én global intern sats.
2. Trekk fra fravær og helligdager i tilgjengeligheten.
3. Vurder PDF-eksport og egendefinert rapportbygger som egen leveranse; CSV er
   i dag eneste eksportformat.
4. Vurder en mer finmasket fordeling av faktisk omsetning per montør når flere
   montører deler et oppdrag, og inkludering av fakturaer uten oppdrag i en
   egen omsetningsrapport.
