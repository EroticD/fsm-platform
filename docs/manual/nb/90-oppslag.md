# Oppslag, begreper og feilsøking

*Gjelder FSM-plattformen versjon 0.9.2, 8. november 2026.*

Dette kapitlet forklarer rettigheter, statuser og begreper på tvers av rollene, viser hvordan funksjonene henger sammen, og hjelper deg å finne hvor du skal lete når noe mangler.

## Roller og rettigheter i praksis

**Full** betyr se, opprette, endre og administrere. **Egen avdeling** betyr at rollen handler i sin egen avdeling der området er avdelingssperret. **Egen kunde** betyr at portalbrukeren bare ser sin egen kunde. **Nei** betyr at området ikke er tilgjengelig.

| Område | Administrator | Kontor | Montør | Kundeportalbruker |
| --- | --- | --- | --- | --- |
| **Oppdrag og visiter** | Full, alle avdelinger | Se, opprette, redigere, tildele og endre status i egen avdeling | Se egen avdeling, opprette egne oppdrag, ta ledige oppdrag, endre status og legge til/fjerne personer | Se egne besøk |
| **Kunder og kontakter** | Full | Administrere; kunder er felles | Se | Se egen kunde og kontakter |
| **Utstyr og målinger** | Full | Administrere; utstyr er felles | Se | Se eget utstyr hvis delegert |
| **Serviceavtaler** | Full | Se og administrere i egen avdeling | Se i egen avdeling | Se egne avtaler hvis delegert |
| **Administrere SLA og åpningstider** | Full | Nei | Nei | Nei |
| **Bookinger** | Full | Bekrefte, flytte og avlyse i egen avdeling | Se i egen avdeling | Bestille og avlyse egne hvis delegert |
| **Rapporter og sjekklister** | Full, inkludert opplåsing og bevaringsplikt | Se og fylle ut i egen avdeling; administrere maler | Se og fylle ut rapporter i egen avdeling | Se innsendte rapporter og kvittere hvis dokumenttilgang |
| **Dokumenter** | Full | Administrere; dokumenter er felles | Se | Se egne delte dokumenter hvis delegert |
| **Ansatte og roller** | Full | Administrere brukere i egen avdeling; kan tildele roller hvis rettigheter er en delmengde av egne, aldri **Administrator**; rolldefinisjoner og avdelingsbytte er administrator | Nei | Nei |
| **Innstillinger og merkevare** | Full | Administrere merkevare, kart, maler og dispatch; avdelinger, roller og API er administrator | Nei | Nei |
| **Aktivitetslogg** | Global | Per oppdrag og kunde | Per oppdrag | Nei |
| **Tilbud og faktura** | Full | Se og administrere i egen avdeling; sende, betale og kreditere | Nei | Se egne fakturaer og betale |
| **Betaling og regnskapssynk** | Full | Opprette betalingslenke og synkronisere faktura | Nei | Se og betale egen faktura |
| **Lager og innkjøp** | Full, alle avdelinger | Se og administrere i egen avdeling; reservere og forbruke | Se og reservere/forbruke hvis gitt | Nei |
| **Kjøretur og utlegg** | Full | Godkjenne og eksportere i egen avdeling | Registrere egne | Nei |
| **Lønnsomhet** | Full | Se egen avdeling | Nei | Nei |
| **API-nøkler** | Full | Nei | Nei | Nei |
| **Sletting, gjenoppretting, opplåsing og bevaringsplikt** | Full | Nei | Nei | Nei |

> **Merk:** Administrator kan lage egne roller og gi enkeltbrukere tilpassede rettigheter. Sjekk brukerens faktiske rettigheter i «Innstillinger» → «Ansatte & Roller» hvis noe ser feil ut.

Sletting er bevisst ikke en vanlig rettighet. Administrator kan slette kunder, filer og andre registreringer. Oppdrag kan slettes av administrator, eller av en egendefinert rolle som uttrykkelig har fått `workorders.delete`, og bare mens oppdraget er åpent (ikke fullført eller kansellert). Rapporter og vedlegg beholdes ved myk sletting. Mange slettinger er myke og kan gjenopprettes.

## Statusordbok

### Oppdragsstatus

