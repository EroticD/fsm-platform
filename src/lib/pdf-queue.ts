/**
 * Bakoverkompatibel inngang til jobbkøen.
 *
 * Køen lå tidligere bare i minnet. Nå ligger jobbene i databasen og kjøres av
 * `job-worker`. Denne modulen beholdes slik at eksisterende imports fra
 * dokumenthandlingene virker uendret.
 */
export { enqueuePdfText } from "@/lib/job-worker";
