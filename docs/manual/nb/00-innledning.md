# Introduksjon og systemoversikt

*Gjelder FSM-plattformen versjon 0.9.4, 8. november 2026.*

## Hva FSM-plattformen er

FSM-plattformen er et service- og vedlikeholdssystem for arbeid hos kunden: service, vedlikehold, inspeksjon og reparasjon. Systemet samler planlegging, oppdrag, besøk, sjekklister, rapporter, utstyr, serviceavtaler, dokumenter og kundeportal i én tjeneste.

Kontoret skal kunne planlegge uten sideliggende regneark, montøren skal kunne jobbe fra telefon eller nettbrett også med dårlig nett, og kunden skal se avtaler, besøk, rapporter og utstyr uten å ringe. Kjernen dokumenterer og planlegger arbeid og registrerer tid og reisetid per arbeidsdag. Tilbud, fakturering, betaling, regnskapssynk, lager, utlegg og lønnsomhet er valgfrie moduler som må slås på av administrator. Uten modulene er prislister og avtalebeløp referansedata, og fakturering skjer utenfor plattformen.

### De fire rollene

| Rolle | Hvem | Hovedoppgave | Ser |
| --- | --- | --- | --- |
| **Administrator** | System- eller driftsansvarlig | Setter opp avdelinger, roller, maler, merkevare, API og sikkerhet | Alt, i alle avdelinger |
| **Kontor** | Serviceleder, planlegger, saksbehandler | Planlegger og fordeler arbeid, følger opp kunder, avtaler, bookinger og rapporter | Egen avdeling for oppdrag, avtaler og rapporter; kunder, utstyr og dokumenter er felles |
| **Montør** | Servicetekniker i felt | Utfører besøk, fyller ut sjekklister, tar bilder og signerer | Egen avdeling for oppdrag og rapporter; kunder, utstyr og dokumenter er tilgjengelige |
| **Kundeportalbruker** | Kunde eller kontaktperson | Bestiller service, følger besøk, leser rapporter og ser eget utstyr | Egen kunde, med tildelt portaltilgang |

> **Merk:** «Kontor» er en rolle, ikke en fysisk plass. Administrator kan lage egne roller og gi enkeltbrukere tilpassede rettigheter.

## Hva er nytt i 0.9.4

0.9.4 retter innloggingsredirect, stopper enroute, returkjøring og sporing når et oppdrag lukkes, gir teknikeren kontordashbord på datamaskin og «I dag» på mobil, og viser feltspesifikke skjemafeil. Funksjonslista under oppsummerer plattformen fra 0.9.0.

- **Tilbud, faktura og betalingslenker.** Tilbud har versjoner, utskrift og
  engangs godkjenningslenke. Fakturaer har delbetaling, kreditnota, forfall og
  CSV. Kunden kan betale med Stripe Checkout eller Vipps MobilePay der
  leverandøren er konfigurert. Se [tilbud og fakturering](40-tilbud-faktura.md).
- **Regnskapssynk.** Sendte fakturaer kan synkroniseres manuelt til Fiken,
  Tripletex eller PowerOffice Go, med CSV som eksplisitt eksportfallback.
  Synken er idempotent og revisjonssporet. Se
  [regnskap](40-tilbud-faktura.md).
- **Lager, leverandører og innkjøp.** Vareliste, lokasjoner, beholdning,
  reservasjoner, forbruk, leverandørregister, innkjøpsordrer og varemottak.
  Se [lager](10-kontor.md).
- **Kjøreturer, utlegg og lønnsgrunnlag.** Montøren registrerer kjøretur og
  utlegg med kvittering; kontoret godkjenner og eksporterer en låst lønns-CSV
  per periode. Se [utlegg](10-kontor.md).
- **Lønnsomhet.** Estimert og faktisk omsetning, tid, first-time-fix og
  utnyttelse per avdeling, kunde og montør, med CSV-eksport. Se
  [lønnsomhet](10-kontor.md).
