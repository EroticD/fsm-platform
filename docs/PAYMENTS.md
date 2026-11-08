# Betaling (PSP) – v1

Denne integrasjonen lar en kunde betale en sendt faktura med kort eller Vipps
via en betalingslenke. Applikasjonen lagrer **aldri** kortdata. Kortnummer,
CVC, bank-ID og selve betalingsbekreftelsen ligger hos betalingsleverandøren
(PSP). Vi lagrer bare leverandørens id, en URL og en status.

Integrasjonen er valgfri. Uten konfigurasjon er alle betalingshandlinger en
stille no-op: ingen nettverkskall, ingen databasemutasjon og ingen knapp som
lover mer enn systemet kan holde.

## Arkitektur

```
Faktura (admin)  ──►  createInvoicePaymentLink  ──►  Stripe / Vipps
                                                       │
Kundeportal «Betal» ───────────────────────────────────┘
                                                       │
POST /api/webhooks/payments/[provider]  ◄──────────────┘
        │  rå kropp + HMAC-signatur
        ▼
applyPaymentEvent
        │  valuta, beløp, idempotens
        ▼
registerPayment (eksisterende tjeneste)
        │
        ▼
Payment + Invoice.paidTotal/status + revisjonslogg
```

Alle beløp går over leverandørens API i minste valutaenhet (øre). Beløpet
regnes om fra `Decimal` uten flyttall. PSP-en får en stabil idempotensnøkkel
per faktura og utestående beløp.

## Miljøvariabler

| Variabel | Påkrevd | Beskrivelse |
| --- | --- | --- |
| `PAYMENTS_PROVIDER` | Ja | `stripe`, `vipps` eller tom/`none` for av. |
| `APP_URL` | Anbefalt | Offentlig base-URL for retur og betalingslenke. Faller tilbake til `NEXTAUTH_URL`. |
| `STRIPE_SECRET_KEY` | Stripe | Hemmelig API-nøkkel (`sk_live_…` / `sk_test_…`). |
| `STRIPE_WEBHOOK_SECRET` | Stripe | Signeringshemmelighet (`whsec_…`) fra webhook-endepunktet. |
| `VIPPS_CLIENT_ID` | Vipps | Klient-id fra Vipps MobilePay-portalen. |
| `VIPPS_CLIENT_SECRET` | Vipps | Klienthemmelighet. |
| `VIPPS_SUBSCRIPTION_KEY` | Vipps | `Ocp-Apim-Subscription-Key`. |
| `VIPPS_MERCHANT_SERIAL_NUMBER` | Vipps | Salgsenhetens MSN. |
| `VIPPS_WEBHOOK_SECRET` | Vipps | Felles HMAC-hemmelighet for webhooker. |
| `VIPPS_BASE_URL` | Nei | Standard `https://apitest.vipps.no`. Bruk `https://api.vipps.no` i produksjon. |
| `VIPPS_SYSTEM_NAME` / `VIPPS_SYSTEM_VERSION` | Nei | Systemidentifikasjon til Vipps. |

En leverandør regnes som konfigurert bare når både API-nøkkel og
webhook-hemmelighet finnes. Da vises betalingsknappen. Ellers vises en kort
forklaring om at betalingsleverandør ikke er konfigurert.

## Webhook

Endepunkt:

```
POST https://<app-url>/api/webhooks/payments/stripe
POST https://<app-url>/api/webhooks/payments/vipps
```

Ruten:

- krever at `invoicing`-modulen er på (ellers 404),
- avviser en leverandør som ikke er valgt i miljøet (404) og en valgt
  leverandør som mangler nøkler (503),
- rate-limiter per leverandør og IP,
- leser maks 64 KB rå kropp før signaturkontroll,
- verifiserer signaturen mot **nøyaktig** de bytene leverandøren sendte,
- svarer 200 også for duplikater og hendelser vi bevisst ignorerer, slik at
  leverandøren slutter å prøve,
- svarer 500 uten detaljer ved intern feil, slik at leverandøren prøver igjen.

### Stripe

Bruk `Stripe-Signature`-headeren: `t=<tid>,v1=<hmac>`. Signaturen er
HMAC-SHA256 over `<tid>.<rå kropp>`. Tidsstempelet må være innenfor fem
minutter. Abonner på:

- `checkout.session.completed`
- `payment_intent.succeeded`
- `checkout.session.expired`
- `payment_intent.payment_failed`

`checkout.session.completed` behandles bare når `payment_status = paid`.
Betalings-id-en er `payment_intent` når den finnes, ellers sesjons-id-en.
Det gjør at `checkout.session.completed` og `payment_intent.succeeded` for
samme betaling gir samme idempotensnøkkel.

### Vipps MobilePay

Vipps-signaturen følger HMAC-oppsettet med:

