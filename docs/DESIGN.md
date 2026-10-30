# DESIGN — Field Pulse / Command Center

**Status:** designretning for dagens kode og målbildet; tabellen skiller dem.

**Språk:** norsk bokmål, engelsk paritet. **Flater:** Command Center (kontor)
og Field Pulse (felt).

| Område | I dag | Målbilde |
| --- | --- | --- |
| Tokens | `--ink` … `--surface`, `.office-*`, `.field-*` | `--field-line`, fokusring per flate |
| Kontor | Store unntakskort, kø, tavle og 21rem rail | Samme mønster på alle kontorflater |
| Felt | `field-app`, hero, 56 px CTA, papirark | 64 px CTA, offline-merking, kartfaner |
| Merke | Nål med hake i `brand.ts`, header, favicon og PWA-ikoner | Samme geometri i alle flater; statusfarge bare på kart |
| Kart | Statusfargede pins og branded cluster | Popup og liste viser samme data |

Målbilde skal ikke omtales som ferdig før det er verifisert med skjermbilder.

---

## 1. Merke og logo

### 1.1 Geometri

Merket er en **kartnål med en hake**: nålen sier «sted», haken «utført». Formen
ligger i `src/lib/brand.ts`.

| Element | Verdi | Regel |
| --- | --- | --- |
| Rutenett / flis | 64 × 64; `BRAND_TILE_RADIUS` 15 | 23 % radius |
| Nål | `BRAND_PIN_PATH`, y 7,5 → 59 | Statusfarge på kart |
| Hake | `BRAND_CHECK_PATH` | Utsparing eller kontrastfarge |
| Hakestroke | 6,6 | Rund cap/join |

### 1.2 Lockup

Standard er **lime flis + ink nål + lime hake**; haken er en utsparing og får
flisens farge.

| Variant | Flis | Nål | Hake | Bruk |
| --- | --- | --- | --- | --- |
| Standard | `--signal` | `--ink` | `--signal` | Header, favicon, PWA |
| Felt/mørk | `--signal` | `--ink` | `--signal` | Uendret på mørkt |
| Monokrom | `--ink` | `--paper` | `--ink` | Trykk, stempler |

- **Clear space** 25 % av flishøyden (16/64). **Minimum** flis 24 px, full
  lockup 96 px; under 24 px brukes nålen uten flis.
- **Header** 36 px flis, 12 px gap, ordmerke `800` uppercase, sekundærlinje i
  `--muted`/`paper/60`.
- **Ikke** strek, gradient, skygge på haken, rotert nål, rød hake, nål uten
  hake eller nålen som mønster.

### 1.3 Favicon og PWA

| Asset | Størrelse | Innhold |
| --- | --- | --- |
| `favicon.svg` / `.ico`, `apple-touch-icon.png` | vektor, 16/32/48/96; 180 | Flis + nål + hake |
| `android-chrome-*.png` | 192, 512 | `purpose: "any"` |
| `maskable-512x512.png` | 512 | Nål innenfor 80 % sikker sone |

`manifest.ts` henter `background_color` og `theme_color` fra samme palett.
Navy/amber-filene er arv og regenereres fra `brand.ts`.

### 1.4 Kartpins

Kartmarkøren er **samme nål**, ikke et rundt punkt. Status ligger i fyllet,
aldri i hakens form.

| Status | Fyll | Hake | Kontur |
| --- | --- | --- | --- |
| Forfalt | `--risk` | `--ink` | 2 px `--paper` |
| I dag | `--signal` | `--ink` | 2 px `--ink` |
| Pågår | `--ink` | `--signal` | 2 px `--paper` |
| Planlagt / ikke tildelt | `--paper` | `--ink` | 2 px `--ink` |
| Fullført | `--muted` | `--paper` | 1 px `--paper` |

- 28–32 px ved zoom 14, 36–40 px ved zoom 18, treffflate 44 × 44. Valgt pin
  skaleres 1,15 med `--paper`-ring og popup.
- **Cluster** ink avrundet firkant (merkevareflisen), `--signal` tall og ring,
  liten nålespiss; skal ikke se ut som et enkeltoppdrag.
