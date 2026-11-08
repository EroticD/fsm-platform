# Personvern: sletting og anonymisering av kundedata (DATA-01)

Dette er driftsrutinen for GDPR-sletting av en kunde. Funksjonen ligger på
kundekortet under **Personvern / Slett kundedata** og er bare tilgjengelig for
en aktiv administrator. Den anonymiserer direkte identifikatorer og beholder
tjenestehistorikk, bevaringsplikt og revisjonslogg.

## Forutsetninger

1. Ta backup av database og opplastingsvolum. Ta en restore-test dersom
   hendelsen er uvanlig eller datamengden er stor.
2. Avklar med DPO at forespørselen gjelder sletting, og om noen poster er
   omfattet av bevaringsplikt eller lovpålagt arkivering.
3. Kontroller at ingen oppdrag, rapporter eller revisjonslogger har aktiv
   bevaringsplikt. Se etter **Legal hold** på oppdrag/rapport og **AuditHold**
   i **Innstillinger → Revisjonslogg**.
4. Bruk en grunn som ikke inneholder personopplysninger. Tjenesten fjerner
   kjente identifikatorer fra grunnen før den lagres, men skriv kort og nøytralt.

## Retensjonsmatrise

| Data | Behandling | Begrunnelse |
| --- | --- | --- |
| Kundenavn, kundenummer, org.nr, adresse, e-post, telefon, notater, logo, merkevarefarge, ansvarlig montør | Slettes / nullstilles | Direkte identifikatorer uten eget retensjonsgrunnlag. |
| Kontaktnavn, e-post, telefon, rolle | Navn erstattes med nøytralt navn; e-post/telefon slettes | Kontaktrelasjonen og id-en beholdes for historikk. |
| Portalbrukere | Deaktiveres, e-post/navn/passord/2FA/økter fjernes | Skal ikke kunne logge inn etter sletting. Raden beholdes for relasjoner. |
| PortalDelegation | `isActive = false` og alle rettigheter av | Stenger portalen selv om en gammel invitasjon finnes. |
| Kundesteder | Nøytralt navn; adresse, postnummer, by og koordinater slettes | Beholder id og kobling til oppdrag/utstyr. |
| Oppdrag | Adresse, kontakt-/skapernavn, ordrenummer og kjente identifikatorer i tittel/beskrivelse fjernes | Tekniske data, datoer, status, referanse og relasjoner bevares. |
| Rapporter og revisjoner | Kundenavn, kundesignatur, kvitteringsnavn og kjente identifikatorer i JSON/fritekst fjernes | Svar, sjekklister, avvik og revisjoner er tjenestebevis. |
| Rapportenheter | Kjente identifikatorer i label/plassering/kommentar/svar fjernes | Serienummer og tekniske svar bevares. |
| Signerte rapport-PDF-er | **Bevares uendret** | Tjenestebevis. PDF-en kan fortsatt inneholde opprinnelige data; tilgang er begrenset til ansatte med rapporttilgang. |
| Teknikersignatur og rapportbilder | Bevares | Tjenestebevis og intern attribusjon; ikke kundens direkte identifikator. |
| Kundens egne vedlegg (`CustomerAttachment`) | Slettes med fil | Ikke lovpålagt tjenestehistorikk. |
| Oppdragsvedlegg (`Attachment`) | Slettes med fil | Ikke signert tjenestebevis; kan inneholde fritekst/PII. |
| Dokumentbibliotek og dokumentversjoner | Slettes med filer og uttrukket tekst | Kunden kan be om ny kopi fra kilden; ikke nødvendig for oppdragshistorikken. |
| Opplastingsmetadata | `originalName` settes til «anonymisert fil» for filer som bevares | Hindrer identifikatorer i filnavn. |
| Kommentarer, meldinger, SMS, bestillinger, avtaler, vedlikeholdsplaner | Kjente identifikatorer og telefon-/adresselenker fjernes | Teknisk og operativ historikk bevares. |
| Revisjonslogg (`AuditLog`, `AuditHold`, `AuditPurgedHash`) | **Endres aldri** | Hash-kjeden og bevaringsplikten skal være uforanderlig. Slettingen skriver én ny rad. |
| Backuper | Slettes ikke av denne tjenesten | Følg egen backup-retensjon og dokumenter det i personvernerklæringen. |

## Slik kjøres det

1. Åpne kundekortet → **Mer** → **Personvern / Slett kundedata**, eller knappen
   **Personvern** øverst på kundekortet.
2. Les forhåndsvisningen. Den viser antall rader som berøres og eventuelle
   blokkeringer. Ingenting skrives i forhåndsvisningen.
3. Løs blokkeringer:
   - **Oppdrag med legal hold:** opphev bevaringsplikten på oppdraget.
   - **Rapport med legal hold:** opphev rapportens eget flagg.
   - **AuditHold:** opphev holdet i **Innstillinger → Revisjonslogg**.
4. Skriv grunn og bekreft med kundens nåværende navn. Navnet må stemme nøyaktig.
5. Trykk **Anonymiser kundedata**. Operasjonen er irreversibel.

Tjenesten krever aktiv `ADMIN` og `customers.manage`, og reautoriserer på
serveren. Den kjører hele databaseskrivingen i én transaksjon. Blokkeringer
kontrolleres på nytt i transaksjonen, så en samtidig legal hold gir ingen
delvise skrivinger. Filer ryddes etter commit; en fil som ikke kan slettes
telles og logges uten å rulle tilbake databasesaneringen.

En ny kjøring på en allerede anonymisert kunde er en no-op. Den skriver ingen
ny revisjonsrad og returnerer `alreadyAnonymised: true`.

## Bevis og oppfølging

Etter kjøringen finnes en revisjonsrad på `Customer` med handlingen
«Anonymiserte kundens direkte identifikatorer (personvernsletting)». Metadata
inneholder:

- `operation: "customer_erasure"`
- en renset `reason` (kjente identifikatorer erstattes med `[fjernet]`)
- antall berørte rader per type
- antall rapport-PDF-er som er beholdt som bevis
- antall filer planlagt slettet og kundesignaturer fjernet

Revisjonsraden inneholder ikke kundenavn, e-post, telefon eller org.nr.
Bruk **Innstillinger → Revisjonslogg** eller revisjonseksporten for å hente
bevis. Ved en tvist bør du også ta vare på kvitteringen for selve
personvernforespørselen utenfor systemet; den skal ikke inneholde mer
personinformasjon enn nødvendig.

## Kjente begrensninger

- Signerte rapport-PDF-er og rapportbilder bevares uendret som tjenestebevis.
  PDF-cachen fortsetter å bli servert uendret selv om rapportens strukturerte
  felt er redigert; den regenereres bare hvis selve filen mangler. PDF-en kan
  derfor fortsatt inneholde kundens navn, adresse og signatur. Dette er et
  bevisst retensjonsvalg, ikke en feil. Tilgangen styres av rapporttilgang og
  oppdragsavdeling.
- Revisjonsloggen inneholder historiske hendelser med opprinnelige data. Den
  kan ikke endres uten å bryte hash-kjeden, og den er derfor unntatt sletting.
- Backuper og eventuelle eksterne arkiv må håndteres etter egen retensjon.
- Filer som ligger på disken uten `Upload`-metadata kan ikke alltid ryddes
  automatisk. Tjenesten forsøker å slette dem, men en administrator bør
  kontrollere opplastingsvolumet etter store slettinger.
