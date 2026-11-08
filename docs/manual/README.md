# FSM-brukermanual

Kildene ligger i `nb/` og `en/`. Hver fil er en egen del av manualen, slik at
enkelte kapitler kan oppdateres uten å redigere hele dokumentet.

- `00-*` – introduksjon, systemoversikt og tverrgående flyter
- `10-*` – kontor
- `20-*` – tekniker
- `30-*` – administrator
- `31-*` – SSO og SCIM
- `40-*` – tilbud, fakturering og regnskap
- `90-*` – oppslag, begreper og feilsøking

## Bilder og figurer

Skjermbilder til manualen ligger under `screenshots/manual/`, og
sidebilder fra den generelle skjermbildefangsten ligger under
`screenshots/pages/`. Referer til bilder med vanlig Markdown-syntaks:

```markdown
![Dashbordet med listevisning](../../../screenshots/manual/nb/kontor-dashbord-liste.png)
```

- Stien løses relativt til Markdown-filen som inneholder referansen.
- Stier som starter med `/`, for eksempel `/screenshots/manual/nb/...`, løses
  fra repo-roten.
- Bygget leser bildet og bytter ut kilden med en base64 data-URI før
  `md2html` konverterer filen. Chromium trenger derfor ikke filsystemtilgang
  eller en bestemt base-URL for å rendre bildet.
- Støttede formater: `.jpg`, `.jpeg`, `.png`, `.webp` og `.svg`.
- Eksterne `http(s)`-bilder og eksisterende `data:`-URI-er beholdes uendret,
  men bør unngås i PDF-manualen fordi de gjør bygget avhengig av nettverk.
- Mangler en bildefil, stopper bygget med en feil som viser Markdown-filen,
  kilden og den forventede absolutte stien.

Bruk alltid beskrivende alt-tekst. Markdown-bilder blir vanlige `<img>`-elementer.
Trenger du bildetekst, kan du bruke en rå HTML-figur; bygget inliner også
`<img src="...">` inne i HTML, og verifiseringen sjekker både Markdown- og
HTML-referanser:

```html
<figure>
  <img src="../../../screenshots/manual/nb/kontor-dashbord-liste.png" alt="Dashbordet med listevisning" />
  <figcaption>Dashbordet med listevisning og prioritert kø.</figcaption>
</figure>
```

Print-CSS-en gir bilder `max-width: 100%`, automatisk høyde, ramme, avrundede
hjørner, svak skygge og `break-inside: avoid`. `figure` og `figcaption` har egne
stiler. Svært høye skjermbilder begrenses også i høyden, slik at de ikke renner
over A4-siden; ta heller et fokusert utsnitt enn et fullsidebilde når detaljene
blir uleselige.

## Filnavn og fokus

Bruk små bokstaver, bindestrek og en kort beskrivelse av **fokuset** i bildet –
ikke bare sidenavnet. Fokuset skal si hva leseren skal legge merke til.

```text
screenshots/manual/<locale>/<kapittel>-<fokus>[-<variant>].<ext>
```

Eksempler:

```text
screenshots/manual/nb/kontor-dashbord-liste.png
screenshots/manual/nb/kontor-oppdrag-tildel-montor.png
screenshots/manual/nb/tekniker-skjema-signatur.png
screenshots/manual/en/office-dashboard-board.png
screenshots/manual/nb/kontor-dashbord-liste-mobil.png
```

- `locale` er `nb` eller `en`.
- `kapittel` gjenspeiler manualdelen, for eksempel `kontor`, `tekniker`,
  `administrator` eller `kundeportal`.
- `fokus` er tilstanden eller handlingen bildet viser, for eksempel
  `tildel-montor`, `signatur` eller `feilmelding`.
- `variant` brukes bare når samme fokus finnes i flere visninger, for eksempel
  `mobil`.
- Unngå mellomrom, store bokstaver, versjonsnumre og generiske navn som
  `bilde1.png`.

