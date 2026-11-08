# Pushvarsler (FCM og APNs)

Pushvarsler er et supplement til in-app-varslene. Hvert varsel lagres først i
`Notification`, og deretter legges én rad per aktiv mobilenhet i den
vedvarende utboksen `PushMessage`. Jobbworkeren sender fra utboksen, slik at en
treg eller utilgjengelig leverandør aldri blokkerer handlingen som utløste
varselet.

Uten konfigurerte leverandører er funksjonen en trygg no-op: enheter kan
registreres, men ingen nettverkskall gjøres. Ingenting sendes, og ingen
hemmeligheter kreves for utvikling.

## Oppsett av FCM (Android)

FCM bruker HTTP v1 og en Google-tjenestekonto.

1. Opprett et Firebase-prosjekt og legg til Android-appen med pakkenavnet
   mobilappen bruker.
2. I Google Cloud Console: opprett en tjenestekonto med rollen
   «Firebase Cloud Messaging API Admin» (eller tilsvarende rettighet til å
   sende meldinger).
3. Lag en JSON-nøkkel for tjenestekontoen.
4. Legg hele JSON-en på én linje i `FCM_SERVICE_ACCOUNT_JSON`. `project_id`,
   `client_email`, `private_key` og `token_uri` leses derfra.

```dotenv
FCM_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"fsm-prod","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"push@fsm-prod.iam.gserviceaccount.com","token_uri":"https://oauth2.googleapis.com/token"}
```

Adapteren henter et OAuth-token med en RS256-signert JWT, cacher det til like
før utløp og sender til:

```
POST https://fcm.googleapis.com/v1/projects/<project_id>/messages:send
```

## Oppsett av APNs (iOS)

APNs bruker token-basert autentisering med en `.p8`-nøkkel.

1. I Apple Developer: lag en APNs Auth Key (`.p8`) og noter Key ID.
2. Noter Team ID og appens Bundle ID.
3. Legg nøkkelen i `APNS_KEY_P8`. Linjeskift kan skrives som `\n`, eller hele
   PEM-en kan base64-kodes (nyttig i miljøer som ikke liker linjeskift).

```dotenv
APNS_KEY_P8=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
APNS_KEY_ID=ABC123DEFG
APNS_TEAM_ID=TEAM123456
APNS_BUNDLE_ID=no.example.fsm
APNS_ENV=production
```

`APNS_ENV=sandbox` bruker `api.sandbox.push.apple.com`; ellers brukes
`api.push.apple.com`. JWT-en er ES256-signert og fornyes hvert 50. minutt.

## Miljøvariabler

| Variabel | Betydning |
| --- | --- |
| `FCM_SERVICE_ACCOUNT_JSON` | Hele tjenestekonto-JSON-en. Tom = FCM av. |
| `APNS_KEY_P8` | Privat `.p8`-nøkkel (rå, med `\n`, eller base64). |
| `APNS_KEY_ID` | Apple Key ID. |
| `APNS_TEAM_ID` | Apple Team ID. |
| `APNS_BUNDLE_ID` | Appens Bundle ID (`apns-topic`). |
| `APNS_ENV` | `production` (standard) eller `sandbox`. |
| `PUSH_WORKER` | `false` slår av push-workeren. Standard er på. |

Leverandørene konfigureres uavhengig av hverandre. Er bare FCM satt, sendes
Android-varsler og iOS-enheter hoppes over med `not_configured`.

## API

Alle mobile endepunkter krever en aktiv innlogget økt, samme opphav og er
rate-begrenset per bruker (30 kall/minutt). Responsen er alltid `no-store`.
Selve tokenet returneres aldri, og det logges eller revisjoneres ikke.

### Registrer en enhet

```http
POST /api/mobile/push-tokens
Content-Type: application/json

{
  "token": "<FCM- eller APNs-token>",
  "platform": "android",
  "appVersion": "1.4.2",
  "deviceId": "optional-stable-device-id"
}
```

- `platform` må være `android` eller `ios`.
- `token` må være 8–512 tegn og bare inneholde `A-Z a-z 0-9 . _ : -`.
- `appVersion` er valgfri, maks 40 tegn.
- `deviceId` er valgfri, maks 128 tegn. Det er klientens enhets-id, ikke et
  push-token.

Vellykket svar:

```json
{
  "ok": true,
  "device": {
    "id": "cuid",
    "platform": "android",
    "appVersion": "1.4.2",
    "active": true,
    "lastSeenAt": "2026-11-09T09:20:00.000Z"
  }
}
```

Tokenet er unikt per plattform. Registrerer en annen bruker samme token, flyttes
raden til den nye brukeren og det revisjonsføres at eierskapet endret seg. Det
hindrer at en gammel konto fortsetter å motta varsler på en enhet som er logget
inn på nytt. Ventende pushmeldinger fra den gamle kontoen slettes i samme
transaksjon, slik at de ikke lekker til den nye brukeren.

### Avregistrer en enhet

```http
DELETE /api/mobile/push-tokens
Content-Type: application/json

{ "token": "<token>", "platform": "ios" }
```

Svar `{ "ok": true, "removed": true }`. Ukjent token eller token som tilhører en
annen bruker gir `removed: false` med status 200, slik at svaret ikke avslører
om tokenet finnes.

## Livssyklus for enheter

1. Appen registrerer tokenet etter innlogging og når FCM/APNs roterer det.
2. Hver registrering oppdaterer `lastSeenAt`, `appVersion`, `deviceId` og
   aktiverer enheten igjen.
3. Ved `UNREGISTERED` (FCM) eller `BadDeviceToken`/`Unregistered` (APNs)
   deaktiveres enheten umiddelbart. Senere varsler køes ikke til den.
