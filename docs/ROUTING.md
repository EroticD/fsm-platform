# Ruting, trafikk og ruteoptimalisering

Dette dokumentet beskriver ruteleverandørene, trafikk-ETA, overtidsplanlegging
og grensene i `src/lib/routing/**` og `src/server/route-plan.ts`.

## Lagene

| Lag | Ansvar | Kilde |
| --- | --- | --- |
| `route-plan.ts` | Laster visiter, kompetanse, arbeidstid og avvik, og bygger én plan per montør | Prisma |
| `route-optimizer.ts` | Ren optimalisering med tidsvinduer, kompetanse, prioritet, arbeidstid og overtid | Ingen I/O |
| `osrm.ts` | Ruting og flerpunktsmatrise via OSRM med cache og reserve | `OSRM_BASE_URL` |
| `google-routes.ts` | Trafikkbevisst enkeltstrekning via Google Routes API | `GOOGLE_ROUTES_API_KEY` |
| `haversine.ts` | Lokal reserve: luftlinje × 1,35 / gjennomsnittsfart | Ingen I/O |

Grunnlaget for ruting er **OpenStreetMap via OSRM**. OSRM er en vanlig
ruteserver og har **ingen sanntidstrafikk**. Trafikkbevisst ETA er en valgfri
tilleggskilde: **Google Routes API** (Google Maps Platform).

Rekkefølgen er alltid:

1. Google Routes for enkeltstrekninger, når `GOOGLE_ROUTES_API_KEY` er satt.
2. OSRM for ruter og matriser.
3. Haversine når ingen ekstern leverandør svarer.

Reserven er deterministisk. En feil, timeout, tom respons, manglende nøkkel
eller nådd kvote gir aldri en feilet ruteplan – den gir OSRM, deretter
haversine.

## Miljøvariabler

```dotenv
# OSRM-kompatibel ruteserver basert på OpenStreetMap. Brukes til ruter og
# /table i optimaliseringen. Uten OSRM_BASE_URL gjøres ingen nettverkskall.
ROUTING_PROVIDER=osrm
OSRM_BASE_URL=https://osrm.example.com
ROUTING_TIMEOUT_MS=60000

# Valgfri trafikkbevisst ETA fra Google Routes API. Uten nøkkel brukes
# OSRM/haversine, som ikke har sanntidstrafikk.
GOOGLE_ROUTES_API_KEY=...
GOOGLE_ROUTES_TIMEOUT_MS=8000
GOOGLE_ROUTES_CACHE_TTL_MS=60000
GOOGLE_ROUTES_RATE_LIMIT_PER_MINUTE=60

# Valgfritt, for proxy eller testmiljø:
# GOOGLE_ROUTES_BASE_URL=https://routes.googleapis.com

# Overtid i ruteplanen.
ROUTE_ALLOW_OVERTIME=true
ROUTE_MAX_OVERTIME_MINUTES=0

# Farten den lokale reserven bruker.
TRACKING_AVERAGE_SPEED_KMH=50
```

`ROUTING_PROVIDER` kan være `osrm` eller `haversine`. `haversine` slår bevisst
av alle eksterne rute- og trafikkall, også når en Google-nøkkel finnes.
Ukjente verdier ignoreres og gir haversine.

### Google Routes API

- Endepunkt: `POST /directions/v2:computeRoutes` på
  `https://routes.googleapis.com`.
- Appen sender `travelMode=DRIVE`,
  `routingPreference=TRAFFIC_AWARE_OPTIMAL`, `computeAlternativeRoutes=false`
  og `units=METRIC`. Avreisetid utelates, slik at Google bruker «nå» og
  trafikken på det tidspunktet.
- Feltene som faktisk leses er `routes.duration` og
  `routes.distanceMeters`. `duration` er **trafikkbevisst varighet**;
  `distanceMeters` er **kjørt avstand**. `staticDuration` hentes ikke.
- Vellykkede svar merkes med `provider: "google"` og `traffic: true`.
- API-nøkkelen sendes i headeren `X-Goog-Api-Key`, ikke i URL-en, og logges
  eller returneres aldri. Feilmeldinger inneholder bare HTTP-status.
- Google brukes bare for én strekning (`route`). Flerpunktsmatrisen går
  fortsatt til OSRM fordi Google-matriser har egne kvoter og priser, og fordi
  hele ruten da får ett konsistent reisegrunnlag.

### OSRM og OpenStreetMap