Verifiseringen håndhever ikke navnemønsteret, men navnene gjør det enklere å se
hvilke bilder som er i bruk og hvilke som er foreldreløse.

## Manifest for manuelle skjermbilder

Alle filer under `screenshots/manual/` skal være oppført i
`screenshots/manual/manifest.json`. Filer som ikke lenger brukes i Markdown må
være eksplisitt merket som ubrukte, med en kort begrunnelse:

```json
{
  "version": 1,
  "screenshots": [
    {
      "file": "screenshots/manual/nb/kontor-dashbord-liste.png",
      "locale": "nb",
      "focus": "dashbord-liste",
      "usedIn": ["docs/manual/nb/10-kontor.md"]
    },
    {
      "file": "screenshots/manual/nb/eldre-dashbord.png",
      "unused": true,
      "reason": "Erstattet av kontor-dashbord-liste.png"
    }
  ]
}
```

Verifiseringen leser manifestet rekursivt og godtar flere vanlige varianter:
lister eller objekter, feltene `file`, `path`, `image` eller `src`, og
markeringer som `unused: true`, `used: false`, `status: "unused"` eller en
toppnivåliste med `unused`. `file` bør være repo-relativ, men stier relativt til
`screenshots/manual/` godtas også. Alle stier manifestet peker på må finnes og
være ikke-tomme.

## Bygg og verifiser

```bash
npm run manual:verify   # sjekker bilder, manifest og foreldreløse filer
npm run manual:build    # lager PDF-ene
npm run manual:all      # verifiser først, deretter bygg
```

Bygget lager:

- `docs/manual/FSM-brukermanual-nb.pdf`
- `docs/manual/FSM-user-manual-en.pdf`

`manual:build` krever `md2html` (Discount), `pdfunite` (poppler-utils) og
Chromium/Playwright. PDF-ene skal regenereres når markdownfilene eller bildene
endres. `manual:verify` krever bare Node.

Testene for bildeinnlineren og verifiseringen kan kjøres uten produksjonsbilder:

```bash
node --test scripts/tests/test-manual-tools.test.mjs
```

Testene lager midlertidige fixtures med små PNG-filer, og verken leser eller
skriver de ekte skjermbildene.

## Feilsøking

| Symptom | Årsak og løsning |
| --- | --- |
| `Mangler bildefil «...» referert fra ...` | Stien i Markdown stemmer ikke med filen. Feilen viser både kilden og forventet absolutt sti. Rett stien eller legg til bildet. |
| `Bildeformatet «.gif» støttes ikke` | Konverter til PNG, JPEG, WebP eller SVG. |
| `Mangler screenshots/manual/manifest.json` | Skjermbilder finnes eller er referert, men manifestet mangler. Opprett det med alle filene. |
| `Manifestet peker på en fil som ikke finnes` | Manifestet er ikke oppdatert etter at et bilde ble slettet eller flyttet. Rett eller fjern oppføringen. |
| `... verken er brukt eller merket ubrukt` | Legg bildet inn i riktig Markdown-fil, eller marker det med `"unused": true` og en begrunnelse i manifestet. |
| Bildet er tomt eller vises ikke i PDF-en | Sjekk at filen er ikke-tom og har støttet format. Eksterne bilder beholdes som URL-er og kan feile uten nettverk; bruk lokal fil. |
| Et høyt skjermbilde blir lite | Bygget begrenser bildets høyde for å holde seg innenfor A4. Ta et fokusert utsnitt eller et skjermbilde av en mindre del av siden. |
| `Mangler «md2html»` / `Mangler «pdfunite»` | Installer Discount og poppler-utils, eller bygg i CI-imaget som har verktøyene. |

Verifiseringen kan også kjøres mot en midlertidig fixture utenfor repoet:

```bash
node scripts/verify-manual-screenshots.mjs --root /tmp/min-manual
```

Da forventes `<root>/docs/manual/`, `<root>/screenshots/manual/` og
`<root>/screenshots/manual/manifest.json` under den angitte roten.