| Status | Vises som | Betydning |
| --- | --- | --- |
| `OPEN` | Åpen / Ny | Opprettet, men ikke planlagt. Brukes for kundens datoforespørsel før kontoret planlegger den. |
| `PENDING` | Venter på planlegging | Startstatus for nye og klonede oppdrag. Skal ikke velges manuelt. |
| `PLANNED` | Planlagt | Har dato eller visitt og er klar for tildeling eller utførelse. |
| `WAITING` | Venter på kunde | Arbeidet står i bero på kunden, tilgang eller avklaring. |
| `IN_PROGRESS` | Påbegynt | Arbeidet er startet. |
| `COMPLETED` | Fullført | Avsluttet og regnes som historikk. |
| `CANCELLED` | Kansellert | Avsluttet uten å bli utført. |

Åpne statuser kan byttes fritt, også til `COMPLETED` eller `CANCELLED`. `COMPLETED` og `CANCELLED` er lukkede; bare administrator kan gjenåpne med begrunnelse.

### Visittstatus

| Status | Vises som | Betydning |
| --- | --- | --- |
| `PLANNED` | Planlagt | Planlagt, men ingen montør er tildelt. |
| `ASSIGNED` | Tildelt | Minst én montør er tildelt, men arbeidet er ikke startet. |
| `EN_ROUTE` | På vei | Montøren har startet kjøringen. Registrerer første respons i en eventuell SLA. |
| `ON_SITE` | På stedet | Montøren er framme og arbeider på stedet. |
| `DONE` | Fullført | Visitten er avsluttet. Sporingslenker tilbakekalles. |
| `CANCELLED` | Kansellert | Avlyst før fullføring. |

Flyten er `PLANNED → ASSIGNED → EN_ROUTE → ON_SITE → DONE`. `CANCELLED` kan brukes før visitten er fullført. `DONE` og `CANCELLED` er lukkede.

### Rapport, enhet og kvittering

| Begrep | Betydning |
| --- | --- |
| **Kladd** | Utfylte felt lagret lokalt eller som `ReportDraft`, men ikke sendt inn. Vises ikke for kunden. |
| **Innsendt og låst** | Skjemaet er sendt inn. Rapporten er låst, har PDF og revisjon og kan ikke endres uten administrator. |
| **Åpen for retting** | Administrator har låst opp med begrunnelse. Endringer lagres som ny revisjon, og rapporten låses automatisk igjen. |
| **Kvittert** | Kunden har bekreftet mottak. Kvitteringen kan trekkes tilbake ved ny innsending eller opplåsing. |
| **Revisjon** | Uforanderlig øyeblikksbilde før en endring. Bevarer navn, enheter, svar, signaturer og kvittering. |

| Enhetsresultat | Vises som | Betydning |
| --- | --- | --- |
| `GODKJENT` | Godkjent / utført | Enheten er kontrollert og i orden. |
| `AVVIK` | Avvik funnet | Enheten har et avvik som krever oppfølging. |
| Ikke vurdert | Ikke vurdert | Enheten mangler resultat. Rapporten kan ikke sendes før alle enheter er vurdert. |

Samlet resultat utledes fra enhetene: minst ett avvik gir avvik, alle godkjent gir godkjent, ellers «ikke vurdert». Ved avvik opprettes ett automatisk utbedringsoppdrag.

### Serviceavtale og SLA

| Avtalestatus | Vises som | Betydning |
| --- | --- | --- |
| `DRAFT` | Utkast | Under oppsett; genererer ikke oppdrag. |
| `ACTIVE` | Aktiv | Gyldig og kan generere oppdrag når neste service forfaller. |
| `PAUSED` | Pauset | Satt på pause; genererer ikke oppdrag. |
| `EXPIRED` | Utløpt | Passert sluttdato uten fornyelse. |
| `TERMINATED` | Avsluttet | Avsluttet før planlagt slutt. |

Fornyelse er `AUTO` (automatisk) eller `MANUAL` (kontoret fornyer). `Neste service` er datoen systemet bruker for å avgjøre om et nytt oppdrag skal lages.

| SLA-status | Vises som | Betydning |
| --- | --- | --- |
| `ON_TRACK` | I rute | Både svar- og løsningsfrist er innenfor. |
| `AT_RISK` | I fare | Fristen nærmer seg; varsel sendes ved overgangen. |
| `BREACHED` | Brutt | Fristen er passert; varsel sendes ved overgangen. |
| `MET` | Oppfylt | Respons og løsning er registrert innenfor fristen. |
| `CANCELLED` | Kansellert | Oppdraget ble kansellert, og klokken er avsluttet. |