- **Automatisk e-post og push.** Transaksjons-e-post går gjennom en vedvarende
  utboks med retry, av/på per hendelse og testutsending. Pushvarsler går via FCM
  og APNs med dype lenker og enhetsregistrering. Se
  [administrator](30-administrator.md) og [tekniker](20-tekniker.md).
- **Ruting med trafikk og overtid.** Ruting bruker OpenStreetMap/OSRM, med
  valgfri Google Routes API for trafikkbevisst ETA. Visiter som ikke rekker
  tidsvinduet, planlegges som overtid i stedet for å bli ufordelte. Se
  [ruteplan](10-kontor.md).
- **Manuell rekkefølge.** Både ruteplanleggeren og **Dager og tid** på oppdraget
  har nummerfelt 1/2/3/4. Manuell rekkefølge overstyrer den automatiske
  optimaliseringen og revideres per visitt.
- **SAML 2.0, SCIM-grupper og feltnivå-RBAC.** SAML kan brukes sammen med eller
  i stedet for OIDC. SCIM Groups gir rolle og avdeling gjennom eksplisitt
  mapping. Sensitive felt maskeres på serveren for montører og kundeportalen.
  Se [SSO og SCIM](31-sso-scim.md).
- **API for tilbud, eksterne ordrer og lager.** `/api/v1/quotes`,
  `/api/v1/orders` og `/api/v1/inventory/**` har egne scopes. Eksterne
  ordresystemer bruker `source` + `externalId` og `Idempotency-Key`, og får
  samme ordre tilbake ved replay. Se [administrator](30-administrator.md).
- **S3, Redis og HA/PITR.** Opplastinger kan ligge i S3/MinIO, jobbkø og rate
  limits kan bruke Redis, og HA-profilen har flere app-replikaer, WAL-arkivering
  og testet PITR-gjenoppretting. Se [administrator](30-administrator.md).
- **Etterlevelse.** ISO/IEC 27001 og SOC 2-pakken er et
  **readiness-grunnlag**, ikke en sertifisering eller revisjonsrapport. Se
  [administrator](30-administrator.md).

## Slik er systemet bygget opp

| Flate | Hva du gjør der |
| --- | --- |
| **Nettleser og PWA** | Åpner systemet på PC, nettbrett eller telefon. Feltflaten kan installeres som app og brukes med begrenset nett. |
| **Kontorflaten** | Planlegger i lister, tavle, kalender og dispatch. Behandler kunder, avtaler, bookinger, rapporter og innstillinger. |
| **Feltflaten** | Viser dagens jobber, neste handling, kartlenke, sjekklister, bilder og signatur, med store trykkflater og mørkt tema. |
| **Kundeportalen** | Gir kunden oversikt over egne bestillinger, rapporter, dokumenter, utstyr, avtaler, besøk og meldinger. |
| **REST-API-et** | Lar andre systemer lese og skrive data med en egen API-nøkkel og samme rettighetskontroll. |

Bak flatene ligger en felles applikasjon som håndhever arbeidsflyt og tilgang. Den er bygget med Next.js og React, med Prisma mot PostgreSQL som sannhetskilde. Feltappen er en PWA med service worker og IndexedDB for offline kladder. PDF-er og opplastede filer ligger i et eget filvolum. Rapport-PDF-er rendres i prosessen med en egen samtidighetsgrense; OCR og dokumentjobber går gjennom en jobbkø.

| Lag | Innhold |
| --- | --- |
| **Brukerflater** | Kundeportal, kontorflate, feltflate og REST-API-klienter i nettleser eller installert PWA. |
| **Applikasjon** | Tilgangskontroll, arbeidsflyt, varsler, søk og PDF-rendering. |
| **Data og jobber** | PostgreSQL med data, revisjon og aktivitetslogg; filvolum for PDF-er og bilder; jobbkø for OCR, dokumentjobber og varsler; e-post/SMS der det er satt opp. |

### Moduler

