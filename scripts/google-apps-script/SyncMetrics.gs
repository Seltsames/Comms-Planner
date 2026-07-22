/**
 * CommsPlanner — sincroniza métricas (CTR / CTOR) del Sheet a la app.
 *
 * CÓMO INSTALARLO
 * 1. Abre el Google Sheet → Extensiones → Apps Script.
 * 2. Borra el contenido y pega TODO este archivo.
 * 3. En INGEST_SECRET pega el VALOR del secreto que guardaste en Supabase
 *    (Edge Functions → Secrets, en la fila METRICS_INGEST_SECRET: el valor,
 *    no el nombre). Si no lo recuerdas, edita el secreto en Supabase con un
 *    valor nuevo y usa ese mismo aquí.
 * 4. Guarda y ejecuta `syncMetrics` una vez: Google pedirá autorización.
 * 5. (Opcional) Para que corra solo cada día: en Apps Script → Activadores
 *    (reloj) → Añadir activador → función `syncMetrics`, origen "Basado en
 *    tiempo", "Temporizador diario", la hora que prefieras.
 *
 * QUÉ HACE
 * Lee cada hoja cuyo nombre siga el patrón "<PAÍS> - POPE DATA" o
 * "<PAÍS> - AD PLACEMENT DATA", normaliza los números ("7,141" → 7141,
 * "49.73%" → 49.73) y los envía por lotes a la app, que los guarda
 * emparejándolos con la campaña cuyo Event ID sea el campaign_id.
 * Re-ejecutarlo actualiza los datos existentes, no los duplica.
 */

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────
var ENDPOINT = 'https://fvhrvkicplaifbkvyhgj.supabase.co/functions/v1/ingest-metrics';
// ⚠️ Aquí va el VALOR del secreto (la cadena aleatoria que escribiste al
// crearlo en Supabase), NO el nombre "METRICS_INGEST_SECRET".
// Ejemplo de cómo se ve:  var INGEST_SECRET = 'nAiKCZyKi7MYupRxWTjBuLOZQ_ivwpjO';
var INGEST_SECRET = 'PEGA_AQUI_EL_VALOR_DEL_SECRETO';
var BATCH_SIZE = 500;
// ──────────────────────────────────────────────────────────────────────────

/**
 * Prueba rápida de conexión: no lee el Sheet, solo verifica que el
 * secreto coincida con el de Supabase. Ejecútala primero.
 */
function testConnection() {
  var res = post_({ rows: [] });
  if (res.error) {
    ui_('❌ No conecta.\n\n' + res.error + '\n\n' + describeDiag_(res));
  } else {
    ui_('✅ Conexión correcta. Ya puedes ejecutar syncMetrics.');
  }
}

function describeDiag_(res) {
  var d = res && res.diagnostico;
  if (!d) return '';
  return 'Detalle:\n' +
    '· Secreto enviado: ' + (d.secreto_recibido ? 'sí' : 'NO') + '\n' +
    '· Largo enviado: ' + d.largo_recibido + '\n' +
    '· Largo esperado: ' + d.largo_esperado + '\n' +
    '· ' + (d.pista || '');
}

function syncMetrics() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var allRows = [];
  var report = [];

  for (var s = 0; s < sheets.length; s++) {
    var sheet = sheets[s];
    var meta = parseSheetName_(sheet.getName());
    if (!meta) continue; // no es una hoja de datos

    var rows = readSheet_(sheet, meta);
    report.push(sheet.getName() + ': ' + rows.length + ' filas');
    allRows = allRows.concat(rows);
  }

  if (allRows.length === 0) {
    ui_('No se encontraron hojas con datos.\n\nEsperaba nombres como "MX - POPE DATA".');
    return;
  }

  var sent = 0;
  var upserted = 0;
  for (var i = 0; i < allRows.length; i += BATCH_SIZE) {
    var batch = allRows.slice(i, i + BATCH_SIZE);
    var res = post_({ rows: batch });
    if (res.error) {
      ui_('Error enviando datos:\n\n' + res.error + '\n\n' + describeDiag_(res) +
          '\n\nEnviadas antes del fallo: ' + sent);
      return;
    }
    sent += batch.length;
    upserted += (res.upserted || 0);
  }

  ui_('Sincronización completa ✅\n\n' + report.join('\n') +
      '\n\nFilas enviadas: ' + sent + '\nGuardadas: ' + upserted);
}

/** "MX - POPE DATA" → {country:'MX', platform:'POPE'} */
function parseSheetName_(name) {
  var m = String(name).match(/^\s*([A-Za-z]{2})\s*-\s*(POPE|AD\s*PLACEMENT)\s*DATA\s*$/i);
  if (!m) return null;
  return {
    country: m[1].toUpperCase(),
    platform: m[2].toUpperCase().replace(/\s+/g, ' '),
  };
}

