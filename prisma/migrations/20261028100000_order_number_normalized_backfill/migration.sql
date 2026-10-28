-- Backfill av `WorkOrder.orderNumberNormalized` for rader som ble opprettet før
-- normaliseringen ble innført (eller av eldre skript/import).
--
-- Normaliseringen er nøyaktig den samme som i `src/lib/order-number.ts`:
-- trim, store bokstaver og fjern alt som ikke er bokstaver eller tall.
-- `upper()` i PostgreSQL håndterer æ/ø/å, og `[[:alnum:]]` beholder dem.
--
-- Vi oppdaterer aldri `orderNumber` selv – visningsverdien kunden skrev skal
-- forbli urørt. En kollisjon i samme avdeling ville bryte den unike indeksen
-- `(departmentId, orderNumberNormalized)`, så vi stopper hele migreringen før
-- noe skrives og rapporterer hvilke ordrenumre som kolliderer.

DO $$
DECLARE
  conflicts text;
BEGIN
  SELECT string_agg(
           format('avdeling %s: %s (%s rader)', conflict."departmentId", conflict.normalized, conflict.antall),
           '; '
           ORDER BY conflict."departmentId", conflict.normalized
         )
    INTO conflicts
  FROM (
    SELECT
      w."departmentId",
      coalesce(
        nullif(regexp_replace(upper(btrim(w."orderNumber")), '[^[:alnum:]]', '', 'g'), ''),
        w."orderNumberNormalized"
      ) AS normalized,
      count(*) AS antall
    FROM "WorkOrder" w
    WHERE w."orderNumber" IS NOT NULL OR w."orderNumberNormalized" IS NOT NULL
    GROUP BY w."departmentId", coalesce(
      nullif(regexp_replace(upper(btrim(w."orderNumber")), '[^[:alnum:]]', '', 'g'), ''),
      w."orderNumberNormalized"
    )
    HAVING coalesce(
             nullif(regexp_replace(upper(btrim(w."orderNumber")), '[^[:alnum:]]', '', 'g'), ''),
             w."orderNumberNormalized"
           ) IS NOT NULL
       AND count(*) > 1
  ) conflict;

  IF conflicts IS NOT NULL THEN
    RAISE EXCEPTION
      'Ordrenummer-normalisering avbrutt: normaliserte ordrenumre kolliderer i samme avdeling. Rett opp manuelt og kjør migreringen på nytt. Kollisjoner: %',
      conflicts
      USING ERRCODE = 'unique_violation';
  END IF;
END
$$;

UPDATE "WorkOrder"
SET "orderNumberNormalized" =
  nullif(regexp_replace(upper(btrim("orderNumber")), '[^[:alnum:]]', '', 'g'), '')
WHERE "orderNumber" IS NOT NULL
  AND "orderNumberNormalized" IS DISTINCT FROM
      nullif(regexp_replace(upper(btrim("orderNumber")), '[^[:alnum:]]', '', 'g'), '');
