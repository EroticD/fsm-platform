# Sikkerhet

## Støttede versjoner

Sikkerhetsoppdateringer gis for nyeste kode på `master` og for siste utgitte
versjon. Eldre versjoner må oppgraderes for å få rettelser.

## Rapportere en sårbarhet

Ikke opprett en offentlig issue. Bruk **Security → Report a vulnerability** i
GitHub-repoet, som oppretter en privat sikkerhetsrådgivning. Kan du ikke bruke
det, send e-post til <garshol@duck.com>.

Ta gjerne med:

- hva sårbarheten er, og hvilken del av appen den gjelder
- steg for å reprodusere
- mulig konsekvens
- forslag til retting hvis du har det

Du får svar så raskt som mulig, normalt innen noen dager. Ikke del detaljene
offentlig før en rettelse er publisert.

## Omfang

Aktuelle områder:

- innlogging, økter, invitasjoner og tilbakestilling av passord
- autorisasjon og rollegrenser (innebygde roller `ADMIN`, `OFFICE`, `TECHNICIAN`,
  `USER` og `CUSTOMER`, samt roller admin oppretter)
- opplasting og visning av filer under `/uploads`
- server actions og API-ruter
- PDF-generering og tekstuttrekk/OCR
- XSS, SQL-injeksjon og lekkasje av hemmeligheter eller persondata

## Sikkerhetsnotater for drift

- `.env` skal aldri committes eller deles. Roter `NEXTAUTH_SECRET` og
  databasepassordet hvis de kan ha vært eksponert.
- Kjør bak en reverse proxy med TLS, og sett `NEXTAUTH_URL` til den offentlige
  `https://`-adressen.
- Begrens størrelsen på forespørsler i proxyen. Appen godtar inntil 100 MB per
  opplasting.
- Kjør én app-instans, eller flytt innloggingsbegrensningen og PDF-køen til
  delte tjenester. Begge ligger i minnet i app-prosessen.
- Ta sikkerhetskopier med `scripts/backup.sh`, og oppbevar dem et annet sted enn
  maskinen appen kjører på.
