# REST API

FSM-plattformen har et lesbart REST-API for oppdrag, visiter, kunder, utstyr,
vedlikehold, rapporter og dokumenter. API-et bruker egne API-nøkler og er helt
atskilt fra nettleserøkten: informasjonskapsler godtas aldri, og alle kall må
sende en Bearer-nøkkel.

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
| `GET /work-orders/{id}/visits` | `workorders.view` + oppdraget i brukerens omfang |
| `POST /work-orders/{id}/visits` | `workorders.edit` |
| `GET /visits/{id}` | `workorders.view` + oppdraget i brukerens omfang |
| `PATCH /visits/{id}` | `workorders.assign` (flytting/montører), `workorders.update` (status) eller `workorders.edit` (metadata) |
| `DELETE /visits/{id}` | `workorders.edit` |
| `GET /customers`, `GET /customers/{id}` | `customers.view` |
| `GET /equipment`, `GET /equipment/{id}` | `equipment.view` |
| `POST /equipment`, `PATCH /equipment/{id}` | `equipment.manage` |
| `GET /equipment/{id}/meters` | `equipment.view` |
| `POST /equipment/{id}/meters` | `equipment.manage` |
| `GET /maintenance-plans` | `equipment.view` |
| `POST /maintenance-plans` | `equipment.manage` |
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
| 409 | `conflict` | Duplikat ordrenummer, låst oppdrag, bevaringsplikt, overlappende visitt, hierarkisyklus eller utfaset utstyr |
| 413 | `validation_error` | JSON-body er større enn grensen |
| 422 | `validation_error` | Feltvalidering feilet |
| 429 | `rate_limited` | Mer enn 120 kall per minutt |
| 500 | `server_error` | Ukjent serverfeil |

Utstyr og vedlikehold legger maskinlesbare årsaker i `error.details.code`:
`equipment.errors.*` og `maintenance.errors.*`. Eksempel:
`equipment.errors.hierarchyCycle`, `equipment.errors.retired`,
`maintenance.errors.productRequired`.

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
| `GET` | `/work-orders/{id}/visits` | `workorders.view` | Visiter på oppdraget |
| `POST` | `/work-orders/{id}/visits` | `workorders.edit` | Opprette visitt |
| `GET` | `/visits/{id}` | `workorders.view` | Visitt med montører og oppdrag |
| `PATCH` | `/visits/{id}` | avhengig av operasjon | Flytt, tildel, endre status eller metadata |
| `DELETE` | `/visits/{id}` | `workorders.edit` | Slette visitt |
| `GET` | `/customers` | `customers.view` | Kunde liste med søk |
| `GET` | `/customers/{id}` | `customers.view` | Kundekort |
| `GET` | `/equipment` | `equipment.view` | Utstyrsliste med søk og filtre |
| `POST` | `/equipment` | `equipment.manage` | Registrere utstyr |
| `GET` | `/equipment/{id}` | `equipment.view` | Utstyr med målinger, planer og historikk |
| `PATCH` | `/equipment/{id}` | `equipment.manage` | Endre eller flytte utstyr |
| `GET` | `/equipment/{id}/meters` | `equipment.view` | Målinger for utstyret |
| `POST` | `/equipment/{id}/meters` | `equipment.manage` | Registrere måling |
| `GET` | `/maintenance-plans` | `equipment.view` | Vedlikeholdsplaner |
| `POST` | `/maintenance-plans` | `equipment.manage` | Opprette vedlikeholdsplan |
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
mindre brukeren er administrator. Myk-slettede oppdrag vises ikke. Hvert
oppdrag har en `visits`-liste med opptil 20 visiter; bruk
`/work-orders/{id}/visits` for full, paginert liste.

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
      "visits": [
        {
          "id": "cm...",
          "workOrderId": "cm...",
          "sequence": 0,
          "startsAt": "2026-11-03T09:00:00.000Z",
          "endsAt": "2026-11-03T11:00:00.000Z",
          "allDay": false,
          "status": "ASSIGNED",
          "notes": null,
          "technicians": [{ "id": "cm...", "name": "Ola Montør", "email": "ola@firma.no" }],
          "createdAt": "2026-10-30T08:15:00.000Z",
          "updatedAt": "2026-10-30T09:15:00.000Z"
        }
      ],
      "createdAt": "2026-10-30T08:15:00.000Z",
      "updatedAt": "2026-10-30T08:15:00.000Z"
    }
  ],
  "meta": { "page": 1, "limit": 25, "total": 1, "totalPages": 1 }
}
```

### `GET /work-orders/{id}`

Returnerer detaljer med beskrivelse, adresse, kontakt, tags, maler,
rapportoversikt, siste kommentarer, vedleggsmetadata og opptil 20 innebygde
visiter. Selve filinnholdet inngår ikke. Ukjent eller utilgjengelig id gir
`404 not_found`.

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

## Visiter

En visitt er en tidsblokk i et oppdrag. Oppdragets `scheduledFor`/`scheduledTo`
er avledet fra de aktive visitene. Alle tidsstempler er ISO 8601 med klokkeslett
og tidssone, for eksempel `2026-11-03T09:00:00.000Z`. `endsAt` er eksklusiv, så
en visitt som slutter `11:00` opptar ikke tidsrommet fra og med `11:00`.

Statusene følger flyten `PLANNED → ASSIGNED → EN_ROUTE → ON_SITE → DONE`, med
`CANCELLED` som alternativ før visitten er fullført. `DONE` og `CANCELLED` er
lukkede tilstander.

### `GET /work-orders/{id}/visits`

Visiter på oppdraget, sortert på `startsAt`. Krever `workorders.view` og at
oppdraget ligger i brukerens avdeling eller kundeomfang. Ukjent eller
utilgjengelig oppdrag gir `404 not_found`.

| Parameter | Type | Beskrivelse |
| --- | --- | --- |
| `page` | heltall | Side, standard 1 |
| `limit` | heltall | Rader per side, maks 100 |

```bash
curl -s "$FSM_BASE_URL/api/v1/work-orders/cm123/visits?page=1&limit=25" \
  -H "Authorization: Bearer $FSM_API_KEY"