Plattformen har en kjerne og en katalog med moduler som kan slås av og på under
**Innstillinger → Moduler**. Kjernen (kunder, oppdrag, arbeidsdager, tid,
revisjon og innstillinger) virker uten valgfrie moduler. En modul kan ha
avhengigheter, og modulvakten gir `404` på sider og API-er når modulen er av.

| Modul | Nøkkel | Gir |
| --- | --- | --- |
| **Tilbud** | `quotes` | Tilbud, versjoner, godkjenningslenke og konvertering til oppdrag |
| **Fakturering** | `invoicing` | Faktura, betaling, kreditnota, forfall og CSV |
| **Lager** | `inventory` | Varer, lokasjoner, beholdning, reservasjoner og innkjøp |
| **Utlegg** | `fieldExpenses` | Kjøreturer, utlegg og lønns-CSV |
| **Lønnsomhet** | `bi` | Estimert og faktisk omsetning, tid og CSV |
| **Kundeportal** | `portal` | Kundens egen flate |
| **API** | `api` | REST-API-et under `/api/v1` |

Eksisterende installasjoner får alle leverte moduler på. Slår du av en modul,
forsvinner navigasjon, innstillinger, søketreff og bakgrunnsjobber for området,
men dataene beholdes. Slå modulen på igjen for å få tilgangen tilbake.

Feltflaten har et lokalt mellomlager i nettleseren:

1. **Uten nett:** skjemaet lagres i IndexedDB som kladd og utboks.
2. **Med nett:** kladden sendes til serveren, som bekrefter mottak.
3. **Alltid:** serveren avgjør om en rapport faktisk er mottatt; «sendt» vises først etter bekreftelse.

En kladd kan lagres lokalt, men en innsendt rapport regnes ikke som sendt før serveren bekrefter den. Derfor viser feltflaten «kladd lagret lokalt» og «venter på sending» som to ulike tilstander.

### Kjerneentiteter

| Entitet | Hva det er | Viktige koblinger |
| --- | --- | --- |
| **Avdeling** | Organisatorisk enhet som avgjør hvem som ser hva | Ansatte, oppdrag, kunder, avtaler, åpningstider |
| **Bruker og rolle** | Ansatt eller kundeportalbruker med rettigheter | Avdeling, kunde, kontaktperson, API-nøkler |
| **Kunde** | Firmaet som mottar service | Kontakter, steder, utstyr, avtaler, oppdrag |
| **Kontaktperson** | Personen kontoret og montøren forholder seg til | Kunde, oppdrag, avtale, portalbruker |
| **Sted** | Fysisk adresse eller anlegg hos kunden | Kunde, oppdrag, utstyr, bestilling |
| **Utstyr/enhet** | Maskin eller system som serviceres | Kunde, sted, målinger, vedlikeholdsplaner, historikk |
| **Oppdrag** | Selve servicejobben med status og ansvar | Kunde, kontakt, sted, utstyr, maler, visiter, rapporter |
| **Visitt** | Tidsblokk i et oppdrag, med montører og status | Oppdrag, montører, sporing, målinger |
| **Sjekklistemal** | Gjenbrukbar mal for service eller HMS | Oppdrag, avtale, rapport, vedlikeholdsplan |
| **Rapport, enhet og svar** | Utfylt sjekkliste med enheter, bilder og signaturer | Oppdrag, mal, utstyr, PDF, revisjoner, kvittering |
| **Serviceavtale og SLA** | Avtale om gjentagende service og frister | Kunde, avdeling, mal, SLA-policy, oppdrag |
| **Bestilling** | Kundens forespørsel eller bekreftede time | Kunde, sted, utstyr, oppdrag, visitt, hendelser |
| **Tilbud** | Prisforslag med linjer, versjoner og godkjenning | Kunde, kontakt, oppdrag, avtale, utstyr |
| **Faktura og betaling** | Fakturert beløp, betalinger og kreditnota | Kunde, oppdrag, rapport, tilbud |
| **Vare og beholdning** | Reservedel med beholdning per lokasjon | Lokasjon, reservasjon, oppdrag |
| **Innkjopsordre** | Bestilling til leverandør med varemottak | Leverandør, mottakslokasjon, varelinjer |
| **Kjøretur og utlegg** | Kjøregodtgjørelse eller utgift med kvittering | Bruker, oppdrag, godkjenner, lønns-CSV |
| **Dokument** | Fil i biblioteket eller vedlegg | Mappe, tags, versjoner, oppdrag, kunde, avtale |
| **Varsel** | Melding til en bruker om en hendelse | Bruker, type, kilde, lenke, e-poststatus |
| **Aktivitetslogg** | Sporbar historikk over handlinger | Entitet, aktør, tidspunkt, metadata |
| **API-nøkkel** | Hemmelighet for integrasjoner | Bruker, rettigheter, utløp, tilbakekalling |