SLA-frister regnes med avdelingens åpningstider og helligdager. Første «På vei» eller «På stedet» registrerer respons; «Ferdig» registrerer løsning, og «Avslutt kjøring» flytter ikke klokken. En SLA-klokke finnes bare når oppdraget har en aktiv, datogyldig avtale med en aktiv SLA-policy. Uten en slik avtale vises ingen SLA.

> **Merk:** Uten modulene `quotes` og `invoicing` beregner ikke systemet priser eller faktura, og prislister er referansedata. Er modulene på, beregnes tilbud, faktura, MVA, betaling og kreditnota på serveren.

### Bestillingsstatus

| Status | Vises som | Betydning |
| --- | --- | --- |
| `PENDING` | Venter | Ligger i kontorets bookingkø som en datoforespørsel. Tid og montør er ikke planlagt. |
| `CONFIRMED` | Bekreftet | Kontoret har planlagt tid og montør, og oppdrag og visitt er opprettet. |
| `CANCELLED` | Avlyst | Bestillingen er avlyst. |
| `EXPIRED` | Utløpt | En ventende forespørsel er utløpt uten bekreftelse. |

Nye bestillinger er alltid datoforespørsler: kunden velger dato, ikke tidsblokk, og kontoret planlegger tid og montør. Ingen ny bestilling blir `CONFIRMED` direkte. Alle ventende forespørsler kan bekreftes; eldre rader med et lagret tidsvindu kan bruke det, ellers oppgir kontoret dato, start og slutt. Overlappende visiter er en opptatt-markering, ikke en hard sperre. En kort reservasjon (`BookingHold`) brukes bare når en allerede bekreftet avtale flyttes. Hendelsesloggen bruker `CREATED`, `CONFIRMED`, `RESCHEDULED`, `CANCELLED` og `EXPIRED`.

### Tilbud, faktura og betaling

| Tilbudsstatus | Vises som | Betydning |
| --- | --- | --- |
| `DRAFT` | Kladd | Kan redigeres fritt |
| `SENT` | Sendt | Lenke er utstedt; linjene er fryst |
| `ACCEPTED` | Godkjent | Kunden har godtatt |
| `REJECTED` | Avslått | Kunden har avslått |
| `EXPIRED` | Utløpt | Gyldigheten er passert |

| Fakturastatus | Vises som | Betydning |
| --- | --- | --- |
| `DRAFT` | Kladd | Ikke sendt; kan redigeres |
| `SENT` | Sendt | Nummer tildelt; linjene er fryst |
| `PARTIALLY_PAID` | Delvis betalt | Utestående gjenstår |
| `PAID` | Betalt | Utestående er null |
| `OVERDUE` | Forfalt | Forfallsdato passert |
| `CREDITED` | Kreditert | Kreditnota er registrert |

| Betalingsstatus | Betyr |
| --- | --- |
| **Venter** | Lenke er opprettet, men betalingen er ikke bekreftet |
| **Betalt** | Webhooken har registrert betalingen |
| **Feilet** | Leverandøren avviste eller betalingen feilet |
| **Utløpt** | Lenken er utløpt uten betaling |

En betalingslenke kan bare brukes én gang og gjelder ett beløp. Refusjon skjer
med kreditnota, ikke fra betalingsleverandøren. Regnskapssynken har statusene
**Synkronisert**, **Eksportert** (CSV) og **Feilet**.

### Lager, innkjøp og utlegg

| Innkjøpsstatus | Vises som | Betydning |
| --- | --- | --- |
| `DRAFT` | Utkast | Kan redigeres |
| `ORDERED` | Bestilt | Ingen varer mottatt |
| `PARTIALLY_RECEIVED` | Delvis mottatt | Noe er på lager |
| `RECEIVED` | Mottatt | Alt er mottatt |
| `CANCELLED` | Avbestilt | Avbestilt før mottak |

Bevegelsene i lageret er `IN`, `OUT`, `ADJUST`, `RESERVE`, `RELEASE` og
`CONSUME`. En reservasjon reduserer tilgjengelig beholdning, men flytter ikke
varen før den forbrukes. Bare `ADJUST` kan gi negativ beholdning.