function readSheet_(sheet, meta) {
  var values = sheet.getDataRange().getValues();
  if (!values || values.length === 0) return [];

  // El encabezado real no siempre es la fila 1 (el reporte trae filas de
  // títulos arriba): buscamos la fila que contenga "campaign_id".
  var headerRow = -1;
  for (var r = 0; r < Math.min(values.length, 15); r++) {
    var joined = values[r].join('|').toLowerCase();
    if (joined.indexOf('campaign_id') !== -1) { headerRow = r; break; }
  }
  if (headerRow === -1) return [];

  var header = values[headerRow].map(function (h) {
    return String(h).replace(/^﻿/, '').trim().toLowerCase();
  });
  var col = function (name) { return header.indexOf(name.toLowerCase()); };

  var iCampaign = col('campaign_id');
  var iChannel  = col('channel');
  var iUserType = col('user_type');
  if (iCampaign === -1 || iChannel === -1) return [];

  var idx = {
    country:   col('country_code'),
    step:      col('step_id'),
    template:  col('template_id'),
    activity:  col('activity_name'),
    creator:   col('creator'),
    date:      col('start date'),
    week:      col('start week'),
    cohort:    col('cohort size'),
    request:   col('request (uv)'),
    send:      col('send (uv)'),
    deliver:   col('deliver (uv)'),
    arrive:    col('arrive (uv)'),
    show:      col('show (uv)'),
    click:     col('click (uv)'),
    openRate:  col('open rate'),
    ctr:       col('ctr'),
    ctor:      col('ctor')
  };

  var out = [];
  for (var i = headerRow + 1; i < values.length; i++) {
    var row = values[i];
    var campaignId = cleanText_(row[iCampaign]);
    if (!campaignId) continue;

    // La plataforma (drv/pax) sale de user_type; si falta, se infiere del
    // nombre de la hoja no es posible, así que se omite la fila.
    var userType = String(cleanText_(row[iUserType]) || '').toLowerCase();
    if (userType !== 'drv' && userType !== 'pax') continue;

    out.push({
      kind: userType,
      country_code: idx.country >= 0 ? cleanText_(row[idx.country]) || meta.country : meta.country,
      external_campaign_id: campaignId,
      step_id: idx.step >= 0 ? cleanText_(row[idx.step]) : '',
      template_id: idx.template >= 0 ? cleanText_(row[idx.template]) : '',
      channel: cleanText_(row[iChannel]),
      comm_platform: meta.platform,
      activity_name: idx.activity >= 0 ? cleanText_(row[idx.activity]) : '',
      creator: idx.creator >= 0 ? cleanText_(row[idx.creator]) : '',
      start_date: idx.date >= 0 ? toDate_(row[idx.date]) : null,
      start_week: idx.week >= 0 ? toNumber_(row[idx.week]) : null,
      cohort_size: idx.cohort >= 0 ? toNumber_(row[idx.cohort]) : null,
      request_uv: idx.request >= 0 ? toNumber_(row[idx.request]) : null,
      send_uv: idx.send >= 0 ? toNumber_(row[idx.send]) : null,
      deliver_uv: idx.deliver >= 0 ? toNumber_(row[idx.deliver]) : null,
      arrive_uv: idx.arrive >= 0 ? toNumber_(row[idx.arrive]) : null,
      show_uv: idx.show >= 0 ? toNumber_(row[idx.show]) : null,
      click_uv: idx.click >= 0 ? toNumber_(row[idx.click]) : null,
      open_rate: idx.openRate >= 0 ? toPercent_(row[idx.openRate]) : null,
      ctr: idx.ctr >= 0 ? toPercent_(row[idx.ctr]) : null,
      ctor: idx.ctor >= 0 ? toPercent_(row[idx.ctor]) : null
    });
  }
  return out;
}

function cleanText_(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/^﻿/, '').trim();
}

/** "7,141" → 7141 ; 7141 → 7141 ; "" → null */
function toNumber_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  var n = Number(String(v).replace(/[,\s]/g, ''));
  return isNaN(n) ? null : n;
}

/** "49.73%" → 49.73 ; 0.4973 → 49.73 ; "" → null */
function toPercent_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Math.round(v * 10000) / 100; // Sheets guarda % como fracción
  var s = String(v).trim();
  var hadSign = s.indexOf('%') !== -1;
  var n = Number(s.replace(/[%,\s]/g, ''));
  if (isNaN(n)) return null;
  return hadSign ? n : Math.round(n * 10000) / 100;
}

/** Date o "2025-11-01" → "2025-11-01" */
function toDate_(v) {
  if (!v) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var s = String(v).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

function post_(payload) {
  var res = UrlFetchApp.fetch(ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-ingest-secret': INGEST_SECRET },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var text = res.getContentText();
  try { return JSON.parse(text); }
  catch (e) { return { error: 'HTTP ' + res.getResponseCode() + ': ' + text }; }
}

function ui_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); }
  catch (e) { Logger.log(msg); } // sin UI (ejecución por activador)
}
