// server.js
import express from 'express';
import bodyParser from 'body-parser';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config as dotenvConfig } from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

import {
  upsertAsistenteByDni,
  getAsistenteByUUID,
  setPago,
  marcarImpresion,
  registrarAcceso,
  listAll
} from './airtable.js';

dotenvConfig();

const app  = express();
const port = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// --------- Middlewares base ----------
app.use(bodyParser.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --------- Respaldo local CSV si Airtable cae ----------
const FALLBACK_DIR  = path.join(__dirname, 'fallback');
const FALLBACK_FILE = path.join(FALLBACK_DIR, 'respaldo.csv');
if (!fs.existsSync(FALLBACK_DIR)) fs.mkdirSync(FALLBACK_DIR, { recursive: true });

// (Opcional) token admin simple (si no está definido en .env, se deja pasar)
function requireAdminToken(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!process.env.ADMIN_API_TOKEN) return next();
  if (!token || token !== process.env.ADMIN_API_TOKEN) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
}

// --------- Healthcheck para Render u otros ----------
app.get('/healthz', (_, res) => res.type('text').send('ok'));

// ================== ENDPOINTS ==================

// 1) Importar Excel maestro
const upload = multer({ dest: 'uploads/' });
app.post('/api/import', requireAdminToken, upload.single('excel'), async (req, res) => {
  try {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(req.file.path);
    const ws = workbook.worksheets[0];

    const headers = {};
    ws.getRow(1).eachCell((cell, col) => {
      headers[col] = String(cell.value || '').toLowerCase().trim();
    });

    let count = 0;
    for (let i = 2; i <= ws.rowCount; i++) {
      const row = ws.getRow(i);
      const record = {};
      row.eachCell((cell, col) => {
        const key = headers[col];
        if (key) record[key] = (cell.value ?? '').toString().trim();
      });

      if (!record.dni) continue;
      if (!record.uuid) record.uuid = uuidv4();
      if (!record.estado_pago) record.estado_pago = 'NO_PAGADO';
      record.correo = record.correo || '';
      record.pais   = record.pais   || '';

      // NUEVO: normalizar descripción desde posibles encabezados
      record.descripcion = (
        record.descripcion ||
        record['descripción'] ||
        record.description ||
        record.detalle ||
        record.detalles ||
        record.nota ||
        record.notas ||
        record.observaciones ||
        record.observacion ||
        ''
      ).toString().trim();

      await upsertAsistenteByDni(record); // upsert por DNI
      count++;
    }

    fs.unlinkSync(req.file.path);
    res.json({ success: true, imported: count });
  } catch (err) {
    console.error(err);
    try { if (req.file?.path) fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ success: false, message: 'Error importando', error: err.message });
  }
});

// 2) Alta nueva (solo sede)
app.post('/api/register', async (req, res) => {
  const {
    dni, nombres, apellidos, institucion,
    puesto,
    correo = '',
    pais   = '',
    descripcion = '',
    estado_pago,
    sede_alta
  } = req.body || {};

  if (!dni || !nombres) {
    return res.status(400).json({ success: false, message: 'dni y nombres son obligatorios' });
  }

  try {
    const rec = await upsertAsistenteByDni({
      dni: String(dni).trim(),
      nombres: (nombres || '').trim(),
      apellidos: (apellidos || '').trim(),
      institucion: (institucion || '').trim(),
      puesto: (puesto || '').trim(),
      correo: (correo || '').trim(),
      pais: (pais || '').trim(),
      descripcion: (descripcion || '').trim(),
      uuid: uuidv4(),
      estado_pago: estado_pago || 'NO_PAGADO',
      sede_alta: sede_alta || 'sede_principal'
    });

    res.json({ success: true, uuid: rec.fields.uuid });
  } catch (err) {
    // Fallback CSV si Airtable falla
    try {
      const headers = 'dni,nombres,apellidos,institucion,puesto,correo,pais,descripcion,uuid,estado_pago,sede_alta\n';
      const row = `"${dni}","${nombres}","${apellidos}","${institucion}","${puesto}","${correo}","${pais}","${(descripcion || '').replace(/"/g,'""')}","${uuidv4()}","NO_PAGADO","sede_principal"\n`;
      if (!fs.existsSync(FALLBACK_FILE)) fs.writeFileSync(FALLBACK_FILE, headers + row);
      else fs.appendFileSync(FALLBACK_FILE, row);
      return res.json({ success: true, message: 'Guardado local en respaldo.csv (offline)' });
    } catch (fileErr) {
      return res.status(500).json({ success: false, message: 'Error local de respaldo', error: fileErr.message });
    }
  }
});