| Utleggsstatus | Vises som | Betydning |
| --- | --- | --- |
| `DRAFT` | Utkast | Ikke sendt til godkjenning |
| `PENDING` | Venter | Sendt inn, ikke behandlet |
| `APPROVED` | Godkjent | Kan eksporteres |
| `REJECTED` | Avvist | Krever begrunnelse; eksporteres ikke |
| `EXPORTED` | Eksportert | Låst i en lønns-CSV |

### Varsler og aktivitetslogg

Et varsel er en melding til én bruker om en hendelse. Det vises i bjellen og på «Varsler», og kan også sendes på e-post. Brukeren velger selv hvilke typer som skal vises i appen og på e-post.

| Varselstype | Typisk mottaker | Utløses av |
| --- | --- | --- |
| `ASSIGNMENT` | Montøren | Oppdraget blir tildelt |
| `DATE_CHANGED` | Montøren | Oppdragets dato endres |
| `CANCELLED` | Montøren | Oppdraget kanselleres |
| `REPORT_READY` | Montør, kontor og kundeportal | Rapporten er innsendt og klar |
| `BOOKING` | Kontoret og tildelt montør | Ny eller bekreftet booking |
| `CONTRACT_DUE` | Kontoret | Serviceavtalen forfaller |
| `OVERDUE` | Montør og kontor | Oppdraget er forfalt |
| `CONTACT_UPDATE` | Kontoret | Kunden ber om oppdatert kontaktinformasjon |
| `SLA_AT_RISK` / `SLA_BREACHED` | Montør og kontor | SLA-fristen nærmer seg eller er brutt |
| `WARRANTY` | Kontoret | Garantien på utstyr er i ferd med å utløpe |
| `MESSAGE` | Kontor eller kunde | Ny melding i en samtale |
| `INVOICE_PAID` | Kontor og kunde | Fakturaen er betalt |

Aktivitetsloggen er en varig, ikke-redigerbar historikk over hvem som opprettet, endret, flyttet, kansellerte, slettet, låste opp eller slo på bevaringsplikt, med tidspunkt og metadata. Du finner den på oppdraget, på kundekortet og i «Innstillinger» → «Aktivitetslogg» for administrator.

## Hvordan funksjonene spiller sammen

> **Merk:** `WorkOrder`, `VisitTechnician`, `BookingRequest` og
> `MaintenancePlanOccurrence` er interne modellnavn. I grensesnittet heter de
> oppdrag, montørtildeling, bestilling og vedlikeholdsforekomst.

| Handling | Data som opprettes eller oppdateres | Hvem ser det |
| --- | --- | --- |
| Kunden sender en datoforespørsel | `BookingRequest(PENDING)`, `WorkOrder(OPEN)`, bookinghendelse, `BOOKING` | Kontor i «Bookinger» |
| Kontoret bekrefter en ventende forespørsel | `BookingRequest(CONFIRMED)`, `WorkOrder(PLANNED)`, `Visit(PLANNED)`, eventuell SMS | Kunde, kontor, montør |
| Kunden flytter en bekreftet avtale | Nytt tidsvindu, `Visit(PLANNED)`, `RESCHEDULED`; kort `BookingHold` bare i denne flyten | Kunde, kontor, montør |
| Kontoret oppretter et oppdrag | `WorkOrder(PENDING)`, `Visit(PLANNED)` hvis dato, aktivitetslogg | Kontor, kalender |
| Kontoret tildeler en montør | `VisitTechnician`, montørliste, `ASSIGNMENT`, aktivitetslogg | Montør, kontor |
| Montøren starter kjøring | `Visit(EN_ROUTE)`, `enRouteAt`, SLA-respons, sporing | Kontor, kunde |
| Montøren markerer «På stedet» | `Visit(ON_SITE)`, `onSiteAt` | Kontor, kunde |
| Montøren fullfører visitten | `Visit(DONE)`, `doneAt`, sporing tilbakekalles | Kontor, kunde |
| Montøren sender inn rapporten | `Report` låses, revisjon 0, PDF, enheter, utstyrs historikk, `REPORT_READY`, eventuelt utbedringsoppdrag | Kontor, kunde, utstyrshistorikk |
| Kunden kvitterer | `customerAcknowledgedAt`, kvitteringstekst | Kontor, rapporten |
| Serviceavtalen forfaller | `WorkOrder(PLANNED)`, `Visit`, forrige rapport som PDF, `CONTRACT_DUE` | Kontor, kalender |
| En måling passerer terskelen | `MaintenancePlanOccurrence`, nytt vedlikeholdsoppdrag | Kontor, kunde |
| Et dokument lastes opp | `Document`, `Upload`, OCR-jobb, søkeindeks | Ansatte med dokumenttilgang |
| Rolle eller rettigheter endres | `User.sessionVersion` økes, API-nøkler arver nye rettigheter | Brukeren, administrator |
| Tilbud sendes | `Quote(SENT)`, versjon, engangstoken, `EmailMessage` | Kunde, kontor |
| Kunden godkjenner tilbud | `Quote(ACCEPTED)`, revisjonsrad | Kontor, kunde |
| Tilbud konverteres | `WorkOrder`, kundekobling, utstyr | Kontor, kalender |
| Faktura sendes | `Invoice(SENT)`, nummer, frosne linjer, `EmailMessage` | Kunde, kontor |
| Betaling mottas | `Payment`, `Invoice.paidTotal`, status, revisjonsrad | Kontor, kunde |
| Betalingslenke opprettes | `Payment`-metadata, ekstern id, revisjonsrad | Kunde, kontor |
| Faktura synkroniseres | `AccountingSync`, ekstern id, status | Kontor, regnskap |
| Vare reserveres | `InventoryReservation`, `StockMovement(RESERVE)` | Lager, montør |
| Vare forbrukes | `StockMovement(CONSUME)`, redusert beholdning | Lager, montør |
| Innkjøpsordre mottas | `PurchaseOrder`, `PurchaseOrderLine`, `StockMovement(IN)` | Lager, kontor |
| Utlegg godkjennes | `Expense`/`MileageTrip`, godkjenner, revisjonsrad | Kontor, montør |
| Lønns-CSV eksporteres | `PayrollExport`, låste linjer, kontrollsum | Kontor, lønn |

