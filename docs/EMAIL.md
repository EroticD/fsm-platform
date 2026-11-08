# Transaksjons-e-post og utboks

Automatisk e-post (tilbud, faktura, betaling og booking) sendes fra en
vedvarende utboks i databasen, ikke direkte fra request-stien. Da kan en treg
eller nede SMTP-server aldri rulle tilbake en faktura, et tilbud eller en
booking, og hver utsendelse har retry, historikk og idempotens.

## SMTP og miljøvariabler

E-post krever de samme SMTP-variablene som resten av appen:

```dotenv
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=no-reply@example.com
SMTP_PASS=...
APP_URL=https://fsm.example.com
```

- `SMTP_USER` og `SMTP_PASS` må begge være satt. Uten dem er utboksen en trygg
  no-op: meldingene blir liggende `PENDING` uten å telle som feilede forsøk.
- Port 587 bruker STARTTLS (`requireTLS`), port 465 bruker implicit TLS
  (`SMTP_SECURE=true`). Begge krever TLS 1.2 eller nyere.
- `APP_URL` (eller `NEXTAUTH_URL`) brukes til absolutte lenker i e-posten.
  Uten den faller lenkene tilbake til `http://localhost:3000`.
- Avsender og reply-to settes i **Innstillinger → Automatisk e-post**. Tom
  avsenderadresse bruker `SMTP_USER`; tomt avsendernavn bruker bedriftsnavnet
  fra merkevaren.

SMTP-hemmelighetene ligger bare i miljøet. De vises aldri i innstillingene og
lagres ikke i databasen.

## Utboksmodellen

`EmailMessage` er køen:

| Felt | Betydning |
| --- | --- |
| `to` | Mottaker. Vises aldri i logger. |
| `subject` | Emne ved siste rendering. |
| `template` | Hendelsesnøkkel, f.eks. `quoteSent`. |
| `payload` | Maldata (JSON). Tømmes etter vellykket sending. |
| `locale` | `nb`, `en`, `pl` eller `de`. |
| `status` | `PENDING`, `SENDING`, `SENT` eller `FAILED`. |
| `attempts` | Antall mislykkede sendeforsøk. |
| `nextAttemptAt` | Når neste forsøk kan kjøres. |
| `lastError` | Kort, PII-fri feilkode (f.eks. `ECONNECTION`). |
| `idempotencyKey` | Unik nøkkel per hendelse/mottaker. |
| `lockedAt` | Kort lease mens en worker sender. |
| `createdAt`, `sentAt` | Tidsstempler. |

`EmailSettings` er én rad (`id = "default"`) med avsendernavn, avsenderadresse,
reply-to og av/på per hendelsestype.

### Enqueue

`enqueueEmail` i `src/server/email-outbox.ts`:

1. Validerer og normaliserer mottakeren med `cleanEmail`.
2. Sjekker om hendelsen er slått av i `EmailSettings`.
3. Renderer emnet med merkevaren og lagrer raden.
4. Returnerer `duplicate` hvis `idempotencyKey` allerede finnes.

Unik indeks på `idempotencyKey` gjør dette trygt også når flere instanser
mottar samme hendelse samtidig. Et dobbeltklikk eller en gjentatt
bookingbekreftelse gir derfor aldri to e-poster.

### Claim og sending

Workeren henter én rad med:

```sql
UPDATE "EmailMessage"
SET "status" = 'SENDING', "lockedAt" = now()
WHERE "id" = (
  SELECT "id" FROM "EmailMessage"
  WHERE "status" = 'PENDING' AND "nextAttemptAt" <= now()
  ORDER BY "nextAttemptAt", "createdAt"
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING *
```

`FOR UPDATE SKIP LOCKED` gjør at flere app-instanser kan dele køen uten å
sende samme melding. Rader som blir stående i `SENDING` av en krasjet prosess
settes tilbake etter 15 minutter.

Sending bruker den eksisterende `createSmtpTransport()` fra `src/lib/email.ts`,
slik at TLS- og tidsavbruddsreglene er de samme som for resten av appen.

## Hendelser og triggere

| Hendelse | Utløses av | Mottaker | Lenke |
| --- | --- | --- | --- |
| `quoteSent` | `sendQuote` | Kundens kontaktperson/kunde | Absolutt godkjenningslenke `/tilbud/godkjenn/<token>` |
| `invoiceSent` | `sendInvoice` | Kundens kontaktperson/kunde | Kundeportalens fakturaside |
| `paymentReceived` | `registerPayment` når fakturaen blir `PAID` | Kundens kontaktperson/kunde | Kundeportalens fakturaside |
| `bookingRequested` | `createBooking` | Kunden | `/kundeportal/bestillinger` |
| `bookingConfirmed` | Kontorets bekreftelse i bookingskøen | Kunden | `/kundeportal/bestillinger` |
| `bookingCancelled` | Kunde- eller kontorkansellering | Kunden | `/kundeportal/bestillinger` |
| `workOrderAssigned` | Tildeling/flytting av montør | Montøren | `/mine-oppdrag/<id>` |