## Flytene fra ende til annen

Rollekapitlene beskriver hvert skritt i detalj. Her ser du hvordan rollene og dataene henger sammen.

### 1. Serviceavtale → gjentagende oppdrag → rapport → PDF og historikk

1. **Kontor eller administrator** oppretter en serviceavtale med intervall (3, 6, 12 eller 24 måneder), start- og sluttdato, avdeling, mal, eventuell SLA og fornyelsesmåte.
2. **Systemet** oppretter et nytt oppdrag når `Neste service` forfaller. Oppdraget arver kunde, kontakt, mal og avdeling; forrige rapport legges ved som PDF.
3. **Kontoret** ser oppdraget i «Oppdrag» og «Kalender», kontrollerer visiten og tildeler montør.
4. **Montøren** fyller ut sjekklisten per enhet, tar bilder, kommenterer avvik og signerer hvis ønskelig. Kunden kan signere samtidig.
5. **Systemet** låser rapporten, lagrer revisjon, lager PDF og varsler kontoret og kundeportalen. Ved avvik opprettes ett udatert utbedringsoppdrag.
6. **Kundeportalbrukeren** ser den innsendte, låste rapporten, laster ned PDF og kvitterer. Kvitteringen vises for kontoret.
7. **Kontoret** følger opp avvik. Utstyret på kundekortet viser servicehistorikken fra rapportens enheter.

> **Merk:** Rapporten låses ved innsending. Endres malen eller utstyret senere, beholder rapporten opplysningene som gjaldt da den ble sendt.

### 2. Bestilling i kundeportalen → oppdrag og varsel → dispatch → montør

1. **Kundeportalbrukeren** velger sted, tjeneste og ønsket dato i «Bestillinger». Ønsket klokkeslett skrives i beskrivelsen; kunden kan ikke velge tidsblokk.
2. **Systemet** oppretter et nytt oppdrag med status `OPEN` og en ubekreftet bestilling. Det opprettes ingen visitt eller bekreftet tid, og kontoret varsles.
3. **Kontoret eller montøren** planlegger oppdraget og setter status **Planlagt**, eller **Venter** hvis tiden ikke passer. Først da bekreftes dato og tid.
4. **Montøren** får tildelingsvarsel og ser besøket i «I dag». Kansellering gir nytt varsel.

> **Tips:** En kundebestilling er en forespørsel, ikke en bekreftet avtale. Kontoret må alltid planlegge den før kunden får endelig tid.

### 3. Kontoret oppretter oppdrag → kalender, tavle og tildeling → felt

1. **Kontoret** velger «Nytt oppdrag» og fyller inn tittel, kunde, kontakt, sted, dato, mal og eventuelt tags og montør.
2. **Systemet** oppretter oppdraget og en visitt i samme transaksjon når dato er satt. Nye oppdrag starter som `PENDING`; udaterte oppdrag har ingen visitt.
3. **Kontoret** fordeler arbeidet via «Tildel montør», kalenderen, dashbordets tavle eller dispatch med forslag og automatisk tildeling.
4. **Montøren** ser oppdraget i «I dag» eller «Oppdrag» og kan ta ledige oppdrag med «Ta oppdraget» hvis rollen tillater det.
5. **Montøren** starter kjøring, markerer «På stedet», fyller ut skjemaet og fullfører. Status, kommentarer og rapport går tilbake til kontoret.
6. **Kontoret** følger opp forfalte oppdrag, avvik, manglende signatur og rapporter som ikke er kvittert.

