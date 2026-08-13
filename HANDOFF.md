# CommsPlanner — Traspaso de proyecto

> Estado a **6 ago 2026**. Este documento permite retomar el trabajo en un chat
> nuevo sin contexto previo. Léelo completo antes de tocar nada.

---

## Estado actual

**Rama:** `feature/pr-changes` (todo se mergea a `main` vía PR) · mocks limpios ·
build en verde · **nada a medias**. Último PR fusionado: **#30**. Último bundle en
producción: `index-EprusqgQ.js`.

Base de datos al día hasta la migración **00049**. Repo y base sincronizados
(todos los `.sql` de 00040–00049 están en `supabase/migrations/`).

### Flujo de trabajo de cada cambio (probado ~30 veces)

1. Editar → `npm run build` (valida tipos). Node:
   `export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"`
2. Cambios de **base**: aplicar con el MCP (`apply_migration`) **y** guardar el
   `.sql` en `supabase/migrations/`.
3. Verificar en el navegador si es UI nueva (patrón del mock, abajo).
4. Commit → push → `~/.local/bin/gh pr create` → `gh pr merge --merge`.
5. Si cambió el frontend, esperar el deploy y confirmar el hash del bundle:
   ```bash
   for i in $(seq 1 20); do H=$(curl -s "https://commsplannerv2.netlify.app/?v=$(date +%s)" | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1); [ "$H" = "<hash-del-build-local>" ] && { echo "$H"; break; }; sleep 15; done
   ```
   Un cambio **solo de base** no cambia el bundle: no hay que esperar deploy.

### ⚠️ Antes de cualquier commit: revisa que no haya mocks

Para ver pantallas internas sin login se inyecta un usuario falso (ver
"Cómo verificar cambios en local"). Si eso llega a `main`, producción se rompe.
Antes de commitear, esto debe devolver **vacío**:

```bash
grep -rn "PREVIEW_MOCK" src/ .env.local
```

> `tsconfig.app.tsbuildinfo` aparece siempre como modificado (caché del
> compilador, tracked por error en un commit viejo). **Nunca lo incluyas** en un
> commit — añade los archivos por nombre, no `git add -A`.

---

## Qué es el proyecto

App para que el equipo de marketing de DiDi Labs planifique comunicaciones a
**conductores (DRV)** y **pasajeros (PAX)** en 8 países. React 18 + TypeScript +
Vite + Tailwind, backend Supabase (Postgres + Auth + Edge Functions), deploy en
Netlify.

| Recurso | Valor |
|---|---|
| Repo | `github.com/Seltsames/Comms-Planner` |
| App en producción | `https://commsplannerv2.netlify.app` |
| Supabase project ref | `fvhrvkicplaifbkvyhgj` |
| Rama de trabajo | `feature/pr-changes` → PRs a `main` |
| Login | Google Workspace, dominio `@didi-labs.com` |

---

## Cómo se despliega (3 canales independientes)

1. **Frontend** → merge de PR a `main`; Netlify reconstruye solo (~2 min).
   Verificar que el bundle cambió:
   ```bash
   curl -s "https://commsplannerv2.netlify.app/?v=$(date +%s)" | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1
   ```
   > Ojo: un merge a `main` NO aplica migraciones ni Edge Functions.

2. **Base de datos** → con el MCP de Supabase (`apply_migration`). Guardar
   siempre una copia del SQL en `supabase/migrations/` para que el repo y la
   base no se desincronicen.

3. **Edge Functions** → con el MCP (`deploy_edge_function`).

### MCP de Supabase

Está configurado en `.mcp.json` (gitignored). Da acceso a `execute_sql`,
`apply_migration`, `deploy_edge_function`, `get_logs`. **Es la herramienta clave
para depurar**: los logs de API revelaron los errores 520 y 403 que el navegador
ocultaba como "CORS".

---

## Arquitectura

**Tres esquemas Postgres**, con DRV y PAX totalmente aislados:

- `public` → identidad (`profiles`, `user_roles`), métricas (`campaign_metrics`) y **todos los RPC**
- `drv` → `campaigns`, `campaign_schedules`, `campaign_audience` (`drv_id`)
- `pax` → idénticas, con `pax_id`

Los RPC están duplicados por lado: `save_campaign_v2` (DRV) / `save_campaign_pax`
(PAX), `approve_campaign` / `approve_campaign_pax`, etc. El cliente despacha al
correcto en `src/lib/queries.ts` según `kind`.

