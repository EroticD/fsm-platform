# Ruting, trafikk og ruteoptimalisering

Dette dokumentet beskriver ruteleverandørene, trafikk-ETA, flerpunkts­optimaliseringen
og grensene i `src/lib/routing/**` og `src/server/route-plan.ts`.

## Lagene

| Lag | Ansvar | Kilde |
| --- | --- | --- |
| `route-plan.ts` | Laster visiter, kompetanse, arbeidstid og avvik, og bygger én plan per montør | Prisma |
| `route-optimizer.ts` | Ren optimalisering med tidsvinduer, kompetanse, prioritet og arbeidstid | Ingen I/O |
| `osrm.ts` | OSRM `/route` og `/table` med cache og reserve | `OSRM_BASE_URL` |
| `traffic.ts` | Trafikkbevisst enkeltstrekning via TomTom eller HERE | `TOMTOM_API_KEY` / `HERE_API_KEY` |
| `haversine.ts` | Lokal reserve: luftlinje × 1,35 / gjennomsnittsfart | Ingen I/O |

Rekkefølgen er alltid:

1. Trafikkleverandør for enkeltstrekninger, når den er konfigurert.
2. OSRM for ruter og matriser.
3. Haversine når ingen ekstern leverandør svarer.

Reserven er deterministisk. En feil, timeout, tom respons eller manglende
API-nøkkel gir aldri en feilet ruteplan – den gir OSRM, deretter haversine.

## Miljøvariabler

```dotenv
# Vanlig OSRM-kompatibel ruteserver. Brukes til /table i optimaliseringen.
ROUTING_PROVIDER=osrm
OSRM_BASE_URL=https://osrm.example.com
ROUTING_TIMEOUT_MS=60000

# Valgfri trafikkleverandør for ETA. Setter du denne, brukes den til
# enkeltstrekninger; matrisen går fortsatt til OSRM.
TRAFFIC_PROVIDER=tomtom          # tomtom | here
TOMTOM_API_KEY=...
HERE_API_KEY=...
TRAFFIC_TIMEOUT_MS=8000
TRAFFIC_CACHE_TTL_MS=60000
TRAFFIC_RATE_LIMIT_PER_MINUTE=60

# Valgfritt, for proxy eller testmiljø:
# TOMTOM_BASE_URL=https://api.tomtom.com
# HERE_BASE_URL=https://router.hereapi.com

# Farten den lokale reserven bruker.
TRACKING_AVERAGE_SPEED_KMH=50
```

`ROUTING_PROVIDER=tomtom` eller `ROUTING_PROVIDER=here` virker også som
kortform for `TRAFFIC_PROVIDER`. En trafikkleverandør uten nøkkel ignoreres
bevisst, slik at en glemt hemmelighet gir OSRM/haversine i stedet for
gjentatte feilede kall.

### TomTom

- Endepunkt: `GET /routing/1/calculateRoute/{lon},{lat}:{lon},{lat}/json`.
- Appen sender `traffic=true`, `travelMode=car`, `routeType=fastest` og
  `computeTravelTimeFor=all`.
- Nøkkelen sendes i headeren `TomTom-Api-Key`, ikke i URL-en, slik at den
  ikke havner i proxy-logger.
- `travelTimeInSeconds` er trafikkbevisst varighet; `lengthInMeters` er
  avstand. `trafficDelayInSeconds` brukes ikke i beregningen, men er grunnen
  til at `traffic: true` settes på svaret.

### HERE

- Endepunkt: `GET /v8/routes` med `departureTime=now`, `return=summary`.
- `duration` er trafikkbevisst varighet i sekunder; `length` er avstand i
  meter. `baseDuration` er uten trafikk.
- Nøkkelen sendes som `apikey` i query. Den logges aldri av appen.

### Kostnader og kvoter

Trafikkleverandører tar betalt per ruteberegning. Appen begrenser derfor
bruken:

- **Cache:** vellykkede svar caches i `TRAFFIC_CACHE_TTL_MS` (standard 60 s)
  per avrundet koordinatnøkkel. Cachen er per prosess/instans, ikke delt.
- **Rate limit:** maks `TRAFFIC_RATE_LIMIT_PER_MINUTE` kall per minutt per
  prosess (standard 60). Over grensen brukes OSRM/haversine uten å kalle
  trafikkleverandøren. Sett `0` for å slå trafikk helt av uten å fjerne
  nøkkelen.
- **Ingen matrisekall:** TomTom/HERE brukes bare for én strekning. OSRMs
  `/table` brukes for flerpunktsoptimalisering. Det holder kostnaden nede og
  gir ett konsistent reisegrunnlag i hele ruten.