## Vanlige problemer på tvers av roller

| Problem | Sjekk først | Hvor du ser det |
| --- | --- | --- |
| **Kundeportalbrukeren kommer ikke inn, eller ser ikke data** | Er brukeren aktiv og koblet til en kontakt som tilhører riktig kunde? Er delegasjonen aktiv med riktige deltilganger? Er invitasjonen fullført og passordet satt? | «Kunder» → kundekortet → **Mer → Portalbrukere**; «Innstillinger» → «Ansatte & Roller» |
| **Kunden ser ikke dokumenter, avtaler eller utstyr** | Har kontakten `canViewDocuments`, `canViewContracts` eller `canViewEquipment`? Er dokumentet eid av kunden og delt? Ligger avtalen i riktig avdeling? | Kundekortet → **Mer → Portalbrukere** og portalens faner «Dokumenter», «Avtaler», «Utstyr» |
| **Oppdraget mangler i kalenderen** | Har oppdraget dato og visitt? Udaterte oppdrag har ingen visitt. Er visitten kansellert eller fullført? Ligger datoen utenfor ±6-månedersvinduet? Skjuler et filter det? | «Oppdrag» → visittseksjonen; «Kalender»; «Dispatch» |
| **Rapporten vises ikke** | Er skjemaet sendt inn, eller ligger det bare som kladd? Er rapporten låst og innsendt? Passer dato, kunde og avdelingsfilter? Er PDF-en generert? | «Oppdrag» → «Sjekklister»; «Rapporter»; kundeportalen → «Rapporter» |
| **Serviceavtalen lager ikke nytt oppdrag** | Er avtalen `ACTIVE`, ikke `PAUSED` eller `EXPIRED`? Er `Neste service` forfalt? Er sluttdatoen passert? Er kunden slettet? Er oppdraget allerede generert? Kjører den planlagte jobben? | «Avtaler» → avtalen; kundekortet; driftsloggen for gjentagende jobber |
| **Varselet kommer ikke** | Er typen slått på for appen eller e-post? Er brukeren aktiv og faktisk mottaker? Er e-posten i søppelpost? Er varselet duplisert og filtrert? Er e-postkøen tømt? | «Varsler» → «Innstillinger»; «Varsler»; driftsloggen for e-post |
| **Offline-kladden synkroniseres ikke** | Er du på samme enhet, i samme nettleser og som samme bruker? Er appen åpnet på nytt med nett? Ligger kladden i utboksen? Er den eldre enn sju dager, for stor, eller avvist fordi rapporten er låst? | Feltflaten → offline-banner og kladdeliste; nettleserens lagring |
| **Montøren ser ikke oppdraget** | Er oppdraget i montørens avdeling? Er det tildelt, eller står det som ledig? Er det fullført eller kansellert? Er datoen riktig? Har montøren «Ta oppdraget»-tilgang? | «I dag»; «Oppdrag»; «Kalender» |
| **En handling er avvist med «ikke tilgang»** | Har brukeren riktig rolle og rettighet? Er brukeren i riktig avdeling? Er kontoen aktiv? Er oppdraget låst eller under bevaringsplikt? | «Innstillinger» → «Ansatte & Roller»; oppdragets aktivitetslogg |
| **Steder eller enheter fra feil kunde vises** | Feil kunde er valgt, eller siden ble ikke lastet på nytt etter kundebytte | Bytt kunde på nytt, last siden på nytt, og kontroller at valget er lagret |
| **Enhet kan ikke flyttes** | Aktive kontraktslinjer, nummerkonflikt, krysskundereferanse eller ugyldig målkunde | Les blokkeringen i forhåndsvisningen, rydd avtalelinjen eller velg riktig kunde/sted |
| **Opplasting avvises** | For stor fil, bruker-/kundekvote nådd, eller proxygrense | Sjekk filstørrelse, `UPLOAD_QUOTA_*`, disk og proxyens body-grense |
| **Kundeoverføring starter ikke** | 10 starter per time er brukt opp, en pågående jobb gjenbrukes, eller forhåndsvisningen er utløpt | Vent, følg den eksisterende jobben, eller last opp og forhåndsvis pakken på nytt |
| **Tilbuds- eller fakturasiden gir 404** | Modulen `quotes`/`invoicing` er av | Slå på modulen under **Innstillinger → Moduler** |
| **Betalingsknappen vises ikke** | Leverandør eller webhook-hemmelighet mangler, eller beløpet er betalt | Kontroller `PAYMENTS_PROVIDER` og nøklene, og lag ny lenke |
| **Betalingen blir ikke bokført** | Webhook avvist, eller valuta/beløp avviker | Kontroller signatur og revisjonslogg; avstem manuelt |
| **Regnskapssynken feiler** | Feil nøkkel, konto eller MVA-oppsett | Les `lastError`, rett årsaken og synkroniser på nytt |
| **Beholdningen stemmer ikke** | Reservasjon ikke forbrukt, eller justering mangler | Se bevegelser og reservasjoner på varen |
| **Utlegg kan ikke eksporteres** | Perioden overlapper, eller raden er ikke godkjent | Velg ny periode og godkjenn raden |
| **E-post blir liggende** | SMTP mangler, eller hendelsen er av | Kontroller `SMTP_*` og **Automatisk e-post** |
| **Push kommer ikke** | Enheten er avregistrert, varsler avslått, eller leverandøren er ikke konfigurert | Registrer enheten på nytt og kontroller FCM/APNs |