> **PostgREST no expone los esquemas `drv`/`pax`** en Supabase Cloud, por eso
> *toda* lectura pasa por RPCs en `public` (migración `00029`). No intentes
> `supabase.from('drv.campaigns')`, no funciona.

### Permisos

- `profiles.platform_access` (`{drv}`, `{pax}` o ambos) define a qué plataforma
  entra cada usuario. Aplica **también a los admins**: un admin puede ser solo de
  DRV, solo de PAX o de ambas.
- `is_platform_admin(uid, plataforma)` = rol admin **Y** acceso a esa plataforma.
  Lo exigen aprobar/rechazar/eliminar campañas, Event IDs y analítica.
- Un admin **no puede** cambiar su propio acceso (evita auto-bloqueo).

---

## Migraciones aplicadas (00030 → 00049)

| # | Qué hace |
|---|---|
| 00030 | `platform_access` + trigger que impide crear campañas en una plataforma sin acceso |
| 00031 | `plan_id` + conteo de audiencia por campaña + `approve_campaign` con Plan ID |
| 00032 | `event_id` (texto único, luego reemplazado) |
| 00033 | **Fix:** parser de `time_slot` tolerante a rangos `HH:MM-HH:MM` |
| 00034 | Admins con alcance por plataforma (`is_platform_admin`) |
| 00035 | **Fix:** guardar campaña siempre INSERTA (antes sobreescribía por nombre) |
| 00036 | `event_ids` jsonb (varios Event ID por campaña) |
| 00037 | `campaign_metrics` + `get_campaign_metrics` (admin) |
| 00038 | Métricas agregadas por campaña+canal con fórmulas por canal |
| 00039 | `get_my_campaign_metrics` (métricas de mis propias campañas) |
| 00040 | **Subida por lotes:** `begin_campaign_upload` / `append_campaign_audience` / `finalize_campaign_upload` (+`_pax`, +`abort_`). Borrador oculto con `deleted_at`. Parcha `check_cohort_conflicts` y `get_analytics_aggregates` para excluir `draft` |
| 00041 | Las previsualizaciones referencian el cohorte por id: `get_slot_availability_by_cohort`, `check_cohort_conflicts_by_cohort`, `update_campaign_draft` (+`_pax`). Antes mandaban ~9 MB de ids por llamada |
| 00042 | **Fix "No space left on device":** `get_analytics_aggregates` recorta a top-10 antes de armar arreglos. OJO: PAX usa CTE `passenger_totals`/`top_passengers` |
| 00043 | Elimina 3 índices redundantes de `campaign_audience` (pkey con 0 usos, etc.). PAX quedó sin efecto → 00044 |
| 00044 | **Fix de 00043:** los índices PAX llevan prefijo `pax_`; verifica el resultado en vez de confiar en `IF EXISTS` |
| 00045 | **Push autoaprobado:** quita la rama `v_has_push → 'pending'` de las 4 funciones de guardado (revierte la 00020) |
| 00046 | **Bloqueo de franja por >50% del cohorte:** `get_slot_availability_by_cohort` marca `red` sólo si otra campaña que choca en tiempo comparte >50% del cohorte (antes: 1 conductor) |
| 00047 | **`update_campaign` / `update_campaign_pax`:** el admin edita metadatos + canales + ciudades + horarios de una campaña existente, con re-validación de estado |
| 00048 | **Fix timeout:** la re-validación de estado usa un único chequeo (>50%, mismo canal, guiado por `campaign_id`) en vez del Seq Scan de 1,3M filas. Cambia semántica: pending sólo por choque de mismo canal con >50% (aplica a creación y edición) |
| 00049 | **Fix timeout (2):** filtro barato antes del día-bloqueado. Si ningún día llega a 3 horarios push de otras campañas, se salta la agregación de ~5 s |
| 00050 | **Privacidad: audiencia hasheada.** `append_campaign_audience` (+`_pax`) guarda `HMAC-SHA256(id, pepper)` hex en vez del id crudo. Pepper en `private.app_secrets` (esquema no expuesto). Determinista → solapes siguen funcionando. La audiencia con ids crudos se vació con TRUNCATE |

---

## ⚠️ IDs de audiencia hasheados (privacidad) — leer antes de tocar la audiencia