// 3) Obtener asistente por UUID (con watchdog de 5s para evitar cuelgue)
app.get('/api/attendee/:uuid', async (req, res) => {
  const { uuid } = req.params;

  let finished = false;
  const wd = setTimeout(() => {
    if (finished) return;
    finished = true;
    console.error('[attendee] TIMEOUT para uuid:', uuid);
    return res.status(504).json({ success: false, message: 'TIMEOUT' });
  }, 5000);

  try {
    const rec = await getAsistenteByUUID(uuid);
    if (finished) return;
    clearTimeout(wd);

    if (!rec) {
      finished = true;
      return res.status(404).json({ success: false, message: 'NO_ENCONTRADO' });
    }

    const f = rec.fields;
    finished = true;
    return res.json({
      success: true,
      attendee: {
        uuid          : f.uuid,
        dni           : f.dni,
        nombres       : f.nombres,
        apellidos     : f.apellidos,
        institucion   : f.institucion,
        puesto        : f.puesto,
        correo        : f.correo || '',
        pais          : f.pais   || '',
        descripcion   : f.descripcion || '', // NUEVO
        estado_pago   : f.estado_pago || 'NO_PAGADO',
        se_imprimio_at: f.se_imprimio_at || null
      }
    });
  } catch (err) {
    if (finished) return;
    clearTimeout(wd);
    console.error('[attendee] ERROR:', err?.message || err);
    return res.status(500).json({ success: false, message: 'ERROR_BACKEND', error: String(err?.message || err) });
  }
});

// 3.bis) Búsqueda flexible (uuid | dni | correo | nombre)
app.get('/api/search', async (req, res) => {
  const byRaw = String(req.query.by || 'uuid').toLowerCase();
  const qRaw  = String(req.query.q  || '').trim();

  if (!qRaw) {
    return res.status(400).json({ success:false, message:'Parámetro q requerido' });
  }
  const by = ['uuid','dni','correo','nombre'].includes(byRaw) ? byRaw : 'uuid';

  // normalizador para búsquedas "humanas"
  const norm = (s) => String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  try {
    // Caso rápido: UUID exacto → usa ruta optimizada
    if (by === 'uuid') {
      const rec = await getAsistenteByUUID(qRaw);
      const out = [];
      if (rec?.fields) {
        const f = rec.fields;
        out.push({
          uuid          : f.uuid,
          dni           : f.dni || '',
          nombres       : f.nombres || '',
          apellidos     : f.apellidos || '',
          institucion   : f.institucion || '',
          puesto        : f.puesto || '',
          correo        : f.correo || '',
          pais          : f.pais || '',
          descripcion   : f.descripcion || '', // NUEVO
          estado_pago   : f.estado_pago || 'NO_PAGADO',
          se_imprimio_at: f.se_imprimio_at || null
        });
      }
      return res.json({ success:true, results: out });
    }

    // Resto de modos → listar y filtrar en memoria
    const rows = await listAll(process.env.AIRTABLE_TABLE_ASISTENTES, {
      fields: [
        'uuid','dni','nombres','apellidos','institucion','puesto',
        'correo','pais','descripcion','estado_pago','se_imprimio_at' // NUEVO descripcion
      ]
    });

    const nq = norm(qRaw);
    const results = [];

    for (const r of rows) {
      const f = r.fields || {};
      let hit = false;

      if (by === 'dni') {
        hit = norm(f.dni).includes(nq);
      } else if (by === 'correo') {
        hit = norm(f.correo).includes(nq);
      } else { // 'nombre' = nombres + apellidos
        const full = norm(`${f.nombres || ''} ${f.apellidos || ''}`.trim());
        hit = full.includes(nq);
      }

      if (hit) {
        results.push({
          uuid          : f.uuid,
          dni           : f.dni || '',
          nombres       : f.nombres || '',
          apellidos     : f.apellidos || '',
          institucion   : f.institucion || '',
          puesto        : f.puesto || '',
          correo        : f.correo || '',
          pais          : f.pais || '',
          descripcion   : f.descripcion || '', // NUEVO
          estado_pago   : f.estado_pago || 'NO_PAGADO',
          se_imprimio_at: f.se_imprimio_at || null
        });
      }
    }

    // orden y límite sanos
    if (by === 'nombre') {
      results.sort((a,b) => {
        const an = `${a.apellidos || ''} ${a.nombres || ''}`.toLowerCase();
        const bn = `${b.apellidos || ''} ${b.nombres || ''}`.toLowerCase();
        return an.localeCompare(bn);
      });
    }

    return res.json({ success:true, results: results.slice(0, 50) });
  } catch (err) {
    console.error('[search] ERROR:', err?.message || err);
    return res.status(500).json({ success:false, message:'ERROR_BACKEND', error: String(err?.message || err) });
  }
});

