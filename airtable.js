// airtable.js
import Airtable from 'airtable';
import { config } from 'dotenv';
config();

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

const T_ASIS = process.env.AIRTABLE_TABLE_ASISTENTES || 'asistentes';
const T_ACCE = process.env.AIRTABLE_TABLE_ACCESOS    || 'accesos';
const T_SESI = process.env.AIRTABLE_TABLE_SESIONES   || 'sesiones';

/* ---------------- Helpers genéricos ---------------- */

// ⚠️ Optimizado: NO uses .all() aquí; trae solo la PRIMERA página (1 registro).
export async function findBy(table, filterByFormula) {
  const records = await base(table).select({
    filterByFormula,
    maxRecords: 1,
    pageSize  : 1
  }).firstPage();
  return records[0] || null;
}

export async function listAll(table, options = {}) {
  const records = await base(table).select({ ...options }).all();
  return records;
}

export async function createRecord(table, fields) {
  const rec = await base(table).create([{ fields }]);
  return rec[0];
}

export async function updateRecord(table, id, fields) {
  const rec = await base(table).update([{ id, fields }]);
  return rec[0];
}

/* ------------- Helpers de merge/normalización ------------- */

// Mezcla sin pisar con undefined
function mergeKeepDefined(prev = {}, next = {}) {
  const out = { ...prev };
  for (const [k, v] of Object.entries(next)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// Normaliza objeto de asistente a las columnas esperadas en Airtable
function normalizeAsistente(fields = {}) {
  return {
    uuid          : fields.uuid,
    dni           : fields.dni,
    nombres       : fields.nombres,
    apellidos     : fields.apellidos,
    institucion   : fields.institucion,
    puesto        : fields.puesto,         // seguimos usando "puesto"
    correo        : fields.correo ?? '',   // NUEVO (si lo tienes en la tabla)
    pais          : fields.pais   ?? '',   // NUEVO (si lo tienes en la tabla)
    estado_pago   : fields.estado_pago ?? 'NO_PAGADO',
    medio_pago    : fields.medio_pago ?? '',
    se_imprimio_at: fields.se_imprimio_at ?? null,
    sede_alta     : fields.sede_alta ?? 'sede_principal'
  };
}

/* ----------------- Específicos asistentes ----------------- */

export async function upsertAsistenteByDni(fields) {
  const dni = String(fields.dni || '').trim();
  if (!dni) throw new Error('DNI requerido');

  // Case-insensitive por si el Excel trae variaciones
  const formula = `LOWER({dni}) = LOWER("${dni.replace(/"/g, '""')}")`;
  const found = await findBy(T_ASIS, formula);

  const incoming = normalizeAsistente(fields);

  if (found) {
    const merged = normalizeAsistente(
      mergeKeepDefined(found.fields, incoming)
    );
    await updateRecord(T_ASIS, found.id, merged);
    return { id: found.id, fields: merged };
  } else {
    const created = await createRecord(T_ASIS, incoming);
    return { id: created.id, fields: created.fields };
  }
}

export async function getAsistenteByUUID(uuid) {
  // Asegúrate de que {uuid} en Airtable sea campo de TEXTO (single line text)
  const formula = `{uuid} = "${String(uuid).replace(/"/g, '""')}"`;
  const rec = await findBy(T_ASIS, formula);
  if (!rec) return null;
  return { id: rec.id, fields: rec.fields };
}

export async function setPago(uuid, medio) {
  const rec = await getAsistenteByUUID(uuid);
  if (!rec) throw new Error('Asistente no encontrado');
  await updateRecord(T_ASIS, rec.id, {
    estado_pago: 'PAGADO',
    medio_pago : medio || 'efectivo'
  });
  return true;
}

export async function marcarImpresion(uuid, whenISO) {
  const rec = await getAsistenteByUUID(uuid);
  if (!rec) throw new Error('Asistente no encontrado');
  await updateRecord(T_ASIS, rec.id, {
    se_imprimio_at: whenISO || new Date().toISOString()
  });
  return true;
}

/* ----------------- Accesos (charlas) ----------------- */
export async function registrarAcceso(uuid, session_id, sede) {
  await createRecord(T_ACCE, {
    uuid,
    session_id,
    sede,
    ts: new Date().toISOString()
  });
  return true;
}