Desde 00050, `campaign_audience.drv_id`/`pax_id` guardan un **HMAC-SHA256 hex**
del id crudo, no el id. El hasheo ocurre **sólo** en `append_campaign_audience`
(el único punto por donde entra un id crudo). Es determinista, así que toda la
lógica de solapes/choques/día-bloqueado sigue igual (compara hash contra hash).

**El pepper** (clave HMAC) vive en **`private.app_secrets`** (`name =
'audience_pepper'`), esquema **no expuesto por PostgREST** y sin permisos para
`authenticated`/`anon`. Es **crítico e irrecuperable**:
- Si se pierde/cambia, **todos los hashes dejan de cruzarse** (los solapes se
  rompen sin avisar) y no se puede saber qué id era cada hash. Un backup de la
  base lo incluye. **No borrar ni cambiar esa fila.**
- No está en el repo ni en ningún log (se generó con `gen_random_bytes` en la
  base). El archivo `00050_*.sql` sólo tiene la expresión, no el valor.

Implicaciones al programar:
- **Nunca** compares un id crudo (de un CSV, de un parámetro) contra
  `campaign_audience` — no coincidirá. Hay que hashearlo primero con el mismo
  pepper (dentro de una función SECURITY DEFINER que lo lea).
- Las funciones viejas de arreglo (`get_slot_availability_v2`,
  `check_cohort_conflicts`) reciben ids crudos y quedaron **muertas** desde
  00041; si alguien las revive, darán resultados vacíos contra datos hasheados.
- La audiencia con ids crudos previos se **borró** (TRUNCATE); las campañas de
  antes de 00050 quedaron con Cohort 0.

---

## Guardado de campañas: la arquitectura ACTUAL (cambió mucho)

El `save_campaign_v2` original **ya no se usa** (queda como función vieja). El
cliente (`saveCampaignRpc` en `queries.ts`) hace ahora, en orden:

1. **`uploadCohortDraft()`** — al validar el CSV en el Builder: crea un borrador
   oculto (`begin_campaign_upload`) y sube la audiencia en **lotes de 25.000**
   (`append_campaign_audience`), con barra de progreso.
2. El Builder referencia ese borrador por `cohortId` para la disponibilidad de
   franjas (`get_slot_availability_by_cohort`) y el preview de conflictos —
   **nunca reenvía los ids**.
3. Al guardar: `update_campaign_draft` (metadatos + horarios) → `finalize_campaign_upload`
   (re-valida estado y limpia `deleted_at`).

**Por qué NO se manda el cohorte en una sola petición:** un cohorte de 469k son
25 MB que Postgres expande a JSON + arreglo de 469k textos + INSERT, ~17 s
contra el `statement_timeout = 8s`, y el pico de memoria **tumbaba la base**
(pasó 3 veces el 2026-07-23). Ni el guardado ni las previsualizaciones pueden
llevar el arreglo de ids completo. Detalle abajo en "Cohortes grandes".

**Regla de estado (aprobado vs pendiente), tras 00045+00048:**
- El sistema **autoaprueba** salvo choque real. No hay regla especial de push.
- Pasa a **`pending`** sólo si otra campaña del **mismo canal** que choca en
  horario (±60 min o día completo) comparte **>50%** del cohorte.
- El **día bloqueado** (3+ push al mismo conductor el mismo día) aborta el
  guardado/edición entera (es un bloqueo duro, no revisión).
- El cliente ya **no** manda `status:"pending"` fijo — deja decidir a la base.
- La columna `plan_id` sigue en la BD (histórico) pero se quitó de la UI.

---

## Funcionalidades construidas

**Acceso y usuarios**
- Selector "¿De qué equipo eres?" tras login (se omite si solo tiene una plataforma)
- En Gestión de usuarios: "Habilitar…" abre selector Driver / PAX / Ambas
- Chips DRV/PAX por usuario (editables también para admins = define su alcance)

**Builder**
- Equipos DRV en `DRV_TEAMS_HIERARCHY` (`constants.ts`): Brand Connection,
  Growth, Engagement, Experience (con sub-equipos) + **Índigo** y **AR HUB**
  (planos, `subTeams: []`). La UI oculta el selector de sub-equipo si está vacío.
- PAX: sin sub-equipos, 6 equipos propios; DRV: equipo+sub-equipo antes del nombre
- País y ciudades antes de la nomenclatura; listas de ciudades desplegables
- Ad Placement: rango horario libre (desde–hasta), sin franjas por hora
- Canal **Push trigger** (POPE, ambas plataformas): solo se eligen días, sin hora
  (se guarda con `time_slot = 'TRIGGER'`)
