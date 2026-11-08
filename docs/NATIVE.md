# Native feltapp (Android og iOS)

Feltappen finnes både som installerbar PWA og som et tynt Capacitor-skal for
Android og iOS. Skallet pakker ikke Next.js-appen som statiske filer: appen er
server-rendret og trenger API, økter, database og offline-endepunkter. WebView-en
laster derfor en FSM-installasjon som brukeren velger ved første oppstart.

## Viktig endring: serveradressen er ikke bygget inn

Tidligere måtte `CAPACITOR_SERVER_URL` settes før `npx cap sync`. Det er ikke
lenger nødvendig, og variabelen brukes ikke av appen.

- Første oppstart viser en lokal oppsettside i `capacitor-shell/index.html`.
- Brukeren skriver inn URL-en til FSM-plattformen, for eksempel
  `https://felt.firma.no`.
- Adressen valideres, lagres i native lagring (Android `SharedPreferences`,
  iOS `UserDefaults`) og brukes ved neste oppstart.
- Adressen kan endres fra **Innstillinger → Server** eller fra innloggingssiden
  med **Bytt server**. Appen går da tilbake til oppsettsiden.
- Samme app kan dermed brukes mot flere installasjoner uten å bygges på nytt.

## Arkitektur

- `capacitor.config.ts` – app-id, appnavn, bakgrunnsfarge og felles
  WebView-innstillinger. `server.url` settes ved kjøring, ikke her.
- `capacitor-shell/index.html` – lokal oppsettside med URL-skjema, validering og
  hjelpetekst.
- `android/` – ferdig generert Android-prosjekt. `MainActivity` bygger
  Capacitor-konfigurasjonen på nytt ved oppstart og bruker lagret serveradresse.
  `ServerConfigPlugin` leser/lagrer/fjerner adressen.
- `ios/` – ferdig generert Xcode-prosjekt. `FSMBridgeViewController` setter
  `server.url` fra `UserDefaults`, og `ServerConfigPlugin` gjør samme jobb som
  på Android.
- `scripts/generate-mobile-assets.mjs` – genererer ikoner og splash fra
  `public/favicon.svg`.

Når adressen er satt, lastes FSM-appen i WebView-en. Den arver PWA-ens
service worker, offline-kladder, PIN-lås, kamera, kart og `tel:`/`geo:`-lenker.
Native bro brukes bare til servervalg og til å kjenne igjen at appen kjører
native.

## Krav

- Node.js 22 eller nyere.
- Android: JDK 21, Android SDK 36 og Android Studio (eller kommandolinje).
- iOS: macOS med Xcode 16 eller nyere. iOS kan ikke bygges på Linux.
- FSM-installasjonen må være tilgjengelig fra telefonen. Bruk HTTPS i
  produksjon. HTTP er bare ment for lokal testing.

### Serverforutsetninger

- `NEXTAUTH_URL` må peke på den samme offentlige adressen som appen bruker.
- `AUTH_TRUST_HOST=true` når appen kjøres bak proxy eller i container.
- Gyldig TLS-sertifikat for produksjon. Appen tillater HTTP for lokal testing,
  men viser en advarsel i oppsettsiden.
- `NEXT_PUBLIC_OFFLINE_DRAFT_MAX_AGE_DAYS` kan økes hvis kladder skal leve
  lenger enn standarden. Side-, API- og filcachen har fast 7 døgn.

## Første gangs oppsett

```bash
npm ci
npx cap sync
```

Android- og iOS-prosjektene er allerede generert og sjekket inn. Hvis de må
genereres på nytt:

```bash
npx cap add android
# På macOS:
npx cap add ios
npm run native:sync
```

`native:sync` kopierer skallfilene og oppdaterer native avhengigheter. Den
trenger ingen serveradresse.

## Android – bygge og teste

```bash
npx cap sync android
cd android
./gradlew assembleDebug
```

APK-en ligger i `android/app/build/outputs/apk/debug/app-debug.apk`. Installer
den på en emulator eller telefon:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### Lokal server på Android-emulator

Service workers krever en sikker kontekst. `10.0.2.2` regnes ikke som
`localhost`, så bruk `adb reverse` og `http://localhost:3000`:

```bash
adb reverse tcp:3000 tcp:3000
npm run build
npm run start   # eller npm run dev for rask testing uten service worker
```

Skriv `http://localhost:3000` i oppsettsiden. For test på fysisk telefon kan du
bruke maskinens LAN-adresse, for eksempel `http://192.168.1.20:3000`; appen
tillater HTTP for private adresser, men service worker virker bare i sikker
kontekst. Bruk HTTPS eller `adb reverse` for å teste offline-cachen.

### Release-bygg

1. Lag en egen upload-keystore og legg `keystore.properties` utenfor git.
2. Konfigurer `signingConfigs` i `android/app/build.gradle`.
3. Bygg AAB med `./gradlew bundleRelease`.
4. Last opp til Google Play Console.

