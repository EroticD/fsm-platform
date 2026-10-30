// i18n-ignore-file: kommunenavn er normaliserte dataoppslag, ikke UI-tekst.
import { normalizeSearchText } from "@/lib/fuzzy";

/**
 * Omtrentlige bysentre for kartvisning.
 *
 * Kunder har i dag ikke lagrede koordinater. Markørene plasseres derfor på
 * kundens by, med en liten deterministisk spredning når flere oppdrag ligger
 * samme sted. Adressen vises i popupen, og oppdraget åpnes med ett klikk.
 */
const CITY_COORDINATES: Record<string, readonly [number, number]> = {
  alesund: [62.4722, 6.1495],
  andalsnes: [62.5667, 7.6833],
  arendal: [58.4615, 8.7725],
  bergen: [60.3913, 5.3221],
  bodo: [67.2804, 14.4049],
  bronnoysund: [65.4749, 12.2116],
  drammen: [59.7439, 10.2045],
  egersund: [58.4513, 5.9997],
  elverum: [60.8819, 11.5623],
  flesberg: [59.8083, 9.0833],
  florø: [61.5996, 5.0328],
  floroe: [61.5996, 5.0328],
  forde: [61.4522, 5.8572],
  førde: [61.4522, 5.8572],
  fosnavag: [62.3436, 5.6331],
  fosnavåg: [62.3436, 5.6331],
  fredrikstad: [59.2181, 10.9298],
  gjovik: [60.7957, 10.6915],
  gjøvik: [60.7957, 10.6915],
  halden: [59.1248, 11.3875],
  hamar: [60.7945, 11.0679],
  haugesund: [59.4138, 5.2680],
  hareid: [62.3710, 6.0264],
  harstad: [68.7983, 16.5415],
  hammerfest: [70.6634, 23.6821],
  honningsvag: [70.9820, 25.9700],
  honningsvåg: [70.9820, 25.9700],
  honefoss: [60.1680, 10.2560],
  hønefoss: [60.1680, 10.2560],
  kirkenes: [69.7270, 30.0450],
  kongsberg: [59.6689, 9.6500],
  kristiansand: [58.1467, 7.9956],
  kristiansund: [63.1103, 7.7279],
  larvik: [59.0533, 10.0352],
  levanger: [63.7464, 11.2996],
  lillehammer: [61.1153, 10.4662],
  molde: [62.7375, 7.1591],
  maloy: [61.9333, 5.1167],
  måløy: [61.9333, 5.1167],
  moss: [59.4340, 10.6577],
  namsos: [64.4662, 11.4957],
  narvik: [68.4385, 17.4273],
  orsta: [62.1980, 6.1280],
  ørsta: [62.1980, 6.1280],
  oslo: [59.9139, 10.7522],
  porsgrunn: [59.1405, 9.6561],
  sandefjord: [59.1311, 10.2166],
  sandnes: [58.8524, 5.7352],
  sarpsborg: [59.2839, 11.1096],
  skien: [59.2096, 9.6090],
  sogndal: [61.2292, 7.0967],
  stavanger: [58.9700, 5.7331],
  steinkjer: [64.0149, 11.4954],
  stjordal: [63.4680, 10.9170],
  stjørdal: [63.4680, 10.9170],
  tromso: [69.6492, 18.9553],
  tromsø: [69.6492, 18.9553],
  trondheim: [63.4305, 10.3951],
  tonsberg: [59.2675, 10.4076],
  tønsberg: [59.2675, 10.4076],
  ulsteinvik: [62.3430, 5.8480],
  volda: [62.1460, 6.0710],
  verdal: [63.7933, 11.4817],
  alexandra: [62.4722, 6.1495],
  "alesund kommune": [62.4722, 6.1495],
};

const CITY_ALIASES: Record<string, string> = {
  "alesund kommune": "alesund",
  "ålesund kommune": "alesund",
  "oslo kommune": "oslo",
  "bergen kommune": "bergen",
  "trondheim kommune": "trondheim",
  "stavanger kommune": "stavanger",
  "tromso kommune": "tromso",
  "tromsø kommune": "tromso",
};

export function cityCoordinates(
  city: string | null | undefined,
): { lat: number; lng: number } | null {
  const normalized = normalizeSearchText(city ?? "");
  if (!normalized) return null;

  const aliased = CITY_ALIASES[normalized] ?? normalized;
  const coordinates = CITY_COORDINATES[aliased] ?? CITY_COORDINATES[normalized];
  if (!coordinates) return null;
  return { lat: coordinates[0], lng: coordinates[1] };
}

/** Gir hvert oppdrag en liten, stabil forskyvning rundt bysenteret. */
export function offsetCityPoint(
  point: { lat: number; lng: number },
  index: number,
): { lat: number; lng: number } {
  if (index === 0) return point;
  const angle = (index * 137.508 * Math.PI) / 180;
  const radius = 0.0045 * Math.sqrt(index);
  return {
    lat: point.lat + Math.cos(angle) * radius,
    lng: point.lng + Math.sin(angle) * radius,
  };
}
