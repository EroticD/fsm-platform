# REST API

FSM-plattformen har et lesbart REST-API for oppdrag, kunder, rapporter og
dokumenter. API-et bruker egne API-nøkler og er helt atskilt fra
nettleserøkten: informasjonskapsler godtas aldri, og alle kall må sende en
Bearer-nøkkel.

- **Base URL:** `https://<din-fsm-installasjon>/api/v1`
- **OpenAPI 3.1:** [`GET /api/v1/openapi.json`](/api/v1/openapi.json) (åpent, uten nøkkel)
- **Nøkkeladministrasjon:** **Innstillinger → API-nøkler** (bare administrator)

## Autentisering

Alle dataendepunkter under `/api/v1` – også `/me` – krever en gyldig nøkkel:

```http
Authorization: Bearer fsm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Nøkkelen består av prefikset `fsm_` og 32 tilfeldige bytes. Serveren lagrer
bare en SHA-256-hash og et kort visningsprefiks, aldri selve nøkkelen.

### Opprette en nøkkel

1. Gå til **Innstillinger → API-nøkler** som administrator.
2. Skriv inn et navn og eventuelt en utløpsdato.
3. Trykk **Opprett nøkkel**.
4. Kopier nøkkelen med én gang.

> **Nøkkelen vises bare én gang.** Den kan ikke hentes frem igjen, verken i
> grensesnittet eller via API-et. Mister du den, må du tilbakekalle den og
> opprette en ny. Nøkkelen lagres aldri i URL-er, lokal lagring eller
> serverlogger.

En nøkkel kan tilbakekalles fra samme fane. Tilbakekalling virker umiddelbart.
Utløpte og tilbakekalte nøkler gir `401 unauthorized`.

### Rettigheter (scopes)

API-et har ikke egne scopes. **Nøkkelen arver nøyaktig rettighetene til
brukeren som opprettet den**, inkludert avdelings- og kundeomfanget. Det
betyr blant annet:

| Endepunkt | Påkrevd rettighet |
| --- | --- |
| `GET /me` | Gyldig nøkkel |
| `GET /work-orders` | `workorders.view` |
| `POST /work-orders` | `workorders.create` |
| `GET /work-orders/{id}` | `workorders.view` + oppdraget i brukerens omfang |
| `PATCH /work-orders/{id}` | `workorders.update` |
| `GET /customers`, `GET /customers/{id}` | `customers.view` |
| `GET /reports`, `GET /reports/{id}`, `GET /reports/{id}/pdf` | `reports.view` |
| `GET /documents`, `GET /documents/{id}` | `documents.view` |

Endrer du brukerens rolle eller rettigheter, gjelder endringen også alle
nøklene brukeren eier. En deaktivert bruker gir `401`.

## Responsformat

Vellykkede svar bruker en konvolutt:

```json
{
  "data": { "id": "cm...", "title": "Service av varmepumpe" }
}
```

Lister har i tillegg `meta`:

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "limit": 50,
    "total": 0,
    "totalPages": 0
  }
}
```

Feil bruker alltid samme form:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Ugyldig forespørsel",
    "details": { "field": "scheduledFor" }
  }
}
```

API-svar sendes med `Cache-Control: private, no-store` og
`Vary: Authorization`, slik at mellomlag ikke blander nøkler. PDF-svaret er
også `no-store`.

## Paginering

Listeendepunktene tar `page` (starter på 1, standard 1) og `limit`
(standard 50, **maks 100**). `meta.totalPages` er `0` når det ikke finnes rader.
Verdier over 100 avvises eller kappes til 100 av serveren.

```bash
curl -s "$FSM_BASE_URL/api/v1/work-orders?page=2&limit=25" \
  -H "Authorization: Bearer $FSM_API_KEY"
