# Tilbud og fakturering

Tilbud og fakturering er egne moduler. De må være slått på av administrator før
sidene `/tilbud` og `/faktura` er tilgjengelige.

## Tilbud

1. Velg **Tilbud → Nytt tilbud**.
2. Velg kunde, eventuelt kontaktperson, oppdrag, avtale og utstyr.
3. Legg inn linjer med antall, pris og MVA. Totalene regnes ut av systemet.
4. Lagre kladden. Kladden kan redigeres og versjoneres.
5. Send tilbudet. En kortlivet godkjenningslenke vises; del den med kunden.
6. Kunden godkjenner eller avslår i nettleseren uten innlogging.
7. Et godkjent tilbud kan konverteres til oppdrag. Kunden gjenbrukes, og utstyr
   kobles til oppdraget.

En lenke kan bare brukes én gang. Utløpte tilbud må sendes på nytt.

## Faktura

1. Velg **Faktura → Ny faktura**.
2. Velg kunde og eventuelt fullført oppdrag, rapport eller godkjent tilbud.
3. Legg inn linjer. Fakturaen lagres som kladd.
4. Send fakturaen. Da tildeles et unikt fakturanummer, og linjene fryses.
5. Registrer betaling manuelt med beløp, dato, metode og referanse.
   Delbetaling er støttet.
6. Ved behov kan du registrere en kreditnota. Kreditnotaen kan ikke overstige
   utestående beløp.
7. Forfalte fakturaer kan oppdateres manuelt eller av en planlagt jobb.

Systemet har ingen kortbetaling eller ekstern betalingsleverandør i denne
versjonen. Kunden betaler via bankoverføring og oppgir fakturanummeret som
referanse. Regnskap kan laste ned CSV fra fakturalisten.

## Kundeportalen

Kunder kan se egne sendte fakturaer og betalingsstatus på
`/kundeportal/faktura` når både portal- og faktureringsmodulen er på. Kunder
kan ikke betale med kort i portalen.