- **Popup** `--surface`, 16 px radius, tittel 15/20 `700`, meta 12/16 `--muted`,
  én `signal-button`, maks én sekundær lenke.
- Pin og liste viser samme data; status skrives med ord.

---

## 2. Farger

**Signalgult = handling eller fremdrift. Rødt = risiko. Alt annet er nøytralt.**

| Token | Hex | Rolle | Regel |
| --- | --- | --- | --- |
| `--ink` | `#101310` | Tekst, primærknapp, nål | 16,3:1 mot paper |
| `--paper` | `#f2efe6` | Tekst på mørkt, ark | 16,3:1 mot ink |
| `--signal` | `#d8ff3e` | Handling, aktiv, fremdrift | Maks én flate per viewport |
| `--risk` | `#f04427` | Alarmflate: skinne, prikk, ring | Hvit tekst kun ≥ 18,66 px `700` |
| `--risk-text` | `#b42318` | Risikotekst/-ikon på lyst | 5,7:1 mot paper; `text-risk` |
| `--muted` | `#62685f` | Sekundærtekst, metadata | 5,0:1 mot paper; min 12 px |
| `--line` | `#dedcd1` | Kant og skillelinje på lyst | Ikke tekst |
| `--canvas` | `#f4f5f2` | Kontorsidens bakgrunn | Aldri kortflate |
| `--field` | `#0b0e0b` | Feltsidens bakgrunn | 16,9:1 mot paper |
| `--field-card` | `#151a14` | Feltkort og hero | 15,4:1 mot paper |
| `--surface` | `#fffdf8` | Kontorkort, ark, popup | 5,6:1 for muted |

**Kontrast:** brødtekst ≥ 4,5:1, titler ≥ 3:1, betydningsbærende ikon ≥ 3:1,
fokusring ≥ 3:1. Hvitt på `--risk` er 3,8:1 og bare tillatt ved ≥ 24 px eller
≥ 18,66 px `700`; små etiketter bruker `--ink` (5,0:1) eller `--risk-text` på
lys tint.

**Semantisk status** (arbeidsflyt, ikke prioritet):

| Status | Flate | Tekst/kant | Merknad |
| --- | --- | --- | --- |
| Åpen / Planlagt | `--surface` | `--ink`, `--line` | Nøytral |
| Pågår | `--signal` | `--ink` | Eneste status med signal |
| Venter | `#fdf5e4` | `#7a4f0c` | Amber, aldri rød |
| Fullført | `#eef7d6` | `#283509` | Dempet, ikke signal |
| Kansellert | `#fbe9e7` | `--risk-text` | Risiko, ikke alarm |
| Forfalt (kø) | `#fdf4f2` | `--risk-text` | Prioritet, ikke status |

**Kontor / felt:** kontor er `--canvas` + `--surface` + `--line`. Felt er
`--field` + `--field-card` + `#2a3328`, som skal bli `--field-line`. Felt
bruker aldri `--surface` som sidebakgrunn; kontor aldri `--signal` bak mer enn
én handling.

**Ikke:** signal som dekor, hover eller ikonfyll; rød som aksent på knapper,
faner eller illustrasjon; to signalflater i samme synsfelt (unntak: CTA + én
ring); ren `#fff` som kortflate; tenant-farger på feltflater; rå hex uten token.

---

## 3. Typografi

**Open Sans** lastes med `next/font/google` (`subsets: ["latin"]`,
`display: "swap"`, variabel 300–800) som `--font-sans`. Mono er systemstack
(`--font-mono`) for serienumre, ordrenumre og koder.