### Kundeportal: tilgang er mer enn innlogging

En portalbruker er alltid koblet til en kontaktperson hos en kunde. Kontakten kan ha en delegasjon med egne valg for bestilling, dokumenter, avtaler og utstyr. En inaktiv delegasjon stenger portalen helt. En kontakt uten delegasjonsrad har full portaltilgang for bakoverkompatibilitet. Kontroller at brukeren er aktiv og har riktig kunde, at kontakten tilhører samme kunde, at delegasjonen er aktiv, og at deltilgangen for området som mangler, er slått på.

> **Merk:** I 0.9.2 finnes det ikke eget skjema i grensesnittet for å redigere delegasjonen. Begrenset portaltilgang må settes opp og testes med den aktuelle kontoen.

### Kalender, rapporter og avtaler

Kalenderen viser visiter, ikke oppdrag i seg selv. Et oppdrag uten dato har ingen visitt. Kalenderen henter et begrenset vindu, og listen kan være avkortet. Mangler et oppdrag, skyldes det nesten alltid at det er udatert, at visiten er slettet, kansellert eller fullført, at datoen ligger utenfor vinduet, at et filter skjuler det, eller at det tilhører en annen avdeling.

En rapport blir ikke synlig for kunden bare fordi montøren har begynt å fylle den ut. Rekkefølgen er kladd → send inn → serveren låser og lager PDF → rapporten blir tilgjengelig i «Rapporter» og kundeportalen → kunden kan kvittere. En kladd som bare ligger lokalt, er ikke en rapport.