```

```json
{
  "data": [
    {
      "id": "cm...",
      "workOrderId": "cm...",
      "sequence": 0,
      "startsAt": "2026-11-03T09:00:00.000Z",
      "endsAt": "2026-11-03T11:00:00.000Z",
      "allDay": false,
      "status": "ASSIGNED",
      "notes": "Ta med filter.",
      "technicians": [
        { "id": "cm...", "name": "Ola Montør", "email": "ola@firma.no" }
      ],
      "createdAt": "2026-10-30T08:15:00.000Z",
      "updatedAt": "2026-10-30T09:15:00.000Z"
    }
  ],
  "meta": { "page": 1, "limit": 25, "total": 1, "totalPages": 1 }
}
```

### `POST /work-orders/{id}/visits`

Oppretter en visitt. Krever `workorders.edit`. Svarer `201` med
`Location: /api/v1/visits/{id}`.

| Felt | Type | Påkrevd | Beskrivelse |
| --- | --- | --- | --- |
| `startsAt` | dato-tid | Ja | ISO 8601 med klokkeslett |
| `endsAt` | dato-tid | Ja | ISO 8601, etter `startsAt`; maks 31 døgn |
| `allDay` | boolsk | Nei | Standard `false` |
| `technicianIds` | streng[] | Nei | Aktive ansatte i oppdragets avdeling |
| `notes` | streng \| null | Nei | Fritekst |
| `sequence` | heltall | Nei | Rekkefølge innen samme tid, standard `0` |

Ukjente felt gir `400 validation_error`. Overlappende visitt for en montør gir
`409 conflict` med `details.code: "visits.errors.overlap"`.

```bash
curl -s -X POST "$FSM_BASE_URL/api/v1/work-orders/cm123/visits" \
  -H "Authorization: Bearer $FSM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "startsAt": "2026-11-03T09:00:00.000Z",
    "endsAt": "2026-11-03T11:00:00.000Z",
    "technicianIds": ["cm_user"],
    "notes": "Ta med filter."
  }'
```

```json
{ "data": { "id": "cm_visit" } }
```

### `GET /visits/{id}`

Returnerer visitten med montører og et kort oppdragssammendrag. Krever
`workorders.view`, og visitten slås alltid opp gjennom oppdragets omfang.
Ukjent eller utilgjengelig visitt gir `404 not_found`.

```bash
curl -s "$FSM_BASE_URL/api/v1/visits/cm123" \
  -H "Authorization: Bearer $FSM_API_KEY"
