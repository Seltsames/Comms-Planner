-- ============================================================
-- Migration 00044: corrige los nombres de índice PAX que la 00043 erró
-- ============================================================
-- En pax los índices llevan prefijo — pax_idx_audience_campaign_id — mientras
-- que en drv no. La 00043 los nombró sin prefijo y, al usar IF EXISTS, no
-- borró nada y tampoco protestó.
--
-- Lección: IF EXISTS convierte un nombre equivocado en un no-op silencioso.
-- Por eso esta migración VERIFICA el resultado en lugar de confiar en él, y
-- de paso comprueba que sigue existiendo el índice del que dependen los
-- EXISTS por índice de 00040/00041 (sin él, los chequeos de PAX volverían a
-- escalar con el tamaño del cohorte).
-- ============================================================

DO $fix$
DECLARE v_restantes int;
BEGIN
  DROP INDEX IF EXISTS pax.pax_idx_audience_campaign_id;  -- redundante con el único
  DROP INDEX IF EXISTS pax.pax_idx_audience_city_code;    -- prácticamente sin uso

  SELECT count(*) INTO v_restantes FROM pg_indexes
  WHERE schemaname = 'pax' AND tablename = 'campaign_audience'
    AND indexname IN ('pax_idx_audience_campaign_id', 'pax_idx_audience_city_code');

  IF v_restantes > 0 THEN
    RAISE EXCEPTION 'Quedaron % índices PAX sin eliminar.', v_restantes;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'pax'
                 AND tablename = 'campaign_audience'
                 AND indexname = 'pax_idx_audience_pax_id') THEN
    RAISE EXCEPTION 'Falta pax_idx_audience_pax_id: los chequeos de PAX serían lentos.';
  END IF;
END
$fix$;