- `GET /route/v1/driving/{lon},{lat};{lon},{lat}` for enkeltstrekninger.
- `GET /table/v1/driving/...` for reisematrisen i optimaliseringen.
- OSRM svarer med `distance` (meter) og `duration` (sekunder) uten
  trafikkbevissthet. Det er derfor ETA uten Google-nøkkel er et
  rute-/hastighetsanslag, ikke sanntid.

### Cache, kvoter og kostnader

Både OSRM-adapteren og Google-adapteren har per-prosess cache og
tidsavbrudd. Google har i tillegg et lokalt tak:

- **Cache:** vellykkede Google-svar caches i `GOOGLE_ROUTES_CACHE_TTL_MS`
  (standard 60 s) per avrundet koordinatnøkkel. Cachen er per
  prosess/instans, ikke delt mellom instanser.
- **Rate limit:** maks `GOOGLE_ROUTES_RATE_LIMIT_PER_MINUTE` kall per minutt
  per prosess (standard 60). Over grensen brukes OSRM/haversine uten å kalle
  Google. Sett `0` for å slå av Google uten å fjerne nøkkelen.
- **Ingen matrisekall:** Google brukes bare for én strekning. OSRMs `/table`
  brukes for flerpunktsoptimalisering.
- **Tidsavbrudd:** `GOOGLE_ROUTES_TIMEOUT_MS` (standard 8 000 ms, tillatt
  1 000–30 000). Et tidsavbrudd faller tilbake til OSRM/haversine.
- **Kostnader:** Google Maps Platform fakturerer per ruteberegning, og
  trafikkbevisst ruting kan ha høyere SKU enn enkel ruting. Sjekk gjeldende
  priser og kvoter i Google Cloud-prosjektet. OSRM er gratis programvare, men
  krever egen server og drift. Cache, rate limit og fravær av matrisekall er
  de viktigste kostnadsbegrensningene.

## Overtid og tidsvinduer

En visitt skal **alltid planlegges** selv om den ikke rekker kundens
tidsvindu eller montørens arbeidstid. Den blir ikke lenger ufordelt av disse
årsakene. I stedet får stoppet:

- `startsAt`/`endsAt`: faktisk planlagt start og slutt.
- `outsideTimeWindow`: true når jobben starter etter visittens seneste
  starttid (`endsAt - tjenestetid`).
- `outsideWorkingHours`: true når jobben varer forbi arbeidstidens slutt.
- `overtimeMinutes`: antall tjenesteminutter som faller etter arbeidstidens
  slutt. En visitt som starter etter arbeidstid teller bare selve
  tjenestetiden, ikke reise- eller ventetid før. Kunderelatert
  `outsideTimeWindow` innenfor arbeidstiden gir flagg, men ikke overtid.

Ruten summerer `totalOvertimeMinutes`, og både API og rutesiden viser totalen
og per-stopp-overtid.

### Konfigurasjon

| Variabel | Standard | Betydning |
| --- | --- | --- |
| `ROUTE_ALLOW_OVERTIME` | `true` | `false` gjør at arbeid etter arbeidstid ikke planlegges. Visitten rapporteres da som `overtime_limit`. |
| `ROUTE_MAX_OVERTIME_MINUTES` | `0` | `0` = ingen grense. En positiv verdi er et tak for **total** overtid per rute. Visitten som ville overskride taket rapporteres som `overtime_limit`. |

Standardoppsettet planlegger altså all overtid. En hard grense er bevisst
opt-in, slik at en travel dag ikke plutselig mister visiter.

### Hva som fortsatt kan bli ufordelt

Bare genuint umulige visiter blir ufordelte:

- `missing_coordinates`: mangler koordinater fra oppdrag, site eller kunde.
- `missing_skills`: montøren mangler et obligatorisk kompetansekrav.
- `absence`: visitten kolliderer med registrert ferie/sykdom.
- `overtime_limit`: ruten ville bryte `ROUTE_ALLOW_OVERTIME=false` eller en
  positiv `ROUTE_MAX_OVERTIME_MINUTES`.
- `ineligible`: mangler matriserad eller annen teknisk forutsetning.
- `limit`: flere enn 50 lokaliserte visiter for montøren.

## Flerpunktsoptimalisering

`optimiseRoute` er en ren funksjon. Den tar en reisematrise, visiter med
tidsvinduer og eventuelt:

- `technicianSkillIds`: montørens gyldige kompetanse. Visiter med obligatoriske
  kompetansekrav som mangler, rapporteres som `missing_skills`.