Kontoret varsles fortsatt om nye og endrede bookinger gjennom
`Notification`-køen (in-app og e-post). Den transaksjonelle kunden får sin
egen, lokaliserte e-post fra `EmailMessage`.

Hver hendelse kan slås av i innstillingene. Av betyr bare at e-posten ikke
sendes; forretningshendelsen lagres som før.

### Lokalisering og sikkerhet

- Språket hentes fra kontaktpersonens `locale` når den finnes. Ukjent eller
  manglende språk faller tilbake til norsk.
- Alle brukerstyrte felt går gjennom `cleanText`, `neutralizeUrls` og
  `escapeHtml` før de settes inn i HTML. En oppdragstittel kan derfor ikke bli
  HTML eller en phishing-lenke.
- Systemets egne lenker valideres som absolutte `http(s)`-URL-er. `javascript:`
  og andre protokoller forkastes.
- Emnefeltet renses for kontrolltegn og linjeskift, slik at det ikke kan
  brukes til header-injection.

## Retry og feilhåndtering

- Første retry etter 60 sekunder, deretter eksponentiell dobling opp til én
  time (`EMAIL_RETRY_BASE_MS` kan overstyre grunnlaget).
- Etter fem mislykkede forsøk blir raden `FAILED`. Den forsøkes ikke igjen
  automatisk, men kan undersøkes og enqueues på nytt med en ny nøkkel.
- Bare en kort feilkode lagres (`lastError`), aldri rå SMTP-melding. SMTP-feil
  kan inneholde mottakeradressen.
- Manglende SMTP teller ikke som et forsøk. Når SMTP senere konfigureres, sendes
  køen i normal rekkefølge.
- Hvis modulen for en hendelse (quotes, invoicing eller booking) er slått av,
  utsettes meldingen i stedet for å forkastes. Den sendes når modulen er på
  igjen.

## Observability

- Workeren logger strukturert JSON via `src/lib/logger.ts`:
  `Email outbox: sent message`, `scheduled retry`, `failed permanently`,
  `processed batch` og `requeued stale messages`.
- Loggene inneholder mal, antall forsøk og feilkode — aldri mottaker, emne
  eller payload.
- `getEmailOutboxMetrics()` gir antall `PENDING`, `SENDING`, `SENT`, `FAILED`,
  eldste ventende rad og om SMTP er konfigurert. Den kan brukes av
  driftsdashboard eller helsesjekk.
- Utboksen kjører i den eksisterende jobbworkeren. Den starter med appen og
  poller hvert 15. sekund; ved arbeid sendes i små batcher.

## Personvern og oppbevaring

- `to` og `subject` er personopplysninger. Payload kan inneholde navn, beløp,
  referanser og engangstoken.
- Etter vellykket sending tømmes `payload` fordi den ikke trengs for retry.
  `to`, `subject` og `sentAt` beholdes som leveringsbevis.
- Logger er PII-frie. Rå SMTP-feil logges aldri.
- Utboksen har ingen automatisk sletting av `SENT`-rader ennå. Drift bør rydde
  gamle rader etter installasjonens oppbevaringspolicy, eller feltet kan
  utvides med en egen retensjonsjobb.

## Test-e-post

**Innstillinger → Automatisk e-post** har et eget testskjema. Testen går
gjennom utboksen, men sendes umiddelbart slik at administratoren får svar på om
SMTP og avsenderadressen virker. Testen krever `settings.manage`, lagres som en
vanlig `EmailMessage` og påvirker ikke av/på-innstillingene.

## Residual og avgrensninger

- Ingen betalingsleverandør (Vipps/Stripe/kort) eller betalingslenke finnes i
  v1. «Faktura sendt» og «betaling mottatt» er derfor de automatiske
  betalingshendelsene; betaling registreres fortsatt manuelt.
- Ingen vedlegg. Rapporter sendes fortsatt fra den eksisterende
  rapportflyten, ikke fra utboksen.
- Ingen redigering av maltekst i UI. Malene er lokalisert i koden og følger
  merkevarens navn, logo og farge.
- Ingen automatisk retensjon/sletting av `SENT`-rader.
- Utboksen er at-least-once mot SMTP: en krasj etter at SMTP har akseptert
  meldingen, men før `SENT` er skrevet, kan gi én duplikat ved nytt forsøk.
  Idempotensnøkkelen hindrer duplikater i køen, ikke i SMTP.
- Av/på per hendelse er globalt. Det finnes ikke per-kunde eller per-avdeling
  opt-out for transaksjons-e-post.
