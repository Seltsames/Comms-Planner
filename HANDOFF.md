# CommsPlanner — Traspaso de proyecto

> Estado a **23 jul 2026**. Este documento permite retomar el trabajo en un chat
> nuevo sin contexto previo. Léelo completo antes de tocar nada: hay **trabajo a
> medias** (sección ⚠️ abajo).

---

## Estado actual

**Rama:** `feature/pr-changes` · mocks limpios · build en verde.

Lo último que se construyó fueron las **tarjetas de CTR/CTOR en "Mis campañas"**:

- ✅ Migración `00039` aplicada en producción y su archivo `.sql` en el repo
  (se recuperó con `pg_get_functiondef` y se verificó idéntica byte a byte)
- ✅ Frontend commiteado (`src/lib/queries.ts`, `src/pages/MyCampaigns.tsx`)
- ⏳ **Falta:** PR → merge a `main` → esperar el deploy de Netlify

Para desplegarlo:

```bash
git push -u origin feature/pr-changes && gh pr create --fill && gh pr merge --merge
```

> `gh` está en `~/.local/bin/gh` (puede no estar en el PATH).
> Node necesita `export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"`.

### ⚠️ Antes de cualquier commit: revisa que no haya mocks

Para ver pantallas internas sin login se inyecta un usuario falso (ver
"Cómo verificar cambios en local"). Si eso llega a `main`, producción se rompe.
Antes de commitear, esto debe devolver **vacío**:

```bash
grep -rn "PREVIEW_MOCK" src/ .env.local
```

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

## Migraciones aplicadas (00030 → 00039)

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

---

## Funcionalidades construidas

**Acceso y usuarios**
- Selector "¿De qué equipo eres?" tras login (se omite si solo tiene una plataforma)
- En Gestión de usuarios: "Habilitar…" abre selector Driver / PAX / Ambas
- Chips DRV/PAX por usuario (editables también para admins = define su alcance)

**Builder**
- PAX: sin sub-equipos, 6 equipos propios; DRV: equipo+sub-equipo antes del nombre
- País y ciudades antes de la nomenclatura; listas de ciudades desplegables
- Ad Placement: rango horario libre (desde–hasta), sin franjas por hora
- Canal **Push trigger** (POPE, ambas plataformas): solo se eligen días, sin hora
  (se guarda con `time_slot = 'TRIGGER'`)
- Al guardar: sin modal, va directo al Dashboard

**Campañas**
- Columnas Cohort (impactados) y Plan ID (obligatorio al aprobar push)
- Event IDs múltiples: uno por tipo de comunicación + botón "+"
- Descarga de calendario en **XLSX** con el formato del template de ops
  (Campaign name / User / grilla Platform-Channel-Plan ID × días)

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

---

## Siguientes pasos sugeridos

1. **Desplegar lo pendiente**: PR + merge de `feature/pr-changes` para que las
   tarjetas CTR/CTOR de Mis campañas lleguen a producción.
2. **Poblar Event IDs** en las campañas para que las métricas se vinculen.
3. **Revisar por qué no llegan datos PAX** del Sheet (¿faltan hojas, o la columna
   `user_type` no dice `pax`?). El script omite filas cuyo `user_type` no sea
   exactamente `drv` o `pax`.
4. Opcional, ya conversado pero no implementado:
   - Actualización en vivo con Supabase Realtime (hoy hay polling cada 60 s, y
     Gestión de usuarios ni siquiera lo tiene: solo botón "Refrescar")
   - Que Push trigger exija aprobación manual con Plan ID
   - Inserción por lotes de la audiencia para cohortes > 200k
     (el rol `authenticated` tiene `statement_timeout = 8s`)