```

## Rate limit

Hver nøkkel kan bruke **120 forespørsler per minutt**. Grensen gjelder per
nøkkel, ikke per bruker eller IP. Ved overskridelse svarer API-et `429` med
`Retry-After` (sekunder) og:

```json
{ "error": { "code": "rate_limited", "message": "For mange forespørsler" } }
```

## Feilkoder

| HTTP | `error.code` | Betydning |
| --- | --- | --- |
| 400 | `validation_error` | Ugyldig JSON, manglende body eller ukjent felt |
| 401 | `unauthorized` | Manglende, ugyldig, utløpt eller tilbakekalt nøkkel |
| 403 | `forbidden` | Nøkkelens bruker mangler rettigheten |
| 404 | `not_found` | Objektet finnes ikke eller er utenfor brukerens omfang |
| 409 | `conflict` | Duplikat ordrenummer, låst oppdrag eller bevaringsplikt |
| 413 | `validation_error` | JSON-body er større enn grensen |
| 422 | `validation_error` | Feltvalidering feilet |
| 429 | `rate_limited` | Mer enn 120 kall per minutt |
| 500 | `server_error` | Ukjent serverfeil |

`details` er valgfritt og kan inneholde hvilket felt som feilet, eller annen
maskinlesbar informasjon. `404` brukes også når et objekt ligger utenfor
avdelings- eller kundeomfanget, slik at API-et ikke røper at det finnes.

## Endepunkter

| Metode | Sti | Rettighet | Beskrivelse |
| --- | --- | --- | --- |
| `GET` | `/me` | Gyldig nøkkel | Identitet, avdeling og effektive rettigheter |
| `GET` | `/work-orders` | `workorders.view` | Liste med filtre og paginering |
| `POST` | `/work-orders` | `workorders.create` | Opprette oppdrag |
| `GET` | `/work-orders/{id}` | `workorders.view` | Oppdragsdetaljer |
| `PATCH` | `/work-orders/{id}` | `workorders.update` | Endre status og/eller datoer |
| `GET` | `/customers` | `customers.view` | Kunde liste med søk |
| `GET` | `/customers/{id}` | `customers.view` | Kundekort |
| `GET` | `/reports` | `reports.view` | Rapportliste |
| `GET` | `/reports/{id}` | `reports.view` | Rapportdetaljer |
| `GET` | `/reports/{id}/pdf` | `reports.view` | Last ned PDF |
| `GET` | `/documents` | `documents.view` | Dokumentliste |
| `GET` | `/documents/{id}` | `documents.view` | Dokumentmetadata |

---

## Identitet

### `GET /me`

Returnerer brukeren nøkkelen handler som, avdelingen og de effektive
rettighetene. Bruk dette til å bekrefte at nøkkelen virker og har riktig
tilgang.

```bash
curl -s "$FSM_BASE_URL/api/v1/me" \
  -H "Authorization: Bearer $FSM_API_KEY"
```

```json
{
  "data": {
    "id": "cm...",
    "name": "Kari Nordmann",
    "email": "kari@firma.no",
    "role": "OFFICE",
    "department": { "id": "cm...", "name": "Oslo" },
    "permissions": ["workorders.view", "customers.view", "reports.view"],
    "customerId": null
  }
}
```

---

## Oppdrag

### `GET /work-orders`

Returnerer oppdrag brukeren har tilgang til, avgrenset til egen avdeling med
mindre brukeren er administrator. Myk-slettede oppdrag vises ikke.

**Query-parametere**

| Parameter | Type | Beskrivelse |
| --- | --- | --- |
| `page` | heltall | Side, standard 1 |
| `limit` | heltall | Rader per side, maks 100 |
| `status` | streng | `PLANNED`, `IN_PROGRESS`, `WAITING`, `COMPLETED`, `CANCELLED`, `OPEN`, `PENDING` |
| `customerId` | streng | Filtrer på kunde |
| `technicianId` | streng | Filtrer på tildelt montør |
| `q` | streng | Søk i tittel og kundenavn |
| `scheduledFrom` | dato | `YYYY-MM-DD`, fra og med |
| `scheduledTo` | dato | `YYYY-MM-DD`, til og med |
| `updatedSince` | dato-tid | Bare oppdrag endret etter tidspunktet (ISO 8601) |

```bash
curl -s "$FSM_BASE_URL/api/v1/work-orders?status=PLANNED&page=1&limit=25" \
  -H "Authorization: Bearer $FSM_API_KEY"
