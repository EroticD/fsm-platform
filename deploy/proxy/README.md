# Reverse proxy

FSM-plattformen skal ikke eksponeres direkte. Proxyen avslutter TLS og
**overskriver** videresendingsheaderne før trafikken når `127.0.0.1:3000`.

Eksempler:

- [`Caddyfile`](./Caddyfile) – én Caddy-prosess foran appen.
- [`nginx.conf`](./nginx.conf) – nginx med Certbot-utfordring.

## TRUST_PROXY og TRUST_PROXY_HOPS

Sett i `.env`:

```dotenv
TRUST_PROXY=true
TRUST_PROXY_HOPS=1
```

`TRUST_PROXY_HOPS` er antallet proxyer mellom klienten og appen, ikke antallet
`X-Forwarded-For`-oppføringer. Appen leser den N-te oppføringen fra høyre:

| Oppsett | X-Forwarded-For sett fra appen | Riktig verdi |
| --- | --- | --- |
| Én proxy | `spoof, klient` | `TRUST_PROXY_HOPS=1` |
| To proxyer | `spoof, klient, proxy1` | `TRUST_PROXY_HOPS=2` |
| Tre proxyer | `spoof, klient, proxy1, proxy2` | `TRUST_PROXY_HOPS=3` |

Bare den ytterste proxyen skal overskrive `X-Forwarded-For`. Indre proxyer må
appendere klientadressen (eller sin egen adresse) til kjeden. Hvis en indre
proxy også overskriver, forsvinner klientadressen, og appen faller tilbake til
«ukjent IP» – den bruker aldri en verdi klienten kan ha sendt.

Produksjon nekter å starte når `TRUST_PROXY=true` uten et eksplisitt
`TRUST_PROXY_HOPS`, eller når hopp er satt uten at proxy er betrodd.

## Hvorfor overskrive, ikke legge til?

`X-Forwarded-For` er en vanlig header klienten kan sende selv. Hvis proxyen
legger til i en eksisterende liste, kan klienten plante en falsk adresse
lenger til venstre. Appen tar bare verdien rett bak de betrodde hoppene, men
den enkleste og sikreste konfigurasjonen er at kantsonen alltid overskriver
headeren.

## Tidsavbrudd og body-grense

- `client_max_body_size` / `request_body max_size`: **55 MB** globalt. Appen
  godtar 50 MB PDF pluss multipart-overhead og svarer selv med 413.
- Kundeimport (`/api/innstillinger/kunder/import…`) har **520m / 520MiB**.
  Appen tar imot en ZIP på opptil 500 MiB og har en hard grense på 512 MiB for
  hele forespørselsbodyen (`experimental.proxyClientMaxBodySize` i
  `next.config.ts`). Uten en egen grense ville den globale 55 MB-grensen gitt
  413 i proxyen før appen fikk svart, og brukeren ville sett en generisk
  proxyfeil i stedet for appens forklarende feil. De 8 MiB ekstra er slakk for
  multipart-overhead, slik at appen fortsatt er den som avviser for store
  pakker.
  - nginx bruker prefikset `^~ /api/innstillinger/kunder/import` (uten
    avsluttende skråstrek), fordi POST-en går til stien uten `/` på slutten.
  - Caddy bruker `handle /api/innstillinger/kunder/import*`; `handle` er
    terminerende, så de to blokkene kan ikke begge kjøre.
  - Enheter: nginx `m` og Caddy `MiB` er 2^20 byte. Caddy `MB` er 10^6 byte –
    520 MB ville vært ~496 MiB, altså under appens grense.
- `proxy_read_timeout` / `response_header_timeout`: **300 s** for PDF/OCR.
- `proxy_connect_timeout` / `dial_timeout`: **5 s**.
- nginx har `proxy_request_buffering on`, så en stor import bufres midlertidig
  til disk før den sendes videre. Sett av plass i `client_body_temp_path`
  (typisk `/var/lib/nginx/body`) for minst én maksimal import per samtidig
  opplasting.

Test etter endring:

```bash
# Direkte på appen skal X-Forwarded-For ikke påvirke noe når TRUST_PROXY=false.
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/health

# Gjennom proxyen: bekreft at headeren overskrives.
curl -sS -H 'X-Forwarded-For: 6.6.6.6' https://fsm.example.com/api/health
```

Se `docs/OPERATIONS.md` («Proxy og klient-IP») for hvordan du verifiserer at
en spoofet header ikke endrer rate-limit-nøkkelen.