| Rolle | Størrelse / høyde | Vekt | Sporing | Bruk |
| --- | --- | --- | --- | --- |
| `display` | 56/60 (mobil 40/44) | 800 | −0,03em | Én `<h1>` per flate |
| `title-1` | 32/38 (mobil 28/34) | 800 | −0,02em | Indresiders `<h1>` |
| `title-2` | 24/32 | 800 | −0,01em | Seksjon, hero-tittel |
| `title-3` | 18/24 | 700 | 0 | Kort, popup, kolonne |
| `body` | 16/24 | 400 | 0 | Brødtekst, skjemafelt |
| `ui` | 14/20 | 600 | 0 | Knapper, kørader, tabeller |
| `meta` | 13/18 | 600 | 0 | Dato, kunde, hjelpetekst |
| `eyebrow` | 12/16 | 700 | +0,14em, uppercase | Seksjonslabel |
| `eyebrow-field` | 12/16 | 800 | +0,20em, uppercase | «NESTE», «FORFALT» |
| `micro` | 12/16 | 600 | +0,02em | **Gulv.** Aldri under 12 px |

- **Line height** 1,5 body, 1,25–1,3 titler, 1,2 knapper.
- **Maks linjelengde:** prosa 68 tegn, korttekst 52, rail 38, tabellcelle 32 før
  trunkering med `title`/`aria-label`.
- **Tall:** `tabular-nums` på tellere, datoer, klokkeslett, prosent og KPI;
  ordrenumre, serienumre og koder i `--font-mono`. Klokke skrives `09:00`,
  aldri `9.00` eller `9 AM`.
- **Ikke:** `font-black` utenfor display/tittel, kursiv som eneste meningsbærer,
  versaler i løpende setninger.

---

## 4. Layout og spacing

**Rytme:** 4 px rutenett, 8 px standardsprang. Skala `4, 8, 12, 16, 20, 24, 32,
40, 48, 64`.

| Element | Verdi |
| --- | --- |
| Kortradius | 16 px (`rounded-card`) |
| Kontrollradius | 10 px knapper, 12 px felt |
| Minste trykkflate | 44 × 44 px (`pointer: coarse` håndheves globalt) |
| Felt CTA primær | 64 px høy, full bredde |
| Felt sekundær | 56 px høy |
| Kontorknapp | 44 px høy, 10 px radius |

**Kontor ≥ 1024 px:** maks 1440 px, 32 px margin, 12 kolonner. Grid
`minmax(0, 1fr) 21rem`, gap 24 px; rail 336 px med «Neste handling», fremdrift
og team, uten egen scroll. Under 1024 px: neste handling → kø → fremdrift → team.

**Mobil:** referanse 390 × 844, minimum 320 px. Gutter 16 px ved 390, 12 px ved
320. Bunnfane 64 px + `env(safe-area-inset-bottom)`; innhold får samme
`padding-bottom`. Hero-CTA ligger i flyten, ikke fast over fanen, unntatt under
700 px høyde.

**Brytepunkter:** felt ≤ 820 px, kontor ≥ 821 px; `lg` (1024 px) styrer
rail/navigasjon. Test 320, 390, 428, 768, 820, 821, 1024, 1440.

**Overflow og safe areas:** `min-width: 0` på grid/flex-barn med tekst. Ingen
horisontal scroll på sidenivå; tabeller og tavler scroller i egen
`overflow-x-auto`-region med `aria-label`. Lange ord brytes i titler, trunkeres
i knapper. Topp bruker `env(safe-area-inset-top)`, bunn
`max(1rem, env(safe-area-inset-bottom))`. Sticky CTA skjules når et felt har
fokus, så tastaturet ikke dekkes.

---

## 5. UX-prinsipper

1. **Én neste handling.** Én `field-cta`/`signal-button` per flate, maks to
   sekundære. Destruktivt er aldri primært.
2. **Fitts.** Primær i tommelbuen nederst, 64 px full bredde; sekundær 56 px;
   aldri under 44 px.
3. **Von Restorff.** Maks én lime flate og én rød alarm per skjermbilde.
4. **Goal-Gradient.** Ring, «2 igjen» og gjenstående antall. Fullføring er det
   mest markerte øyeblikket (Peak-End).
5. **Doherty.** Neste handling over folden på 1440 × 900 og 390 × 844, ett
   trykk fra liste.
6. **Felt først, kontor rolig.** Felt: mørkt, stort, få valg, hansker og sol.
   Kontor: lyst, tett, mange rader, uten aksent.