```

```json
{
  "data": [
    {
      "id": "cm...",
      "title": "Service av varmepumpe",
      "orderNumber": "2026-1042",
      "status": "PLANNED",
      "scheduledFor": "2026-11-03",
      "scheduledTo": null,
      "customer": { "id": "cm...", "name": "Nordlys Eiendom AS" },
      "technicians": [{ "id": "cm...", "name": "Ola Montør", "email": "ola@firma.no" }],
      "department": { "id": "cm...", "name": "Oslo" },
      "reportCount": 0,
      "createdAt": "2026-10-30T08:15:00.000Z",
      "updatedAt": "2026-10-30T08:15:00.000Z"
    }
  ],
  "meta": { "page": 1, "limit": 25, "total": 1, "totalPages": 1 }
}
```

### `GET /work-orders/{id}`

Returnerer detaljer med beskrivelse, adresse, kontakt, tags, maler,
rapportoversikt, siste kommentarer og vedleggsmetadata. Selve filinnholdet
inngår ikke. Ukjent eller utilgjengelig id gir `404 not_found`.

```bash
curl -s "$FSM_BASE_URL/api/v1/work-orders/cm123" \
  -H "Authorization: Bearer $FSM_API_KEY"
```

### `POST /work-orders`

Oppretter et oppdrag. `title` og `scheduledFor` er påkrevd. `departmentId`
styres av brukerens avdeling med mindre brukeren er administrator. Svarer
`201` med `Location: /api/v1/work-orders/{id}`.

```bash
curl -s -X POST "$FSM_BASE_URL/api/v1/work-orders" \
  -H "Authorization: Bearer $FSM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Årlig service",
    "customerId": "cm_customer",
    "scheduledFor": "2026-11-12",
    "description": "Kontroller filter og trykk.",
    "technicianIds": ["cm_user"],
    "templateIds": ["cm_template"]
  }'
```

```json
{ "data": { "id": "cm_workorder" } }
```

### `PATCH /work-orders/{id}`

Endrer status og/eller planlagte datoer. Minst ett kjent felt må sendes.
`status` går gjennom samme statusovergang og revisjonslogg som i grensesnittet.
Låste oppdrag og bevaringsplikt gir `409 conflict`.

```bash
curl -s -X PATCH "$FSM_BASE_URL/api/v1/work-orders/cm123" \
  -H "Authorization: Bearer $FSM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "status": "IN_PROGRESS" }'
```

```bash
curl -s -X PATCH "$FSM_BASE_URL/api/v1/work-orders/cm123" \
  -H "Authorization: Bearer $FSM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "scheduledFor": "2026-11-14", "scheduledTo": "2026-11-15" }'
```

---

## Kunder

### `GET /customers`

Aktive kunder brukeren har `customers.view` for. Søk dekker navn,
organisasjonsnummer, kundenummer og sted.

| Parameter | Type | Beskrivelse |
| --- | --- | --- |
| `page` | heltall | Side, standard 1 |
| `limit` | heltall | Rader per side, maks 100 |
| `q` | streng | Søk i navn, org.nr., kundenummer og sted |

```bash
curl -s "$FSM_BASE_URL/api/v1/customers?q=nordlys&limit=10" \
  -H "Authorization: Bearer $FSM_API_KEY"
```

```json
{
  "data": [
    {
      "id": "cm...",
      "name": "Nordlys Eiendom AS",
      "customerNumber": "10042",
      "orgNumber": "912345678",
      "city": "Oslo",
      "phone": "+47 22 00 00 00",
      "email": "post@nordlys.no",
      "departmentId": "cm...",
      "responsibleTechnician": { "id": "cm...", "name": "Ola Montør", "email": "ola@firma.no" }
    }
  ],
  "meta": { "page": 1, "limit": 10, "total": 1, "totalPages": 1 }
}
```

### `GET /customers/{id}`

Returnerer kundekortet med kontaktpersoner, enheter, serviceavtaler,
portalbrukere (`users`) og antall. Passord, tokens og andre hemmeligheter
returneres aldri. Slettede eller ukjente kunder gir `404`.

```bash
curl -s "$FSM_BASE_URL/api/v1/customers/cm123" \
  -H "Authorization: Bearer $FSM_API_KEY"