Versjonen settes i `android/app/build.gradle` (`versionCode`/`versionName`).

## iOS – bygge og teste

På macOS:

```bash
npx cap sync ios
npx cap open ios
```

Velg simulator eller enhet i Xcode og kjør. For lokal server på simulatoren:

```bash
npm run build
npm run start   # eller npm run dev
```

Skriv `http://localhost:3000` i oppsettsiden. iOS tillater lokal HTTP i
WebView gjennom `NSAllowsLocalNetworking` og
`NSAllowsArbitraryLoadsInWebContent`. Produksjon skal bruke HTTPS.

### Release-bygg

1. Apple Development/Distribution-sertifikat og provisioning profile.
2. App Store Connect-app med bundle-id `no.fsm.felt`.
3. Signer i Xcode eller med `xcodebuild -exportArchive`.
4. Fyll ut personvernerklæring, aldersgrense, databehandleravtale og
   skjermbilder i App Store Connect.

Versjonen settes i Xcode-prosjektet (`MARKETING_VERSION` /
`CURRENT_PROJECT_VERSION`).

## Offline-cache i 7 døgn

Service workeren i `public/sw.js` cacher:

- alle samme-opprinnelse GET-sider, både HTML og RSC-payload;
- API-GET som ikke er auth, eksport, cron, webhooks, SCIM, helse eller metrics;
- filer under `/uploads/` (bilder, dokumenter, PDF-er);
- statiske filer og offline-siden cache-first.

Hver oppføring har et tidsstempel og serveres i **7 døgn**. Etter det slettes
den og hentes på nytt fra serveren. Cacheene er brukerscopede
(`fsm-pages-v1:<userId>`, `fsm-api-v1:<userId>`, `fsm-files-v1:<userId>`) og
slettes ved utlogging, utløpt økt og «Bytt server». Appen ber også om
`navigator.storage.persist()` slik at nettleseren beholder dataene under
lagringspress.

Forhåndslasting skjer for `/`, `/oppdrag`, `/kalender`, `/kunder`,
`/mine-oppdrag`, `/rapporter` og `/dokumenter` etter innlogging. Andre sider
caches når de besøkes.

### Sikkerhetsforbehold

- Cachede HTML-/API-svar er ikke kryptert av service workeren. De er beskyttet
  av enhetens lås, appens PIN-lås og sletting ved utlogging/utløpt økt. På en
  delt enhet bør brukeren logge ut eller bruke «Bytt server» før enheten
  overlates.
- Bare GET caches. Innlogging, skjemainnsending og offline-synk går alltid mot
  serveren.
- Store filer kan fylles av enhetens lagringskvote. Service workeren begrenser
  antall oppføringer per cache og sletter de eldste først.

## Hva som gjenstår før butikk

Kildekoden, native prosjektene, servervalg, ikoner, offline-cache og
testoppsett er på plass. Før butikkpublisering gjenstår:

1. **Signering:** Android-keystore og Apple-sertifikater.
2. **Push:** FCM/APNs er ikke konfigurert. Vanlige varsler i appen, e-post og
   SMS fungerer som før.
3. **Butikkinnhold:** ikoner, skjermbilder, personvernerklæring,
   databehandleravtale, aldersgrense og beskrivelse.
4. **Enhets-test:** kamera/QR, filopplasting, geolokasjon, dyp lenke og
   offline-gjenoppretting på fysiske enheter.
5. **Eventuell MDM/enterprise-distribusjon:** Android Managed Google Play eller
   Apple Business Manager.

## Test-sjekkliste

- [ ] Første oppstart viser oppsettsiden, ikke en hardkodet server.
- [ ] Ugyldig URL og HTTP mot offentlig vert avvises med tydelig feil.
- [ ] Gyldig HTTPS-URL lagres og FSM-appen lastes.
- [ ] Appen starter direkte mot lagret server etter omstart.
- [ ] «Bytt server» på innloggingssiden og i innstillinger gir oppsettsiden.
- [ ] Innlogging, SSO og kundeportal fungerer i WebView.
- [ ] Kamera/QR og bildepålegg ber om tillatelse og virker.
- [ ] Geokoding, kart og `geo:`/`tel:`-lenker virker.
- [ ] Flymodus: tidligere besøkte sider, API-data og filer vises.
- [ ] Data eldre enn 7 døgn serveres ikke fra cache.
- [ ] Utlogging og «Bytt server» sletter cachede data.
- [ ] Android back-knapp og iOS-swipe navigerer riktig.

## Sikkerhet

- Bruk alltid HTTPS i produksjon. `cleartext` er bare for lokal testing.
- Ikke legg signeringsfiler, `keystore.properties`, `google-services.json` eller
  `GoogleService-Info.plist` i git.
- Native skallet omgår ikke autorisasjon. Alle sider og API-kall krever fortsatt
  innlogging, og skannede koder slås opp på serveren med brukerens rettigheter.