```
x-ms-date: <RFC 1123-dato>
x-ms-content-sha256: <base64(sha256(rå kropp))>
Authorization: HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=<base64(hmac)>
```

Signaturen dekker `POST\n<path+query>\n<dato>;<host>;<content-sha256>`.
Tidsstempelet må være innenfor fem minutter, og `x-ms-content-sha256` må
stemme med kroppen. Vi oppretter betaling med `userFlow=WEB_REDIRECT`,
`paymentMethod.type=WALLET` og referansen `fsm-<faktura-id>`.
Hendelsene `epayment.succeeded` og `epayment.captured` gir betaling;
`epayment.failed`, `epayment.aborted`, `epayment.cancelled` og
`epayment.expired` gir feilet/utløpt lenke uten betalingsrad.

> Vipps har endret webhook-signering mellom API-versjoner. Verifiser
> headernavnene mot kontrollpanelet ved oppsett, og oppdater konnektoren hvis
> Vipps varsler om ny signeringsmetode.

## Forretningsregler

- Lenken kan bare opprettes for `SENT`, `PARTIALLY_PAID` eller `OVERDUE` med
  utestående beløp.
- Bare NOK støttes i v1.
- En bekreftet betaling registreres gjennom `registerPayment`, med
  `method = ONLINE`. Delbetaling er normalen og oppdaterer fakturaen til
  `PARTIALLY_PAID`.
- Valuta må stemme med fakturaen. Feil valuta gir ingen betalingsrad, men en
  revisjonsrad.
- Beløp over utestående avvises. Det samme gjør null/negativt beløp.
- Hvis utestående endres etter at lenken ble opprettet (for eksempel en manuell
  betaling), kan PSP-en fortsatt belaste lenkens opprinnelige beløp. Webhooken
  avviser da overbetalingen, og avviket må avstemmes manuelt. Lag en ny lenke
  etter delbetalinger.
- Duplikater identifiseres av leverandørens betalings-id, ikke av
  hendelses-id. Gjentatt levering eller to hendelsestyper for samme betaling
  gir derfor aldri dobbeltbeløp.
- Feilede og utløpte lenker setter `paymentStatus = FAILED/EXPIRED`, men
  endrer ikke fakturaens bokføringsstatus.
- Refusjoner opprettes **ikke** fra PSP-hendelser. Bruk kreditnota.

## Rekonsiliasjon

1. Sammenlign PSP-dashbordets betalinger med `Payment.providerReference` og
   `Payment.providerEventId`.
2. Kontroller at `Invoice.paidTotal` og `Payment.amount` stemmer.
3. Avvik som gjelder refusjon håndteres med kreditnota; systemet lager ingen
   negativ betaling.
4. Alle hendelser og avvik ligger i revisjonsloggen med leverandør, hendelses-
   type og en kort årsakskode. Rå payload, kortdata og persondata logges ikke.

## Sikkerhet

- Ingen kortdata eller PSP-hemmeligheter lagres i databasen, vises i UI eller
  skrives til logg.
- Webhooken krever gyldig HMAC over rå kropp. Kroppsstørrelse og frekvens er
  begrenset før parsing.
- Betalingslenken kan bare opprettes av aktører med fakturarettighet
  (`customers.manage` eller administrator).
- Portalen viser bare en lagret lenke for kundens egen faktura, og bare når
  beløpet fortsatt er utestående.
- Alle mutasjoner skriver revisjonsrad i samme transaksjon.

## v1-begrensninger

- **Ingen refusjon/capture/void fra appen.** Kreditnota er eneste
  reduksjonsmekanisme, og den utløser ingen PSP-refusjon.
- **Ingen automatisk lenke i portalen.** En administrator oppretter lenken på
  fakturaen. Portalen viser «Betal» når lenken finnes.
- **Bare NOK** og én betaling per lenke. Lenken gjenskapes hvis utestående
  endrer seg.
- **Stripe Checkout** brukes som vertet betalingsside; vi har ingen egen
  kortkomponent og ingen Payment Element-flyt.
- **Vipps ePayment** brukes med `WEB_REDIRECT` og `WALLET`. Kort i Vipps,
  delvis capture og avanserte brukerflyter er ikke implementert.
- **Ingen ekte sandbox-kjøring** er gjort i denne endringen. Signaturene er
  enhetstestet mot dokumenterte formler, og HTTP-kall er mockett i testene.
  Før produksjon må begge leverandørene prøves med egne testnøkler.
- **Ingen e-faktura/Peppol/OCR/KID.** Betalingslenken erstatter ikke
  bankavstemming eller e-faktura.
- **Ingen automatisk avstemming mot bank.** Manuell betaling og PSP-betaling
  møtes først i `Payment`-tabellen.