- `workingHours`: dagens arbeidstid. Visiter som ikke rekker slutten,
  planlegges med overtid.
- `allowOvertime` og `maxOvertimeMinutes`: samme policy som miljøvariablene.
- `priority` (0–3) per visitt. Ruteplanen utleder den fra SLA: brudd = 3,
  under 1 time igjen = 2, under 4 timer = 1, ellers 0. Prioriteten trekker en
  visitt fram i nærmeste-nabo-valget og bryter lik reisetid.

Algoritmen er:

1. Filtrer bort visiter uten koordinater og manglende kompetanse.
2. **Nearest neighbour** med deterministisk tie-break: gjennomførbare visiter
   før visiter som krever overtid, deretter reisetid, prioritet og visitt-id.
3. **2-opt** som godtar kortere kjøring bare når antall ufordelte og total
   overtid ikke øker. Maks 200 iterasjoner.
4. Beregn «før»-bildet fra den opprinnelige rekkefølgen og returner spart
   kjøretid/avstand, endret rekkefølge, overtid og årsak per ufordelt visitt.

Grenser:

- Maks **50 stopp** per montør og **500 visiter** lastet per dag.
- Én startrad per rute (montørens første lokaliserte visitt). Det finnes ingen
  depotadresse, kapasitet, lunsjpause eller flerdagsrute i denne versjonen.
- Tidsvinduet er dagens blokk pluss `ROUTE_WINDOW_TOLERANCE_MINUTES` (120 min).
  Toleransen gjør at reisetid kan endre rekkefølgen, men aldri flytte en jobb
  vilkårlig langt.
- Matrisen bruker OSRM uten trafikk. Google-trafikk gjelder enkeltstrekninger
  og sporing, ikke hvert matriseelement.
- «Bruk rekkefølge» avviser fortsatt en flytting som ender etter midnatt, fordi
  visitten må ligge innenfor valgt dag. Ekstrem overtid må i så fall fordeles
  manuelt over to dager.

## Tjeneste og API

`getRoutePlan(actor, { date, technicianId?, visitIds? })` returnerer per
montør:

- `stops` med ankomst, planlagt start/slutt, ventetid, kjøretid, avstand,
  `overtimeMinutes`, `outsideTimeWindow` og `outsideWorkingHours`
- `skipped` med årsak (`missing_coordinates`, `limit`, `missing_skills`,
  `overtime_limit`, `absence`, `ineligible`)
- `totalOvertimeMinutes`, `baselineOvertimeMinutes`
- `baselineTravelMinutes`, `baselineDistanceKm`
- `savedTravelMinutes`, `savedDistanceKm`, `orderChanged`
- `provider` og `fallbackUsed`

Toppnivået i svaret har også `totalOvertimeMinutes` for hele dagen.

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
- skriver en revisjonsrad per flyttet visitt med før/etter-tid, leverandør,
  spart kjøretid/avstand og **overtid** (`overtimeMinutes`,
  `outsideTimeWindow`, `outsideWorkingHours`, `totalOvertimeMinutes`),
- oppdaterer oppdragets samlede tidsrom.

Optimaliseringen flytter aldri noe av seg selv. UI-et viser før/etter,
overtid og krever et eget trykk på «Bruk rekkefølge».

## Feilsøking

- **«Beregning: Lokal estimering»** betyr at verken Google eller OSRM svarte.
  Sjekk `OSRM_BASE_URL`, `GOOGLE_ROUTES_API_KEY` og tidsavbruddene.
- **Ingen trafikk:** uten `GOOGLE_ROUTES_API_KEY` er ETA alltid OSRM eller
  haversine. OpenStreetMap har ikke sanntidstrafikk. Sjekk også at
  `ROUTE_ALLOW_OVERTIME`/`ROUTING_PROVIDER=haversine` ikke slår av eksterne
  kall, og at `GOOGLE_ROUTES_RATE_LIMIT_PER_MINUTE` ikke er `0`.
- **Alle visiter havner i `missing_skills`** betyr at montøren ikke har
  gyldig kompetanse registrert, eller at `technicianSkillIds` er tom.
- **`overtime_limit`** betyr at ruten ville bryte en konfigurert hard grense,
  ikke at visitten er umulig. Øk `ROUTE_MAX_OVERTIME_MINUTES` eller slå på
  `ROUTE_ALLOW_OVERTIME`.
- **Overtid vises, men ingenting flyttes** er forventet: ruten er et forslag
  til kontoret godkjenner den med «Bruk rekkefølge».
