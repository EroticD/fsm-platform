# Sikkerhet

## Støttede versjoner

Sikkerhetsoppdateringer gis for nyeste kode på `master` og for siste utgitte
versjon. Eldre versjoner må oppgraderes for å få rettelser.

## Rapportere en sårbarhet

Ikke opprett en offentlig issue. Bruk **Security → Report a vulnerability** i
GitHub-repoet, som oppretter en privat sikkerhetsrådgivning. Kan du ikke bruke
det, send e-post til <garshol@duck.com>.

Ta gjerne med:

- hva sårbarheten er, og hvilken del av appen den gjelder
- steg for å reprodusere
- mulig konsekvens
- forslag til retting hvis du har det

Du får svar så raskt som mulig, normalt innen noen dager. Ikke del detaljene
offentlig før en rettelse er publisert.

## Omfang

Aktuelle områder:

- innlogging, økter, invitasjoner og tilbakestilling av passord
- autorisasjon og rollegrenser (innebygde roller `ADMIN`, `OFFICE`, `TECHNICIAN`,
  `USER` og `CUSTOMER`, samt roller admin oppretter)
- opplasting og visning av filer under `/uploads`
- server actions og API-ruter
- PDF-generering og tekstuttrekk/OCR
- XSS, SQL-injeksjon og lekkasje av hemmeligheter eller persondata

## Standardvalg

Disse standardene er valgt for å være sikre uten å låse driften. Overstyr dem
bare bevisst, og dokumenter hvorfor.

| Område | Standard |
| --- | --- |
| Rapporter på tvers av avdelinger | **Av** for alle roller unntatt `ADMIN`. Roller som skal se alle avdelinger, må få `reports.viewAllDepartments` eksplisitt. |
| To-trinns verifisering | Valgfritt som standard. Sett `REQUIRE_2FA_ROLES=ADMIN,OFFICE` for å kreve oppsett før innlogging. Administrasjonsroller kan nullstilles med den dokumenterte break-glass-prosedyren. |
| Offline | Sidecache i 8 timer og lokale rapportkladder i 7 dager. Brukeren kan forkaste kladdene eksplisitt. |
| Bookinger | Forespørsler, ikke reservasjoner; kontoret bekrefter. Serveren håndhever eierskap, frister og rate limits. Ledig tid er veiledende. |
| PDF | Leveres alltid som vedlegg, aldri inline. `/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile` og `/RichMedia` saneres med qpdf; filen avvises hvis sanering ikke er mulig. |
| Opplasting | Multipart strømmes til midlertidig fil med hard grense, maks 4 samtidige kropper per instans og 50 MB per PDF. Per-bruker (24 t) og per-kunde kvote håndheves; 413/507 returneres. Proxyen må også begrense kropp, tilkoblinger og tidsavbrudd. |
| API-nøkler | Scopes og valgfri skrivebeskyttelse, standard levetid 90 dager og maks 365 dager. Opprettelse, tilbakekalling og rotasjon revisjonslogges. |
| Database | Én databasebruker som standard. Valgfri deling i migrasjons- og runtime-rolle er dokumentert i `docs/OPERATIONS.md`. |
| Backup | Produksjon feiler lukket uten age-kryptering (`BACKUP_AGE_RECIPIENT`). |
| Kartnøkkel | Bruk en domenebegrenset publishable-token, ikke en hemmelig servernøkkel. |
| Reset- og invitasjonslenker | Første e-postlenke inneholder tokenet (vanlig standard). Feilomdirigeringer inneholder det ikke. |

## Sikkerhetsnotater for drift

- To-trinns verifisering (TOTP) er tilgjengelig for alle innloggede under
  Innstillinger → Sikkerhet. Den er valgfri som standard; med
  `REQUIRE_2FA_ROLES=ADMIN,OFFICE` må privilegerte brukere fullføre
  oppsettet før en sesjon opprettes. En eksisterende økt lever til den utløper
  (maks 12 timer) – det er den dokumenterte overgangsperioden for eldre kontoer.
- **Break-glass for 2FA:** mistet både app og gjenopprettingskoder løses med
  `node scripts/break-glass-2fa.mjs --email <bruker> --confirm` på serveren.
  Skriptet nullstiller 2FA for én bruker, ugyldiggjør alle økter og skriver en
  revisjonsrad. Det krever shell- og database tilgang og skal bare brukes av
  drift. Se `docs/OPERATIONS.md`.
- Innlogging, passordnullstilling, 2FA-innstillinger, opplasting, søk,
  kommentarer, PDF-visning, kundeportal-booking og iCal har
  hastighetsbegrensning. Tellerne ligger i databasen og deles mellom
  app-instanser.
- `.env` skal aldri committes eller deles. Roter `NEXTAUTH_SECRET` og
  databasepassordet hvis de kan ha vært eksponert.
- Kjør bak en reverse proxy med TLS, og sett `NEXTAUTH_URL` til den offentlige
  `https://`-adressen.