```

```json
{
  "data": {
    "id": "cm...",
    "workOrderId": "cm...",
    "sequence": 0,
    "startsAt": "2026-11-03T09:00:00.000Z",
    "endsAt": "2026-11-03T11:00:00.000Z",
    "allDay": false,
    "status": "ASSIGNED",
    "notes": null,
    "technicians": [
      { "id": "cm...", "name": "Ola Montør", "email": "ola@firma.no" }
    ],
    "createdAt": "2026-10-30T08:15:00.000Z",
    "updatedAt": "2026-10-30T09:15:00.000Z",
    "workOrder": {
      "id": "cm...",
      "title": "Service av varmepumpe",
      "orderNumber": "2026-1042",
      "status": "PLANNED",
      "scheduledFor": "2026-11-03",
      "scheduledTo": null,
      "customer": { "id": "cm...", "name": "Nordlys Eiendom AS" },
      "department": { "id": "cm...", "name": "Oslo" }
    }
  }
}
```

### `PATCH /visits/{id}`

Endrer **én operasjon om gangen**. En kropp som blander flere operasjoner gir
`400 validation_error`, slik at det er entydig hvilken tjeneste og
revisjonslogg som gjelder.

| Operasjon | Felt | Rettighet | Beskrivelse |
| --- | --- | --- | --- |
| Flytting | `startsAt` + `endsAt` | `workorders.assign` | Begge må sendes sammen. Overlapp kontrolleres på nytt |
| Status | `status` | `workorders.update` | Må være en lovlig overgang |
| Montører | `technicianIds` | `workorders.assign` | Erstatter hele listen; minst én id |
| Metadata | `notes`, `allDay`, `sequence` | `workorders.edit` | Kan kombineres |

```bash
# Flytt
curl -s -X PATCH "$FSM_BASE_URL/api/v1/visits/cm123" \
  -H "Authorization: Bearer $FSM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "startsAt": "2026-11-04T09:00:00.000Z", "endsAt": "2026-11-04T12:00:00.000Z" }'

# Endre status
curl -s -X PATCH "$FSM_BASE_URL/api/v1/visits/cm123" \
  -H "Authorization: Bearer $FSM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "status": "ON_SITE" }'

# Erstatt montørlisten
curl -s -X PATCH "$FSM_BASE_URL/api/v1/visits/cm123" \
  -H "Authorization: Bearer $FSM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "technicianIds": ["cm_user"] }'
```

Svaret er den oppdaterte visitten på samme form som `GET /visits/{id}`.

### `DELETE /visits/{id}`

Sletter visitten permanent og svarer `204` uten body. Oppdraget og
revisjonsloggen består. Krever `workorders.edit`. Bevaringsplikt eller låst
oppdrag gir `409 conflict`.

```bash
curl -s -X DELETE "$FSM_BASE_URL/api/v1/visits/cm123" \
  -H "Authorization: Bearer $FSM_API_KEY"
```

### Feilkoder for visiter

Felt- og tilstandsfeil har alltid `details.code`:

| `details.code` | HTTP | Betydning |
| --- | --- | --- |
| `visits.errors.invalidTimeRange` | 422 | Manglende/ugyldig tidsrom, eller slutt før start |
| `visits.errors.durationTooLong` | 422 | Visitten er lengre enn 31 døgn |
| `visits.errors.invalidSequence` | 422 | `sequence` er ikke et ikke-negativt heltall |
| `visits.errors.invalidTechnician` | 422 | Ukjent/inaktiv montør, eller montør utenfor avdelingen |
| `visits.errors.statusTransition` | 422 | Ukjent status eller ulovlig overgang |
| `visits.errors.invalidInput` | 422 | Ugyldig id eller annet inndata |
| `visits.errors.noChange` | 422 | Ingen faktisk endring (f.eks. tom montørliste) |
| `visits.errors.overlap` | 409 | Montøren er booket i overlappende visitt |
| `visits.errors.legalHold` | 409 | Oppdraget har bevaringsplikt |
| `visits.errors.workOrderLocked` | 409 | Oppdraget er låst i en avsluttet status |
| `visits.errors.visitLocked` | 409 | Visitten er `DONE` eller `CANCELLED` |

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

## Utstyr og vedlikehold

Utstyrsregisteret bygger på `Product` og støtter kategoritre, fysisk hierarki
(bygg → system → enhet), garanti, QR-identitet og målinger. Alle endepunktene
krever `equipment.view`; mutasjoner krever `equipment.manage`. Kundeportalen
bruker egne endepunkter og er ikke omfattet av disse rutene.

### `GET /equipment`

Søk og filtrering på tvers av kunder. `categoryId` tar med hele undertreet, og
`parentId=` (tom verdi) gir bare rot-enheter.

| Parameter | Type | Beskrivelse |
| --- | --- | --- |
| `q` | streng | Modell, serienummer, plassering eller kundenavn |
| `status` | streng | `ACTIVE`, `OUT_OF_SERVICE` eller `RETIRED` |
| `categoryId` | streng | Kategori inkludert undertrær |
| `customerId` | streng | Begrens til én kunde |
| `parentId` | streng | Overordnet enhet; tom verdi gir røtter |
| `page`, `limit` | heltall | Paginering, maks 100 per side |

```bash
curl -s "$FSM_BASE_URL/api/v1/equipment?q=pumpe&status=ACTIVE&limit=10" \
  -H "Authorization: Bearer $FSM_API_KEY"
