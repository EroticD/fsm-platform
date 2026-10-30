/**
 * Den geometriske kjernen i FSM-merket: en kartnål med en hake.
 *
 * Stiene er tegnet i et 64 × 64-rutenett og gjenbrukes av favicon, PWA-ikoner,
 * toppmerket og kartmarkørene. Da er det én kilde til formen, mens fyllfargen
 * kan variere med status på kartet.
 */
export const BRAND_COLORS = {
  ink: "#101310",
  signal: "#d8ff3e",
  paper: "#f2efe6",
  risk: "#f04427",
} as const;

/** Kartnålen. Pinnen går fra y=7,5 til y=59 i 64-rutenettet. */
export const BRAND_PIN_PATH =
  "M32 7.5c-11.6 0-21 9.4-21 21 0 15.6 21 30.5 21 30.5s21-14.9 21-30.5c0-11.6-9.4-21-21-21Z";

/** Haken inne i nålen. */
export const BRAND_CHECK_PATH = "m22.6 29.1 6.7 6.7 13.2-13.2";

/** Firkantet merke med avrundede hjørner, brukt bak nålen i appikonet. */
export const BRAND_TILE_RADIUS = 15;
