# Native feltapp (Capacitor)

Feltappen er først og fremst en installerbar PWA. I tillegg finnes et tynt
Capacitor-skall for Android og iOS. Skallet pakker ikke Next.js-appen som
statiske filer: appen er server-rendret og trenger API, økter, database og
offline-endepunkter. WebView-en laster derfor den driftede HTTPS-adressen.

## Arkitektur

- `capacitor.config.ts` – app-id, appnavn, bakgrunnsfarge og valgfri
  `CAPACITOR_SERVER_URL`.
- `capacitor-shell/index.html` – lokal hjelpeside som vises hvis skallet bygges
  uten serveradresse.
- `android/` og `ios/` – genereres lokalt med `npx cap add`. De er ikke sjekket
  inn fordi de inneholder maskin- og signeringsspesifikke filer.

Skallet arver PWA-ens manifest, service worker, offline-kladder og PIN-lås fordi
det laster samme HTTPS-opprinnelse. Kamera, kart og telefonnummer åpnes gjennom
WebView-en og de innebygde skjemaene (`geo:`, `tel:`).

## Forutsetninger

- Node.js 22 eller nyere (samme som appen).
- Android: JDK 21 og Android Studio/SDK.
- iOS: macOS med Xcode. iOS kan ikke bygges på Linux.

## Første gangs oppsett

```bash
npm ci
npx cap add android
# På macOS:
npx cap add ios

export CAPACITOR_SERVER_URL=https://felt.example.no
npm run native:sync
```

`native:sync` kopierer skallfilene og oppdaterer native avhengigheter. Uten
`CAPACITOR_SERVER_URL` viser appen hjelpesiden, ikke feltappen.

## Bygge og kjøre

```bash
# Android-debug (signerer med debug-nøkkelen)
npm run native:build:android

# Åpne i Android Studio / Xcode
npm run native:open:android
npm run native:open:ios
```

Produksjonsbygg krever i tillegg:

1. **Android-keystore.** Lag en egen upload-keystore, legg
   `keystore.properties` utenfor git, og konfigurer `signingConfigs` i
   `android/app/build.gradle`. Bygg med `./gradlew bundleRelease` for AAB.
2. **Apple-sertifikater.** Apple Development/Distribution-sertifikat,
   provisioning profile og en App Store Connect-app. Signer i Xcode eller med
   `xcodebuild -exportArchive`.
3. **Kamera-tillatelser.** Android trenger `CAMERA` i manifestet og en
   runtime-forespørsel; iOS trenger `NSCameraUsageDescription`. WebView-en må
   også tillate `getUserMedia` for opprinnelsen. Uten dette faller skanneren
   tilbake til manuell inntasting, som er testet og fungerer.
4. **Push-varsler.** Ingen push-leverandør er konfigurert. FCM (Android) og
   APNs (iOS) krever prosjektnøkler, sertifikater og en serverintegrasjon.
   Vanlige varsler i appen og e-post/SMS går som før.
5. **Butikkoppføring.** Ikoner, skjermbilder, personvernerklæring, aldersgrense,
   databehandleravtale og beskrivelse må fylles ut i Google Play Console og App
   Store Connect.

## Hva som gjenstår i denne kodebasen

Det er ikke mulig å produsere en signert, butikkklar app i dette miljøet:
Android SDK og Xcode mangler, og signeringsnøkler/Apple-sertifikater er ikke
tilgjengelige. Kildekoden, konfigurasjonen, skriptene og denne veiledningen er
på plass; det som gjenstår er plattformbygg, signering, kamera-tillatelser i de
genererte prosjektene, push-oppsett og butikkinnsending.

## Sikkerhet

- Bruk alltid HTTPS i `CAPACITOR_SERVER_URL`. `cleartext` er av.
- Ikke legg signeringsfiler, `keystore.properties`, `google-services.json` eller
  `GoogleService-Info.plist` i git.
- Native skallet omgår ikke autorisasjon. Alle sider og API-kall krever fortsatt
  innlogging, og skannede koder slås opp på serveren med brukerens rettigheter.