- **Tidsavbrudd:** `TRAFFIC_TIMEOUT_MS` (standard 8 000 ms, tillatt
  1 000–30 000). Et tidsavbrudd faller tilbake til OSRM/haversine.

## Flerpunktsoptimalisering

`optimiseRoute` er en ren funksjon. Den tar en reisematrise, visiter med
tidsvinduer og eventuelt:

- `technicianSkillIds`: montørens gyldige kompetanse. Visiter med obligatoriske
  kompetansekrav som mangler, rapporteres som `missing_skills`.
- `workingHours`: dagens arbeidstid. En visitt som ikke blir ferdig innen
  slutten, rapporteres som `working_hours`.
- `priority` (0–3) per visitt. Ruteplanen utleder den fra SLA: brudd = 3,
  under 1 time igjen = 2, under 4 timer = 1, ellers 0. Prioriteten trekker en
  visitt fram i nærmeste-nabo-valget og bryter lik reisetid.

Algoritmen er:

1. Filtrer bort visiter uten koordinater, manglende kompetanse og kjent fravær.
2. **Nearest neighbour** med deterministisk tie-break: reisetid, prioritet,
   visitt-id.
3. **2-opt** som bare godtar ruter som fortsatt er gjennomførbare innenfor
   tidsvinduer og arbeidstid. Maks 200 iterasjoner.
4. Beregn «før»-bildet fra den opprinnelige rekkefølgen og returner spart
   kjøretid/avstand, endret rekkefølge og årsak per ufordelt visitt.

Grenser:

- Maks **50 stopp** per montør og **500 visiter** lastet per dag.
- Én startrad per rute (montørens første lokaliserte visitt). Det finnes ingen
  depotadresse, kapasitet, lunsjpause eller flerdagsrute i denne versjonen.
- Tidsvinduet er dagens blokk pluss `ROUTE_WINDOW_TOLERANCE_MINUTES` (120 min).
  Toleransen gjør at reisetid kan endre rekkefølgen, men aldri flytte en jobb
  vilkårlig langt.
- Matrisen bruker OSRM uten trafikk. Trafikk-ETA gjelder enkeltstrekninger og
  sporing, ikke hvert matriseelement.

## Tjeneste og API

`getRoutePlan(actor, { date, technicianId?, visitIds? })` returnerer per
montør:

- `stops` med ankomst, start, slutt, ventetid, kjøretid og avstand
- `skipped` med årsak (`missing_coordinates`, `outside_time_window`, `limit`,
  `missing_skills`, `working_hours`, `absence`, `ineligible`)
- `baselineTravelMinutes`, `baselineDistanceKm`
- `savedTravelMinutes`, `savedDistanceKm`, `orderChanged`
- `provider` og `fallbackUsed`

`POST /api/ruteoptimalisering` er intern, øktbasert og krever modulen
`calendar`. Rettighetene er `workorders.update`, `workorders.assign` eller
`dispatch.configure`. Standard er tørrkjøring.

```bash
curl -sS -X POST https://fsm.example.com/api/ruteoptimalisering \
  -H 'content-type: application/json' \
  -b 'next-auth.session-token=...' \
  -d '{"date":"2026-11-09","technicianId":"tech-1","visitIds":["visit-a","visit-b"]}'
```

`apply: true` krever i tillegg `workorders.assign`. Da går flyttingen gjennom
`applyRouteOrder`, som:

- avviser hele endringen ved overlapp, fravær, låst oppdrag eller endret plan,
- flytter visittene i én transaksjon,
- skriver en revisjonsrad per flyttet visitt med før/etter-tid, leverandør og
  spart kjøretid/avstand,
- oppdaterer oppdragets samlede tidsrom.

Optimaliseringen flytter aldri noe av seg selv. UI-et viser før/etter og
krever et eget trykk på «Bruk rekkefølge».

## Feilsøking

- **«Beregning: Lokal estimering»** betyr at verken trafikkleverandøren eller
  OSRM svarte. Sjekk `OSRM_BASE_URL`, nøkkel og `ROUTING_TIMEOUT_MS`.
- **Alle visiter havner i `missing_skills`** betyr at montøren ikke har
  gyldig kompetanse registrert, eller at `technicianSkillIds` er tom.
- **`working_hours`** betyr at visitten ikke blir ferdig før arbeidsdagens
  slutt. Utvid arbeidstiden/avdelingens åpningstider eller flytt visitten.
- **Trafikk virker ikke:** sjekk at `TRAFFIC_PROVIDER` (eller
  `ROUTING_PROVIDER`) er `tomtom`/`here`, at riktig nøkkel er satt, og at
  `TRAFFIC_RATE_LIMIT_PER_MINUTE` ikke er `0`.