En serviceavtale genererer ikke oppdrag bare fordi den finnes. Den må være `ACTIVE`, `Neste service` må være forfalt, og avtalen må ikke være passert sluttdatoen. Systemet lager heller ikke et nytt oppdrag for samme avtale og dato to ganger.

### Varsler og offline

Varsler er både in-app og e-post. At et varsel mangler i innboksen, betyr ikke at det ikke ble laget. Sjekk om brukeren har slått av typen, om brukeren er aktiv og faktisk mottaker, om varselet ligger i «Varsler» uten e-post, om e-posten er forsinket eller i søppelpost, og om samme hendelse allerede er varslet.

Feltflaten lagrer kladder lokalt når nettet forsvinner. Kladden sendes når appen er åpen og nettet er tilbake. Den kan ikke sendes hvis rapporten er låst eller under bevaringsplikt, hvis kladden er eldre enn sju dager eller større enn grensen, hvis enheten har mistet lagringen, eller hvis en annen bruker eller nettleser åpner appen. Innsending krever nett; signering er valgfri.

## Begreper norsk/engelsk

| Norsk | English | Betydning |
| --- | --- | --- |
| Avdeling | Department | Organisatorisk enhet som avgrenser tilgang |
| Oppdrag | Work order | Servicejobben som planlegges og følges opp |
| Visitt | Visit | Tidsblokk i et oppdrag, med montører |
| Montør | Technician | Den som utfører arbeidet i felt |
| Kontor | Office | Planleggings- og administrasjonsrollen |
| Kunde | Customer | Firmaet som mottar service |
| Kontaktperson | Contact | Personen hos kunden |
| Sted | Site | Fysisk adresse eller anlegg |
| Utstyr / enhet | Equipment / unit | Maskinen eller systemet som serviceres |
| Rapportenhet | Report unit | Enheten slik den inngår i en rapport |
| Sjekkliste | Checklist | Punktene som kontrolleres |
| Mal | Template | Gjenbrukbar sjekkliste eller HMS-skjema |
| Rapport | Report | Utfylt og innsendt sjekkliste |
| Avvik | Deviation | Funn som krever oppfølging |
| Godkjent | Approved | Enheten er kontrollert og i orden |
| Revisjon | Revision | Uforanderlig øyeblikksbilde før en endring |
| Kvittering | Acknowledgement | Kundens bekreftelse på mottatt rapport |
| Låst | Locked | Kan ikke endres uten administrator |
| Serviceavtale | Service contract | Avtale om gjentagende service |
| Fornyelse | Renewal | Automatisk eller manuell forlengelse |
| SLA | Service level agreement | Avtalt respons- og løsningstid |
| Åpningstider | Business hours | Tidsrommene SLA-frister regnes innenfor |
| Bestilling | Booking | Kundens forespørsel eller bekreftede time |
| Ledig time | Available slot | Foreslått tid i slotvelgeren; brukes bare ved flytting av en bekreftet avtale, ikke ved nye bestillinger |
| Reservasjon | Hold | Kortvarig reservering av en ledig time i den eldre ombookingsflyten |
| Varsel | Notification | Melding om en hendelse |
| Aktivitetslogg | Audit log | Sporbar historikk over handlinger |
| Rettighet | Permission | Hva en rolle eller bruker kan gjøre |
| Bevaringsplikt | Legal hold | Fryser data mot sletting og endring |
| Dokumentbibliotek | Document library | Felles filområde med mapper og tags |
| HMS | HMS | Helse, miljø og sikkerhet; grensesnittet beholder den norske forkortelsen |
| Måler | Meter | Avlesning på utstyr, for eksempel driftstimer |
| Vedlikeholdsplan | Maintenance plan | Kalender- eller målerbasert vedlikehold |
| Sporing | Tracking | Midlertidig deling av status og ankomst |
| Omtale | Review | Intern kundetilbakemelding etter besøk |
| Kundeportal | Customer portal | Kundens egen flate |
| Kladd | Draft | Lokalt lagret, ikke innsendt skjema |
| Kundeadskillelse | Customer scoping | Steds- og enhetsvalg er begrenset til valgt kunde |
| Enhetsflytting | Equipment move | Flytting av enhet med servicehistorikk til ny kunde |
| Kundeoverføring | Customer transfer | Administratorens eksport/import av kundepakke |
| Kontorinnboks | Office inbox | Samlede SMS-samtaler for kontoret |
| Tilbud | Quote | Prisforslag med linjer, versjoner og godkjenning |
| Faktura | Invoice | Fakturert beløp med linjer, betaling og kreditnota |
| Kreditnota | Credit note | Reduksjon av utestående, aldri over utestående |
| Betalingslenke | Payment link | Engangslenke til Stripe Checkout eller Vipps |
| Regnskapssynk | Accounting sync | Manuell overføring av kunde, faktura og betaling |
| Lager | Inventory | Varer, beholdning og lokasjoner |
| Innkjøpsordre | Purchase order | Bestilling til leverandør med varemottak |
| Varemottak | Goods receipt | Registrering av mottatte varer mot en ordre |
| Reservasjon | Reservation | Del som er holdt av til et oppdrag |
| Forbruk | Consumption | Fysisk trekk av reservert vare |
| Kjøretur | Mileage trip | Kjøregodtgjørelse med kilometer og sats |
| Utlegg | Expense | Utgift med kvittering og MVA |
| Lønns-CSV | Payroll CSV | Låst eksport av godkjent tid, kjøretur og utlegg |
| Lønnsomhet | Profitability | Estimert og faktisk inntekt per avdeling, kunde og montør |
| Utboks | Outbox | Vedvarende kø for e-post og push |
| Pushvarsel | Push notification | Varsel til mobilen via FCM eller APNs |
| SAML | SAML | Føderert innlogging med signert assertion |
| SCIM-gruppe | SCIM group | Gruppe som gir rolle/avdeling via eksplisitt mapping |
| Feltmaskering | Field redaction | Server-side skjuling av sensitive felt |
| S3 | S3 | Objektlager for opplastinger |
| Redis | Redis | Varslingskanal og cache, med database som fallback |
| PITR | PITR | Gjenoppretting til et valgt tidspunkt |
| RPO/RTO | RPO/RTO | Maksimalt datatap og maksimal nedetid |

