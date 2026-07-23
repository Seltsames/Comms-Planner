-- ============================================================
-- Migration 00043: quitar índices redundantes de campaign_audience
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================
-- Con 470.948 filas la tabla pesaba 222 MB. El desglose sorprende:
--
--   CSV de origen ........  16 bytes/fila  (  7,5 MB)
--   Datos en Postgres ....  84 bytes/fila  ( 38 MB)  -- 5x
--   Índices .............. 410 bytes/fila  (184 MB)  -- 26x, el 83% del total
--
-- Los 84 bytes de datos son normales: cada fila carga un uuid de llave
-- primaria (16) + campaign_id (16) + el id como texto (16) + city_code (9) +
-- 24 bytes de cabecera de fila. El id que importa son 16 de esos 84.
--
-- Los 184 MB de índices no eran normales. Tres de los cinco no aportaban:
--
--   campaign_audience_pkey     27 MB, 0 lecturas — la columna id nunca se
--                              consulta y ninguna FK la referencia
--   idx_audience_campaign_id    7 MB, redundante: el índice único
--                              (campaign_id, drv_id, city_code) ya empieza
--                              por esa columna
--   idx_audience_city_code      6 MB, 1 lectura
--
-- La columna id se conserva; sólo se suelta la restricción y su índice, así
-- que revertir es un CREATE INDEX.
--
-- Además, los dos índices que sí se usan estaban hinchados por cargas
-- repetidas. Reconstruirlos los redujo a menos de la mitad:
--
--   REINDEX INDEX drv.idx_audience_drv_id;                                -- 35 MB -> 14 MB
--   REINDEX INDEX drv.campaign_audience_campaign_id_drv_id_city_code_key; -- 109 MB -> 27 MB
--
-- El REINDEX no va en la migración a propósito: construye el índice nuevo
-- antes de soltar el viejo, así que necesita espacio libre. Hay que correrlo
-- a mano, DESPUÉS de los DROP de abajo y del más pequeño al más grande, o
-- falla por falta de disco. Genera además bastante WAL (ver HANDOFF.md).
--
-- Resultado: tabla de 222 MB -> 79 MB.
-- ============================================================

ALTER TABLE drv.campaign_audience DROP CONSTRAINT IF EXISTS campaign_audience_pkey;
DROP INDEX IF EXISTS drv.idx_audience_campaign_id;
DROP INDEX IF EXISTS drv.idx_audience_city_code;

ALTER TABLE pax.campaign_audience DROP CONSTRAINT IF EXISTS campaign_audience_pkey;
DROP INDEX IF EXISTS pax.idx_audience_campaign_id;
DROP INDEX IF EXISTS pax.idx_audience_city_code;
