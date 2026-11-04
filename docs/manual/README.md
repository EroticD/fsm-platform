# FSM-brukermanual

Kildene ligger i `nb/` og `en/`. Hver fil er en egen del av manualen, slik at
enkelte kapitler kan oppdateres uten å redigere hele dokumentet.

- `00-*` – introduksjon, systemoversikt og tverrgående flyter
- `10-*` – kontor
- `20-*` – tekniker
- `30-*` – administrator
- `90-*` – oppslag, begreper og feilsøking

Bygg PDF-ene med:

```bash
npm run manual:build
```

Dette lager:

- `docs/manual/FSM-brukermanual-nb.pdf`
- `docs/manual/FSM-user-manual-en.pdf`

Bygget krever `md2html` (Discount), `pdfunite` (poppler-utils) og
Chromium/Playwright. PDF-ene skal regenereres når markdownfilene endres.