## Informasjon til support

Når du melder en feil, hjelper det å samle informasjonen under. Skriv kort hva du gjorde, hva du forventet, og hva som faktisk skjedde.

- **Versjon:** FSM-plattformen 0.9.2, og hvor du så feilen (kontorflate, feltflate, kundeportal, PDF eller API).
- **Tidspunkt:** Dato og klokkeslett med tidssone, helst Europe/Oslo.
- **Bruker:** E-post, rolle, avdeling og eventuell kunde. Oppgi aldri passord eller engangskoder.
- **Sak:** Oppdragsnummer eller -ID, tittel, kunde og dato. For rapport: rapportnummer eller -ID. For booking: referanse. For avtale: avtalenummer.
- **Miljø:** Nettleser og versjon, operativsystem, telefon eller PC, og om feltflaten er installert som app.
- **Nett:** Var du online eller offline? Skjedde det i en kladd, under innsending eller etter sending?
- **Feilmelding:** Gjengi teksten nøyaktig, og ta gjerne et skjermbilde som viser tidspunkt, bruker og feilmelding.
- **Reproduksjon:** Skriv stegene du tok, og om feilen skjer hver gang eller bare noen ganger.
- **Varsel:** Ved varselproblemer, oppgi type, mottaker, app eller e-post, og om varselet finnes i «Varsler».
- **API:** Oppgi nøkkelprefiks (aldri hele nøkkelen), endepunkt, tidspunkt, HTTP-status, `error.code` og eventuell `requestId`.
- **PDF og e-post:** Oppgi om det gjelder generering, visning, nedlasting eller utsending, og om det gjelder rapport eller avtale.
- **Offline:** Oppgi om kladden ligger i utboksen, om den er eldre enn sju dager, og om samme bruker og enhet ble brukt.
- **Betaling og regnskap:** Oppgi fakturanummer, leverandør, beløp, valuta og om feilen skjedde ved lenke, webhook eller synk. Aldri hele nøkler.
- **E-post og push:** Oppgi hendelsestype, mottaker, om det gjelder app eller e-post, og om raden står `PENDING`, `FAILED` eller `DEAD_LETTER`.

> **Advarsel:** Send aldri passord, engangskoder, hele API-nøkler eller fullstendige personopplysninger i en supportsak. Skjermbilder bør maskeres der det er mulig.