- Begrens størrelsen på forespørsler i proxyen. Appen godtar inntil 55 MB per
  opplasting (50 MB PDF pluss multipart-overhead), strømmer filen til en
  midlertidig fil og leser maks 4 samtidige kropper per instans. Per-bruker og
  per-kunde kvoter (`UPLOAD_QUOTA_USER_MB`, `UPLOAD_QUOTA_CUSTOMER_MB`)
  håndheves før filen flyttes til opplastingsmappen. Proxyen må også begrense
  tilkoblinger og tidsavbrudd.
- Jobbkøen for PDF-tekst/OCR og rate limits ligger i databasen og fungerer med
  flere app-instanser. PDF-renderingen har en prosesslokal semaphore (maks 2
  samtidige per instans).
- 2FA-innstillinger krever passord og TOTP på nytt. Endring av 2FA, passord,
  rolle eller rettigheter øker `sessionVersion`, slik at andre økter blir
  ugyldige.
- API-nøkler lagrer bare SHA-256-hash og visningsprefiks. Hver nøkkel har
  eksplisitte scopes og kan være skrivebeskyttet; kall utenfor scopene gir 403.
  Nøkler har alltid utløpsdato (standard 90 dager, maks 365). Opprettelse,
  tilbakekalling og rotasjon er attribuerbare i revisjonsloggen, og rotering
  tilbakekaller den gamle nøkkelen i samme transaksjon.
- Opplastede filer har eierskap per fil. En fil kan bare knyttes til et oppdrag,
  en kunde eller et dokument av brukeren som lastet den opp, eller av den
  eksisterende eieren.
- iCal-tokens lagres hashet, kan tilbakekalles og roteres, og avgrenses til
  brukerens egne/avdelingens oppdrag. Plaintext-tokens er fjernet; alle
  eksisterende abonnementer må regenereres.
- Live sporing er av som standard per avdeling og må slås på bevisst av en
  administrator. Sporingslenker er 32-byte tilfeldige tokens som bare lagres
  som SHA-256-hash, utløper to timer etter visittens slutt og kan tilbakekalles.
  Siden viser bare montørens fornavn, status, ETA og siste oppdatering – aldri
  koordinater, kart eller posisjonshistorikk. Posisjonsping slettes etter 24
  timer, og alle ping for en visitt slettes når visitten blir `DONE`/
  `CANCELLED`. `Permissions-Policy` tillater geolocation bare for appens eget
  opphav (`geolocation=(self)`).
- **DPIA (personvernkonsekvensvurdering):** live sporing behandler montørens
  posisjon som personopplysning. Behandlingen er begrenset til frivillig,
  eksplisitt deling mens visitten er `EN_ROUTE`, med formålsbegrensning (ETA til
  kunden), dataminimering (fornavn/status/tid, ikke rute), 24 timers retention
  og opt-in per avdeling. Vurderingen må oppdateres før sporing tas i bruk i en
  ny avdeling eller før posisjonshistorikk eventuelt innføres – sistnevnte er
  utenfor denne fasen.
- Kundeomtaler lagres internt med hashet token, krever fullført visitt og kan
  sendes inn bare én gang. Omtaler publiseres ikke offentlig; dashbordet viser
  bare aggregert gjennomsnitt og antall.
- Signerte rapporter får uforanderlige revisjoner ved opplåsing og ny
  innsending. Gamle signaturfiler beholdes for revisjonshistorikken.
- Oppdrag myk-slettes og skjules fra alle lister, søk, portal, kalender og PDF.
  Automatisk hard sletting skjer først etter `RETENTION_DAYS` og aldri når
  oppdraget eller en rapport har `legalHold`.
- Myk sletting av en kunde deaktiverer alle kundeportalbrukerne, øker
  `sessionVersion`, fjerner iCal-tokens og stenger booking/eksport. Ved
  gjenoppretting må hver portalbruker aktiveres bevisst på nytt; de
  reaktiveres aldri automatisk.
- Rapport-PDF-er ligger som `WORK_ORDER`-opplastinger, men krever
  `reports.view` i tillegg til oppdragstilgang. `/uploads` svarer med
  `private, no-store` slik at tilbakekalt tilgang ikke overlever i en cache.
- Reverse proxyen må overskrive `Host`, `X-Forwarded-Host`,
  `X-Forwarded-Proto` og `X-Forwarded-For`. Appen stoler bare på
  `x-forwarded-proto` når `TRUST_PROXY=true`.
- Ta sikkerhetskopier med `scripts/backup.sh`. Bruk `BACKUP_AGE_RECIPIENT` for
  kryptering og `BACKUP_REMOTE` for kopi til ekstern lagring. Kjør
  `scripts/restore-test.sh` månedlig – den dekrypterer med `AGE_IDENTITY` og
  verifiserer også opplastingsarkivet. Se `docs/OPERATIONS.md`.