> **Merk:** På tavlen tildeler et slipp en montør; det flytter ikke datoen. Dato og tid endres i kalenderen eller i visittens detaljer.

### 4. Sporing og omtale → kundeportal og kontorets oppfølging

1. **Administrator** slår på live-sporing for avdelingen. Det er av som standard og gjelder bare visiter i den avdelingen.
2. **Montøren** setter visitten til «På vei» og kan dele posisjon. Kunden åpner sporingslenken fra «Besøk» eller får den tilsendt.
3. **Kundeportalbrukeren** ser fornavn, status og estimert ankomst. Posisjonen vises aldri som kart eller koordinater, og lenken utløper når visitten er ferdig eller etter to timer.
4. **Kunden** kan gi intern omtale etter fullført visitt. Omtalen er intern og publiseres ikke; den er ikke vist som eget dashboard i 0.9.4.

### 5. Rettigheter, varsler og aktivitetslogg gjennom alle flytene

1. **Alle** handlinger autoriseres på serveren. Ansatte ser egne oppdrag, avtaler og rapporter, mens kunder, utstyr og dokumenter er felles. Administrator ser alt, og kundeportalbrukere ser bare egen kunde og tildelte portalområder.
2. **Systemet** varsler ved tildeling, datoendring, kansellering, ferdig rapport, booking, avtaleforfall, forfalte oppdrag, SLA-hendelser og kontaktforespørsler. Varslene går til bjellen, «Varsler» og eventuelt e-post.
3. **Aktivitetsloggen** registrerer hvem som opprettet, endret, flyttet, kansellerte, slettet, låste opp eller slo på bevaringsplikt, med tid og aktør. Loggen kan ikke redigeres.
4. **Administrator** kan endre roller og rettigheter. Gamle sesjoner avvises, og API-nøkler arver brukerens gjeldende rettigheter.
5. **Bevaringsplikt** stopper sletting og endring. En låst rapport kan bare låses opp av administrator, med begrunnelse, og opplåsingen logges.

## Navigasjon per rolle

Menyen er tilpasset rolle og rettigheter, så du ser ikke nødvendigvis alle valgene.

| Rolle | Hjem | Hovedmeny | Hamburger og innstillinger |
| --- | --- | --- | --- |
| **Administrator** | «Dashbord» | Dashbord, Oppdrag, Kalender, Kunder, Meldinger, Rapporter | Bookinger, Avtaler, Enheter, Søk, HMS, Dokumenter, Kart, Nytt oppdrag, Varsler, Tilbud, Faktura, Lager, Utlegg, Lønnsomhet, Innstillinger |
| **Kontor** | «Dashbord» | Dashbord, Oppdrag, Kalender, Kunder, Meldinger, Rapporter | Bookinger, Avtaler, Enheter, Søk, HMS, Dokumenter, Kart, Nytt oppdrag, Varsler, Tilbud, Faktura, Lager, Utlegg, Lønnsomhet, Innstillinger |
| **Montør** | «I dag» | I dag, Oppdrag, Kalender, Kunder, Meldinger | Rapporter, Bookinger, Avtaler, Enheter, Søk, HMS, Dokumenter, Kart, Nytt oppdrag, Varsler, Kunder & utstyr, Innstillinger |
| **Kundeportalbruker** | «Kundeportal» | Oversikt, Bestillinger, Rapporter, Dokumenter, Utstyr, Avtaler, Besøk, Meldinger, Kontakt | Konto & sikkerhet |

På mobil viser bunnlinjen «Dashbord», «Oppdrag» og «Kalender» for kontor og administrator, og «I dag», «Oppdrag» og «Varsler» for montør. «Mer» åpner resten.

### Hvor finner jeg …?