4. Administrator kan rydde deaktiverte enheter og enheter som ikke er sett på
   90 dager i **Innstillinger → Pushvarsler**. Slettingen kaskaderer til
   utboksen.
5. En bruker som slettes, tar med seg enhetene og utboksen via `onDelete:
   Cascade`.

## Utboks, retry og idempotens

`PushMessage` har en unik `idempotencyKey` på formen
`<notificationId>:<deviceId>`. Gjentatt køing av samme varsel gir derfor ingen
duplikat. Testvarsler bruker en tilfeldig nøkkel per utsending.

Workeren:

- claimer én rad om gangen med en betinget `updateMany` (flere app-instanser kan
  kjøre samtidig),
- prøver fem ganger med eksponentiell pause (30 s, 60 s, 120 s, 240 s, maks én
  time),
- markerer permanente feil som `FAILED`, utmattede forsøk som `DEAD_LETTER`,
- setter `SENDING`-rader eldre enn fem minutter tilbake i køen ved oppstart.

Statusene er `PENDING`, `SENDING`, `SENT`, `SKIPPED`, `FAILED` og
`DEAD_LETTER`. `SKIPPED` brukes når leverandøren ikke er konfigurert, enheten er
deaktivert, varselet er slettet eller modulen er slått av. Det er ikke en feil
som skal prøves på nytt.

Driftsmålinger ligger i `/api/metrics`: `fsm_push_messages{status="pending"}` og
`fsm_push_messages{status="dead_letter"}`, i tillegg til de vanlige
køtallene.

## Modulvakter

Push følger modulene som eier varseltypen:

| Varseltype | Modul |
| --- | --- |
| `BOOKING` | `booking` |
| `REPORT_READY` | `reports` |
| `INVOICE_PAID` | `invoicing` |
| Øvrige (tildeling, forfalt, SLA, melding) | kjerne |

Er modulen av, lages ingen push-rad, og en allerede køet rad hoppes over.

## Dype lenker

Push-payloaden inneholder alltid varsel-id og en intern sti. Appen skal bare
åpne stier som starter med `/`, aldri eksterne URL-er.

| Hendelse | `path` |
| --- | --- |
| Tildeling, rapport klar | `/oppdrag/<workOrderId>` |
| Booking | `/bookinger` |
| Faktura betalt | `/faktura/<invoiceId>` |
| Testvarsel | `/varsler` |

FCM legger feltene i `message.data` som strenger (`type`, `path`,
`notificationId`). APNs legger de samme feltene på toppnivå ved siden av
`aps`.

Kundeportalbrukere får samme trygge lenke som in-app-varselet, for eksempel
`/kundeportal#rapporter` for rapportvarsler.

## Personvern og sikkerhet

- Push-tokenet er en personopplysning og lagres bare så lenge enheten er
  registrert. Det logges aldri, verken i applogger, revisjonslogg eller
  feilmeldinger.
- Revisjonsloggen lagrer hvem som registrerte/avregistrerte en enhet, plattform
  og eventuell eierskapsendring – ikke tokenet.
- Innstillingene viser bare om leverandørene er konfigurert. Prosjekt-ID,
  bundle-ID og miljø kan vises; private nøkler, klienthemmeligheter og tokens
  vises aldri.
- Push-innholdet er en kopi av varselet som allerede ligger i `Notification`.
  Ingen kundedokumenter eller vedlegg sendes i push.
- Ved personvernforespørsel slettes enhetene sammen med brukeren. En enhet som
  er deaktivert, ryddes av administratoren eller av sletting av brukeren.

## Feilsøking

| Symptom | Sjekk |
| --- | --- |
| `not_configured` i utboksen | Riktig env-variabler satt i **alle** app-instanser? |
| `invalid_token` | Appen må registrere tokenet på nytt; enheten er deaktivert. |
| `auth_failed` | FCM-tjenestekontoen mangler rettighet, eller APNs-nøkkel/Key ID/Team ID er feil. |
| `permanent` | Ugyldig melding eller feil bundle-ID/pakkenavn. |
| Ingen rad i utboksen | Brukeren har ingen aktive enheter, eller modulen er av. |
| Testvarsel gir 0 enheter | Administratoren har ikke registrert en enhet med sin egen konto. |

## Restanser

Serverutboksen, FCM/APNs-adapterne og den native push-bootstrapen i `fsm-mobile`
er levert, inkludert tokenregistrering ved innlogging/rotasjon og
signerings-CI. Det som gjenstår er produksjonsbevis:

- **Ekte FCM/APNs-legitimasjon.** Repoet inneholder ingen FCM-tjenestekonto eller
  APNs `.p8`-nøkkel. Uten dem er push en no-op, og ende-til-ende-leveranse er
  ikke verifisert mot Googles eller Apples produksjonsendepunkter. APNs krever
  HTTP/2; adapteren bruker `fetch`, så kjøremiljøet må tilby HTTP/2 eller ha en
  HTTP/2-proxy foran.
- **Butikksignering og oppføring.** Android upload-keystore, Apple
  Distribution-sertifikat med provisioning profile, butikktekster,
  personvernstekst og skjermbilder må på plass før publisering. CI verifiserer
  at native filer og konfigurasjon er til stede og at appen bygger.
- **Fysisk enhets-QA.** Push i forgrunn, bakgrunn og kaldstart, trykk mot dype
  lenker (`/oppdrag/<id>`), tokenrotasjon, utlogging og offline-gjenoppretting
  må verifiseres på ekte Android- og iOS-enheter.
- **Kvittering fra appen.** `lastSeenAt` oppdateres ved registrering, ikke ved
  hver mottatt push. En enhet som bare mottar varsler, kan derfor bli ryddet
  etter 90 dager hvis appen aldri registrerer seg på nytt.