7. **Liste/tavle, delbar URL.** `?vis=liste` (standard) og `?vis=tavle`; modus,
   filter, sortering og søk i URL-en, overlever refresh og tilbakeknapp.
   Statusfiltre flyttes til `?status=`.
8. **Progressiv avsløring.** Kort → ark → detalj. Ett overlegg om gangen;
   skjema lastes først etter valgt oppdrag.
9. **Køsemantikk.** Forfalt > i dag > ikke tildelt, ett oppdrag vises én gang.
   Maks 5 per gruppe, 15 totalt; «vis alle (N)» viser databasetotalen.
10. **Sortering.** Forfalt: eldste `scheduledFor`. I dag: klokke stigende,
    udaterte sist. Ikke tildelt: dato stigende, null sist. Vises som tekst
    («Eldste først»).
11. **Tilstander inline.** Tom/laster/feil der innholdet skulle stått. Skeleton
    matcher formen. Feil: `role="alert"`, navngitt handling, «Prøv igjen». Tom
    tilstand skal ikke påstå «alt er gjort» når ledige finnes.
12. **Offline/PWA.** «Oppdatert 09:41» på sist kjente data; banner «Offline –
    kladder lagres lokalt». Ikke «sendt» før serverbekreftelse. Utboksen viser
    ventende.
13. **Bevegelse.** 120–180 ms, `ease-out`, `opacity`/`transform`. Flytter aldri
    fokus. Redusert bevegelse fjerner alt unntatt tilstandsskifte.
14. **Tilgjengelighet.** 2 px fokusring, 2 px offset (ink lyst, signal mørkt).
    `<label>` på alle felt. Status = tekst + prikk. `scope`/`caption` i
    tabeller. Dialog fanger og returnerer fokus. 200 % zoom.
15. **Dataærlighet.** Ingen oppdiktede ETA-er, tider, datoer eller avstander.
    Mangler tid: «Tid ikke satt», ikke `09:00`. Mangler koordinater: ingen
    avstand. Null ≠ «ukjent». Relativ tid har absolutt dato i `title`.

---

## 6. Komponenter

| Komponent | Anatomi | Regler |
| --- | --- | --- |
| **Knapp** | 44/56/64 px, 10–12 px radius, ikon 16–20 px | `signal-button` primær, `ink-button` sekundær, outline tertiary, rød bare i bekreftelse |
| **Statuspill** | 6 px prikk + tekst, 9999 px, 12/16 `700` | Tekst alltid med; aldri farge alene |
| **Unntakskort** | Eyebrow, stort tall, undertekst, markør | 4 i bredden, 2 på mobil. Forfalt = ink flate med rød markør, i dag = signal, resten `--surface`. Hele kortet er lenke |
| **KPI-kort** | Label, tall, undertekst | 3 i bredden, 24 px tall, ingen aksent |
| **Kørad** | Dato/klokke, tittel, kunde, status, tekniker, chevron | ≥ 64 px. Forfalt: `#fdf4f2` bakgrunn, 2 px rød venstrekant. Hele raden er treffflate |
| **Tavlekolonne** | Tittel, antall, «eldste først», kort | 320 px, egen scroll. Kolonner = prioritet; pill = arbeidsflytstatus. Tom kolonne har tekst, ikke illustrasjon |
| **Neste handling** | Eyebrow, tittel, kunde, én signal-CTA, én sekundær | Maks én per flate. Tom: hake + «Ingen forfalte oppdrag» + lenke til alle |
| **Fremdrift** | Ring 1/3, «2 igjen», linje, «Fritt 10:00» | Heltallsprosent; `aria-valuenow` og tekstlig label |
| **Team i dag** | Initialer, navn, `1/3`, stolpe | Sortert på belastning, deretter navn. Initialer `aria-hidden`. Kapasitet = planlagte oppdrag, ikke timer |
| **Kartpin/popup** | Se §1.4 | Popup og liste deler data |
| **Feltark** | `field-sheet`, 16 px radius, papir | «Senere i dag» og historikk. Maks ett åpent om gangen |

Tavlekolonne, kartpin og popup er målbilde; øvrige rader finnes helt eller delvis.