- Al guardar: sin modal, va directo al Dashboard

**Campañas (Gestión de campañas — `AdminCampaigns.tsx`)**
Vista **única** que muestra DRV y PAX juntos (filtro por chips). Cada fila lleva
`kind`; los modales y RPC despachan por él, así que **todo funciona en ambas
plataformas** sin duplicar código. Es una ruta compartida `/admin/campaigns` que
lleva la plataforma en `?kind` (ver trampa #7).
- Columna **Cohort** (impactados). La columna Plan ID **se quitó** (00045).
- Columna **Usuario**: sólo el nombre (antes email).
- Columna **Progreso**: `On going` / `Concluded` (concluded = última comm
  terminó hace +24 h; sólo aprobadas). Se calcula en el cliente desde
  `campaign_schedules`.
- Columna **Fechas** en dos filas (inicio / fin).
- Columna **Canales**: botón que abre `CampaignSchedulesModal` con los horarios
  específicos por canal (fecha + hora), no "toda la campaña".
- Botón **Editar** → `CampaignEditModal`: cambia nombre/equipo/tipos/canales/
  ciudades/fechas/horarios (NO el cohorte). Reúsa el `TimeSlotPicker` con
  `cohortId = id de la campaña`. Al guardar re-valida el estado (00047/00048).
- Event IDs múltiples: uno por tipo de comunicación + botón "+".
- Descarga de calendario en **XLSX** (formato del template de ops), en Mis campañas.

**Dashboard**
- Separado por plataforma (calendario y análisis nunca mezclan DRV/PAX)
- Ad Placement se muestra en filas por rango horario (no en la grilla de horas)
- Clic en celda → popup con campaña, usuario, país e impactados

**Métricas (CTR/CTOR)**
- Google Sheet → Apps Script → Edge Function `ingest-metrics` → `campaign_metrics`
- Análisis: tarjetas de ponderado (general + por canal) y tabla de rendimiento
- Buscador por Event ID

---

## Integración de métricas: cómo funciona

**Flujo:** el Sheet "CEi Comms Governance" tiene hojas `"<PAÍS> - POPE DATA"` y
`"<PAÍS> - AD PLACEMENT DATA"`. El script `scripts/google-apps-script/SyncMetrics.gs`
las lee y las empuja a la Edge Function `ingest-metrics`.

**La unión con las campañas** es por el `campaign_id` del reporte, que debe estar
cargado como **Event ID** en la campaña. Sin eso, la métrica aparece pero marcada
"sin vincular".

**Autenticación:** Apps Script no puede tener sesión de Supabase, así que la
función usa `verify_jwt=false` + un secreto compartido `METRICS_INGEST_SECRET`
(en Supabase → Edge Functions → Secrets, y el mismo valor en el script). En el
script va el **valor**, no el nombre del secreto.

### ⚠️ Fórmulas de CTR/CTOR (verificadas contra los datos reales)

No son iguales para todos los canales. "Received" en el reporte = columna
**Request (UV)**:

| Canal | CTR | CTOR |
|---|---|---|
| Push (IPUSH, IPUSH_OPUSH, SMS…) | Click / Request | Click / Show |
| **WhatsApp y Mail** | **Show / Request** | **Show / Arrive** |

WhatsApp **no registra clics** (siempre 0): si se usa la fórmula de push, su CTR
sale 0% y parece un error de datos. No lo "arregles" volviendo a clics.

**Agregación:** una campaña se parte en muchas filas (`step_id`, `template_id`,
fechas). Se suman los contadores y se recalculan las tasas — promedio **ponderado
por volumen**, no promedio de porcentajes.

**Nombres de canal:** `g_dri_homepage_popup` → "Pop Up",
`g_dri_homepage_xpanel_new` → "XPanel" (`channelLabel()` en `channelStyles.ts`).

**Estado actual:** 2.198 filas sincronizadas (MX/CO/AR, nov–dic 2025), todas DRV.
0 vinculadas, porque ninguna campaña de la app tiene esos `campaign_id` como
Event ID todavía. No hay datos PAX.

---

## Cómo verificar cambios en local (patrón del mock)

La app exige login de Google, así que para ver pantallas internas se inyecta
temporalmente un usuario falso:

1. En `src/lib/auth.tsx`, antes de `AuthProvider`, añadir un `mockUser()` que
   devuelva un usuario si `import.meta.env.VITE_PREVIEW_MOCK` está definido;
   inicializar `useState(() => mockUser())` y `useState(!PREVIEW_MOCK)`, y
   añadir `if (PREVIEW_MOCK) return;` al inicio del `useEffect` de bootstrap.
2. Añadir datos falsos donde haga falta (el mock no tiene sesión real, así que
   las consultas a Supabase fallan).
3. `echo 'VITE_PREVIEW_MOCK=admin' >> .env.local`
4. Verificar en el navegador.
5. **Revertir todo** antes de commitear.

> El mock se usó en casi todas las rondas. Es la causa del riesgo descrito en la
> sección ⚠️ del inicio.

---

## Cohortes grandes: por qué la audiencia se sube por lotes

Guardar un cohorte real (469.325 conductores) en una sola petición **tumba la
base**, no solo falla. Medido en producción el 2026-07-23:

| | |
|---|---|
| Cuerpo de la petición | 25 MB |
| Parseo + ids distintos | 3.453 ms |
| INSERT de la audiencia | ~13.600 ms (~34.400 filas/seg) |
| **Total** | **~17 s** contra `statement_timeout` = **8 s** |

El pico de memoria (JSON parseado + arreglo de 469k textos + INSERT, todos a la
vez) provocó dos reinicios por apagado sucio. Se reprodujo tres veces.

**Subir `statement_timeout` no sirve**: el temporizador se arma al inicio de la
sentencia, así que un `SET` dentro de la función no lo re-arma (probado). Y más
tiempo solo significa acumular más memoria antes de caer.

La migración **00040** parte la subida en tres fases (`begin` → N × `append` →
`finalize`), con lotes de 25.000 filas (~1,4 MB, ~0,7 s cada uno). Es invisible
para quien usa la app: un CSV, un clic, una barra de progreso.

**El borrador se oculta con `deleted_at`**, no con un filtro nuevo: así queda
invisible en todas las funciones que ya filtran ese campo, sin tocarlas.
`finalize` lo limpia. Solo hubo que parchear `check_cohort_conflicts` y
`get_analytics_aggregates`, que no filtraban nada.

**Los tres chequeos de conflicto se reescribieron.** Antes recibían el arreglo
de ids y hacían `= ANY(...)`, con costo proporcional al cohorte (28 s en total).
Ahora agregan primero sobre las campañas existentes (pocas filas) y solo después
cruzan contra la audiencia ya cargada, por índice: 3.234 ms → 11 ms y
17.430 ms → 3 ms. El chequeo de día bloqueado **necesita el CTE `MATERIALIZED`**;
sin él el planificador arranca por la tabla grande y tarda ~10 s.

### Espacio en disco: el límite real

Una campaña de 469k conductores ocupaba **222 MB**, de los cuales sólo 38 MB
eran datos. Tras la 00043 y un `REINDEX` manual quedó en **79 MB**.

| | Por fila | Total |
|---|---|---|
| CSV de origen | 16 bytes | 7,5 MB |
| Datos en Postgres | 84 bytes | 38 MB |
| Índices (antes) | 410 bytes | 184 MB |
| Índices (después) | ~91 bytes | 41 MB |

**El WAL compite por el mismo disco.** Tras cargar un cohorte grande y
reindexar, `pg_ls_waldir()` mostró **384 MB de WAL — más que la base entera
(227 MB)**. Mientras esté ahí no hay espacio para los archivos temporales que
necesita `get_analytics_aggregates`, y el dashboard devuelve ceros. Se recicla
solo en los checkpoints automáticos (~5 min); `CHECKPOINT` **no se puede
forzar** (Supabase no expone el rol `pg_checkpoint`). Si tras media hora sigue
alto, buscar un slot de replicación reteniéndolo.

> Diagnóstico rápido cuando el dashboard muestre ceros:
> ```sql
> select pg_size_pretty(sum(size)), count(*) from pg_ls_waldir();
> select pg_size_pretty(pg_database_size(current_database()));
> ```

> ⚠️ El proyecto está en **plan Free**. La instancia es pequeña y es la razón de
> fondo de las caídas. Free tampoco permite ramas (`create_branch` da
> `PaymentRequiredException`), así que **no hay entorno aislado para pruebas de
> carga**. No hagas pruebas de volumen contra producción: tumban la app. Si
> hacen falta, primero hay que subir a Pro.

> La tabla de audiencia crecerá ~469k filas por campaña (~23M filas al año,
> del orden de 3 GB con índices). Conviene una política de purga.

## Trampas conocidas (aprendidas a golpes)

1. **Los errores "CORS" del navegador casi nunca son CORS.** Un `520` o un
   `Failed to fetch` significa que el servidor murió. Revisa siempre
   `get_logs(service: "api")` con el MCP para ver el status real.
2. **El payload de guardado explotaba a 284 MB**: `buildAudience()` repetía el
   cohorte general por cada ciudad. Ya está corregido, pero cuidado al tocar esa
   función.
3. **Un merge a `main` no despliega base de datos ni Edge Functions.** Son
   canales separados.
4. **`campaign_metrics` tiene RLS sin políticas**: solo se lee por los RPC
   (SECURITY DEFINER). Un `select` directo devuelve vacío, no es un bug.
5. El reporte puede traer **filas duplicadas** con la misma clave; se combinan
   sumando (Postgres rechaza upsert de la misma clave dos veces por lote).
6. **Parchear funciones grandes por regexp** sobre `pg_get_functiondef()` en un
   bloque `DO` (patrón de 00040/00045/00048/00049): idempotente, y con una
   guarda que **falla ruidosamente** si el patrón no aparece. Contá cuántas
   parchaste y aborta si no son las esperadas — un `replace` que no encuentra su
   patrón es un no-op silencioso. **PAX casi siempre difiere**: índices con
   prefijo `pax_`, CTE con otro nombre (`passenger_totals`), columna `pax_id`.
   Verificá el resultado, no confíes en `IF EXISTS`/`replace` (lección de 00043).
7. **Rutas de admin llevan la plataforma en `?kind`, no en el path.** `/admin/*`
   es compartido entre DRV y PAX. El navbar lee `?kind` en rutas `/admin` para no
   saltar a "Driver"; los enlaces de admin lo añaden. Si tocás el navbar o esas
   rutas, mantené `?kind`.
8. **El `statement_timeout` del rol `authenticated` es 8 s y NO se puede subir
   por función** (el temporizador se arma al inicio de la sentencia; probado).
   Cualquier RPC que cruce audiencias de 469k debe: guiarse por `campaign_id`
   (usa el índice único, ~0,5 s por par de cohortes), no por `= ANY(arreglo)`
   (Seq Scan de 1,3M filas); y anteponer filtros baratos sobre `campaign_schedules`
   antes de agregar audiencia. Medir SIEMPRE el peor caso con
   `SET LOCAL statement_timeout='8s'` en una transacción con `ROLLBACK`.
9. **Verificación en local con datos:** el mock no tiene sesión, así que las RPC
   fallan. Para ver una pantalla con datos hay que mockear también los hooks de
   datos (ej. `fetchAllCampaignsBoth`, `fetchCampaignSchedules`) tras el flag
   `VITE_PREVIEW_MOCK`. Recordá quitar TODOS esos mocks + el de `auth.tsx`
   (`git checkout -- src/lib/auth.tsx`) + la línea de `.env.local` antes de
   commitear.

---

## Siguientes pasos sugeridos

1. **Poblar Event IDs** en las campañas para que las métricas se vinculen (sin
   eso, CTR/CTOR aparecen "sin vincular").
2. **Revisar por qué no llegan datos PAX** del Sheet de métricas (¿faltan hojas,
   o la columna `user_type` no dice exactamente `pax`?). El script omite filas
   cuyo `user_type` no sea `drv` o `pax`.
3. **Subir a Supabase Pro** — es la deuda de fondo. Free = instancia chica (causa
   de las caídas), sin ramas para pruebas de carga, disco de 500 MB que una
   campaña de 469k (~79 MB) más el WAL ya aprietan. Ver "plan Free" abajo.
4. **Optimizar `get_slot_availability_by_cohort`** con el mismo filtro barato de
   00049: hoy tarda ~1,7 s con un cohorte de 469k (no da timeout, pero el
   selector de horarios del Builder/editor se siente lento). Mismo día-bloqueado
   agregando audiencia push.
5. Opcional, ya conversado:
   - Actualización en vivo con Supabase Realtime (hoy polling cada 60 s;
     Gestión de usuarios solo tiene botón "Refrescar").
   - Alerta de campaña finalizada por **correo/push** real (hoy es sólo in-app:
     columna Progreso). Requiere proveedor + cron; no existe canal saliente.
   - Editar el **cohorte** en el modal de edición (hoy no se puede; para cambiar
     el público se crea otra campaña).