```

```json
{
  "data": [
    {
      "id": "cm...",
      "model": "Grundfos CR 10",
      "serialNumber": "NV-4001",
      "location": "Kjeller",
      "status": "ACTIVE",
      "criticality": 1,
      "meterUnit": "timer",
      "installDate": "2024-05-01",
      "warrantyUntil": "2027-05-01",
      "customer": { "id": "cm...", "name": "Nordlys Eiendom AS" },
      "category": { "id": "cm...", "name": "Pumper" },
      "parent": { "id": "cm...", "model": "Ventilasjonssystem" },
      "counts": {
        "children": 0,
        "meterReadings": 12,
        "maintenancePlans": 2,
        "reports": 4,
        "workOrders": 6
      }
    }
  ],
  "meta": { "page": 1, "limit": 10, "total": 1, "totalPages": 1 }
}
```

### `POST /equipment`

```json
{
  "customerId": "cm...",
  "model": "Grundfos CR 10",
  "serialNumber": "NV-4001",
  "location": "Kjeller",
  "categoryId": "cm...",
  "parentId": null,
  "installDate": "2024-05-01",
  "warrantyUntil": "2027-05-01",
  "status": "ACTIVE",
  "criticality": 1,
  "meterUnit": "timer"
}
```

Svar `201` med `{ "data": { "id": "cm..." } }`. En QR-token utstedes
automatisk. Ugyldig kategori, forelder hos annen kunde eller hierarkisyklus gir
`422`/`409` med stabil kode i `error.details.code` på formen
`equipment.errors.*`.

### `GET /equipment/{id}`

Returnerer identitet, kunde, kategori, foreldresti, underenheter, målinger,
vedlikeholdsplaner, dokumenter og avgrenset historikk. Ukjent id gir `404`.

### `PATCH /equipment/{id}`

Tar et vilkårlig utvalg av feltene fra `POST`, pluss `status`. `categoryId`,
`parentId`, `installDate` og `warrantyUntil` kan settes til `null` for å fjerne
verdien. Flytting som lager en syklus avvises med `409` og
`equipment.errors.hierarchyCycle`.

### `GET/POST /equipment/{id}/meters`

Målinger er desimaler med kilde `MANUAL`, `VISIT` eller `IMPORT`.

```json
{
  "value": 1240.5,
  "readAt": "2026-10-30",
  "source": "MANUAL",
  "note": "Avlest etter service"
}
```

Ved registrering kontrolleres alle aktive målerplaner i samme transaksjon. En
måling som passerer terskelen lager nøyaktig ett vedlikeholdsoppdrag, også når
to målinger kommer samtidig. Utfaset utstyr gir `409` med
`equipment.errors.retired`.

### `GET/POST /maintenance-plans`

```json
{
  "title": "Årlig service",
  "trigger": "CALENDAR",
  "productId": "cm...",
  "customerId": "cm...",
  "intervalMonths": 12,
  "leadDays": 14,
  "nextDueDate": "2027-01-15"
}
```

`CALENDAR` krever `intervalMonths` og `nextDueDate`. `METER` krever `productId`
og `meterInterval`, og bruker siste måling som utgangspunkt. Kalenderplaner
genererer oppdrag innenfor ledetiden; genereringen er idempotent og tåler
samtidige kjøringer. Hver forekomst har `dueDate`, `status` (`PENDING`,
`GENERATED`, `SKIPPED`) og eventuell `workOrderId`.

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