---

## 7. Innhold og tone

- **Norsk bokmål er standard.** Engelske strenger i `messages/en.json` med
  samme nøkkel; `npm run check:i18n` skal være grønn.
- **Korte handlingsverb:** «Start skjema», «Tildel», «Ring», «Kart», «Ta
  oppdrag», «Fullfør». Ikke «Klikk her», ikke «Vennligst».
- **Setningskasus** i titler og knapper; uppercase bare i eyebrows.
- **Ingen sjargong:** «oppdrag» (ikke «WO»), «montør» (ikke «ressurs»), «ikke
  tildelt» (ikke «uallokert»), «forfalt» (ikke «overskredet SLA»).
- **Dato og tid:** ISO `2026-10-29` i logger, eksport og metadata; lang form i
  titler; klokke `HH:MM` i `Europe/Oslo`.
- **Tall:** `nb-NO`-format, hardt mellomrom mellom tall og enhet (`3 oppdrag`),
  «1 forfalt» – ikke «1 forfalte». Komma i norsk, punktum i engelsk.
- **Risiko og fare:** si hva som skjer. «Sletter kunden og alle oppdrag. Kan
  ikke angres.» Knappen gjentar verbet: «Slett kunde». Aldri «OK»/«Ja».
- **Ærlighet i tall:** databasetotaler, avkortede lister merkes («vises 5
  av 12»), ingen avstand uten koordinater.

---

## 8. Governance

1. **Token-first.** Bruk tokens i `globals.css` (`--ink`, `--signal`,
   `--field-card`, `--surface`, `rounded-card`, `shadow-card`).
2. **Rå hex er forbudt** med mindre verdien mangler i tokenlaget og legges til
   i samme PR. Kjente avvik: `#2a3328` (feltkant → `--field-line`) og
   datadrevne taggfarger (via `readableTextColor`).
3. **Ingen Tailwind-palettfarger** (`gray-*`, `blue-*`, `amber-*`). Semantiske
   farger (`info`, `success`, `warning`, `danger`) er forbeholdt tilstander
   utenfor feltpaletten.
4. **Tenant-branding** (`--primary-color`) gjelder kontor og kundeportal, ikke
   Field Pulse.
5. **Verifisering før merge:**

```bash
npm run typecheck && npm run lint && npm run check:i18n
npx playwright test e2e/a11y.spec.ts
npm run screenshots && npm run screenshots:verify   # 1440×900, 390×844
```

6. **Manuell sjekk:** 320/390/820/821/1440 uten overflow, én primærhandling,
   kontrast på muted, fokusring på mørkt, redusert bevegelse, ingen oppdiktet
   tid eller dato.
7. **Endringslogg** med dato, begrunnelse og valgt bort.

| # | Dato | Beslutning | Begrunnelse |
| --- | --- | --- | --- |
| D1 | 2026-10-29 | Felt mørkt, kontor lyst | Lesbarhet i sol og tydelig rolle-skille. Lys feltmodus er neste iterasjon |
| D2 | 2026-10-29 | Én primærhandling per skjerm | Doherty + Fitts. Funksjonsparitet valgt bort |
| D3 | 2026-10-29 | `?vis=liste\|tavle` eier `vis`; filter → `?status=` | Delbar tilstand uten skjult localStorage. `?vis=forfalte` migreres |
| D4 | 2026-10-29 | Rail 21rem | Plass til to knapper i «Neste handling» på 1440 |
| D5 | 2026-10-29 | Signal = handling, rødt = risiko | Von Restorff. Dekorativ aksent fjernet |
| D6 | 2026-10-29 | Geometri i `brand.ts` | Én kilde til formen; farge varierer med status |
| D7 | 2026-10-29 | Kart uten kart-SDK | Ingen API-nøkkel; listen er sannhetskilden |
| D8 | 2026-10-29 | Open Sans + system-mono | Én fontnedlasting; koder trenger ikke webfont |
| D9 | 2026-10-30 | Dataærlighet foran visuell fylde | Manglende tid/dato/avstand vises som «ikke satt». `09:00`-fallback fjernes |