// 4) Marcar pago
app.post('/api/pay', async (req, res) => {
  const { uuid, medio } = req.body || {};
  if (!uuid) return res.status(400).json({ success: false, message: 'uuid requerido' });
  try {
    await setPago(uuid, medio);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error marcando pago', error: err.message });
  }
});

// 5) Marcar impresión (valida pago y devuelve timestamp real)
app.post('/api/print', async (req, res) => {
  const { uuid } = req.body || {};
  if (!uuid) return res.status(400).json({ success: false, message: 'uuid requerido' });

  try {
    const rec = await getAsistenteByUUID(uuid);
    if (!rec) return res.status(404).json({ success: false, message: 'NO_ENCONTRADO' });

    const f = rec.fields;
    if ((f.estado_pago || 'NO_PAGADO') !== 'PAGADO') {
      return res.status(403).json({ success: false, message: 'NO_PAGADO' });
    }

    await marcarImpresion(uuid);

    // lee nuevamente para devolver el sello real
    const rec2 = await getAsistenteByUUID(uuid);
    const ts = rec2?.fields?.se_imprimio_at || new Date().toISOString();

    res.json({ success: true, se_imprimio_at: ts });
  } catch (err) {
    // Fallback CSV si Airtable falla
    try {
      const row = `PRINT,"${uuid}",${new Date().toISOString()}\n`;
      if (!fs.existsSync(FALLBACK_FILE)) fs.writeFileSync(FALLBACK_FILE, 'op,uuid,ts\n' + row);
      else fs.appendFileSync(FALLBACK_FILE, row);
      res.json({ success: true, message: 'Marcado en respaldo.csv (offline)' });
    } catch (fileErr) {
      res.status(500).json({ success: false, message: 'Error local de respaldo', error: fileErr.message });
    }
  }
});

// 6) Check-in de charla
app.post('/api/checkin', async (req, res) => {
  const { uuid, session_id, sede } = req.body || {};
  if (!uuid || !session_id || !sede) {
    return res.status(400).json({ success: false, message: 'uuid, session_id y sede requeridos' });
  }
  try {
    await registrarAcceso(uuid, session_id, sede);
    res.json({ success: true });
  } catch (err) {
    try {
      const row = `CHECKIN,"${uuid}","${session_id}","${sede}",${new Date().toISOString()}\n`;
      if (!fs.existsSync(FALLBACK_FILE)) fs.writeFileSync(FALLBACK_FILE, 'op,uuid,session_id,sede,ts\n' + row);
      else fs.appendFileSync(FALLBACK_FILE, row);
      res.json({ success: true, message: 'Check-in guardado en respaldo.csv (offline)' });
    } catch (fileErr) {
      res.status(500).json({ success: false, message: 'Error local de respaldo', error: fileErr.message });
    }
  }
});

// 7) Dashboard
app.get('/api/dashboard', async (req, res) => {
  try {
    const asistentes = await listAll(process.env.AIRTABLE_TABLE_ASISTENTES, { fields: ['estado_pago','se_imprimio_at'] });
    const accesos    = await listAll(process.env.AIRTABLE_TABLE_ACCESOS, { fields: ['session_id'] });

    const total    = asistentes.length;
    const pagados  = asistentes.filter(r => (r.fields.estado_pago || 'NO_PAGADO') === 'PAGADO').length;
    const impresos = asistentes.filter(r => !!r.fields.se_imprimio_at).length;

    const porSesion = {};
    for (const a of accesos) {
      const s = a.fields.session_id || 'desconocida';
      porSesion[s] = (porSesion[s] || 0) + 1;
    }

    res.json({ success:true, total, pagados, impresos, porSesion });
  } catch (err) {
    res.status(500).json({ success:false, message:'Error dashboard', error: err.message });
  }
});

// --- start ---
app.listen(port, () => {
  console.log(`Servidor en http://localhost:${port}`);
});