| Du leter etter | Gå til |
| --- | --- |
| Dagens arbeid og forfalte oppdrag | «Dashbord» for kontoret, «I dag» for montøren |
| Planlegge eller flytte en visitt | «Kalender» eller oppdragets visittseksjon |
| Fordele montører raskt | «Dashbord» → tavle, «Kalender» → Dispatch, eller «Tildel montør» |
| Kunder, kontakter og portalbrukere | «Kunder» → kundekortet |
| Utstyr og servicehistorikk | «Enheter» eller kundekortet → «Utstyr» |
| Serviceavtaler og neste service | «Avtaler» eller kundekortet → «Avtaler» |
| Bookinger fra kundeportalen | «Bookinger» |
| Rapporter og PDF-er | «Rapporter», eller oppdraget → «Sjekklister» |
| Sjekklister og HMS-maler | «Innstillinger» → «Sjekklister / Maler», eller «HMS» |
| Dokumenter, mapper og tags | «Dokumenter» |
| Varsler og varselinnstillinger | Bjellen øverst, eller «Varsler» → «Innstillinger» |
| Aktivitetslogg | Oppdraget → «Aktivitetslogg», eller «Innstillinger» → «Aktivitetslogg» (administrator) |
| Ansatte, roller og rettigheter | «Innstillinger» → «Ansatte & Roller» eller «Roller & rettigheter» |
| API-nøkler | «Innstillinger» → «API-nøkler» (administrator) |
| Tilbud og godkjenningslenker | «Tilbud» |
| Fakturaer, betalinger og kreditnotaer | «Faktura» |
| Reservedeler, beholdning og innkjøp | «Lager» |
| Kjøreturer og utlegg til godkjenning | «Utlegg» → «Kontor» |
| Omsetning, tid og lønnsomhet | «Lønnsomhet» |
| Automatisk e-post og push | «Innstillinger» → «Automatisk e-post» / «Pushvarsler» |
| Alt på tvers av kunder og oppdrag | «Søk» |

## Slik bruker du manualen

Manualen har en introduksjonsdel, tre rollekapitler, et kapittel om SSO og SCIM, et kapittel om tilbud, fakturering og regnskap og en oppslagsdel. Start med rollen din, og bruk oppslagsdelen når du trenger et begrep, en status eller en feilsøkingssjekk.

- **Rollekapitler:** del 1 for kontor, del 2 for montør og del 3 for administrator. Kundeportalen er beskrevet sammen med kundekortet og rollene som administrerer den.
- **Fagkapitler:** [SSO og SCIM](31-sso-scim.md) og [tilbud, fakturering og regnskap](40-tilbud-faktura.md) går på tvers av rollene.
- **Oppslag:** oppslagsdelen har statusordbok, rettighetsmatrise, begreper og feilsøking.

### Konvensjoner

- Knapper, faner, menyelementer og feltnavn står i «anførselstegn», slik de vises i grensesnittet.
- Stier, filnavn, koder og tekniske verdier står i `monospace`.
- Menyvalg vises som **Innstillinger → API-nøkler**.
- **Merk** forklarer noe som er lett å misforstå. **Tips** er en snarvei eller et godt råd. **Advarsel** betyr at handlingen kan føre til datatap eller feil.
- Datoer og klokkeslett vises i Europe/Oslo med 24-timers klokke. Mangler en tid eller dato, viser systemet «Tid ikke satt» eller «Ingen dato»; det betyr ikke at verdien er midnatt.
- Rapport-PDF-er har norske etiketter i 0.9.4, også når grensesnittet er engelsk. Avtale-PDF kan genereres på valgt språk.

> **Advarsel:** En innsendt og låst rapport skal ikke endres uten en god grunn. Opplåsing krever administrator og begrunnelse, og alle endringer havner i aktivitetsloggen.

Ved første innlogging kommer du til hjemflaten for rollen din. Kontroller avdeling, varselinnstillinger og eventuell 2FA. Montører bør installere feltflaten som app, slik at kladder og siste data er tilgjengelig også med ustabilt nett.