```

---

## Rapporter

### `GET /reports`

Signerte rapporter innenfor brukerens rapportomfang. Myk-slettede rapporter
vises ikke.

| Parameter | Type | Beskrivelse |
| --- | --- | --- |
| `page` | heltall | Side, standard 1 |
| `limit` | heltall | Rader per side, maks 100 |
| `customerId` | streng | Filtrer på kunde |
| `workOrderId` | streng | Filtrer på oppdrag |
| `locked` | boolsk | `true`/`false` |
| `acknowledged` | boolsk | Kundekvittering `true`/`false` |
| `q` | streng | Søk i rapportnavn, nummer og tittel |
| `from` | dato | `YYYY-MM-DD`, fra og med fullføringsdato |
| `to` | dato | `YYYY-MM-DD`, til og med fullføringsdato |

```bash
curl -s "$FSM_BASE_URL/api/v1/reports?workOrderId=cm123&limit=20" \
  -H "Authorization: Bearer $FSM_API_KEY"
```

```json
{
  "data": [
    {
      "id": "cm...",
      "name": "Årlig vaktmesterrapport",
      "reportNumber": "abc1234",
      "completedAt": "2026-10-29T12:40:00.000Z",
      "isLocked": true,
      "customerAcknowledgedAt": null,
      "workOrder": {
        "id": "cm...",
        "title": "Service av varmepumpe",
        "customer": { "id": "cm...", "name": "Nordlys Eiendom AS" }
      },
      "unitsCount": 2,
      "technicianName": "Ola Montør"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

### `GET /reports/{id}`

Returnerer metadata, skjemasvar, enheter, signaturer og kundekvittering.
Signaturbilder oppgis bare som trygge `/uploads/...`-adresser; interne
maldata og fillagringsstier returneres ikke.

```bash
curl -s "$FSM_BASE_URL/api/v1/reports/cm123" \
  -H "Authorization: Bearer $FSM_API_KEY"
```

### `GET /reports/{id}/pdf`

Laster ned den ferdige PDF-en med `Content-Type: application/pdf` og
`Content-Disposition: attachment`. Krever samme tilgang som detaljvisningen.

```bash
curl -s "$FSM_BASE_URL/api/v1/reports/cm123/pdf" \
  -H "Authorization: Bearer $FSM_API_KEY" \
  -o rapport.pdf
```

---

## Dokumenter

### `GET /documents`

Returnerer metadata for dokumentbiblioteket. Selve filinnholdet og interne
lagringsstier inngår ikke.

| Parameter | Type | Beskrivelse |
| --- | --- | --- |
| `page` | heltall | Side, standard 1 |
| `limit` | heltall | Rader per side, maks 100 |
| `folderId` | streng | Filtrer på mappe |
| `tag` | streng | Filtrer på dokumenttag |
| `q` | streng | Søk i tittel og filnavn |

```bash
curl -s "$FSM_BASE_URL/api/v1/documents?q=serviceavtale&limit=10" \
  -H "Authorization: Bearer $FSM_API_KEY"
```

```json
{
  "data": [
    {
      "id": "cm...",
      "title": "Serviceavtale 2026",
      "fileName": "serviceavtale-2026.pdf",
      "mimeType": "application/pdf",
      "fileSize": 248321,
      "folder": { "id": "cm...", "name": "Avtaler" },
      "tags": [{ "id": "cm...", "name": "Avtale", "color": "#3b82f6" }],
      "uploadedBy": "Kari Nordmann",
      "updatedAt": "2026-10-20T09:30:00.000Z"
    }
  ],
  "meta": { "page": 1, "limit": 10, "total": 1, "totalPages": 1 }
}
```

### `GET /documents/{id}`

Returnerer metadata, mappesti og versjonsoversikt. Endepunktet gir ikke
filbytes eller interne lagringsstier.

```bash
curl -s "$FSM_BASE_URL/api/v1/documents/cm123" \
  -H "Authorization: Bearer $FSM_API_KEY"
```

---

## Sikkerhet og drift

- Nøkkelen er en hemmelighet. Behandle den som et passord, og legg den i et
  miljøvariabelt hemmelighetslager – ikke i git.
- Bruk alltid HTTPS. API-et avviser ikke HTTP selv, men nøkkelen sendes i
  klartekst uten TLS.
- Nøkler kan få utløpsdato og tilbakekalles umiddelbart.
- Mutasjoner går gjennom samme tjenestelag og revisjonslogg som i
  grensesnittet.
- API-et godtar aldri NextAuth-informasjonskapsler. En nettleser som er
  innlogget, får altså ikke tilgang uten en Bearer-nøkkel.
