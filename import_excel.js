// import-excel.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import ExcelJS from 'exceljs';
import { v4 as uuidv4 } from 'uuid';
import { upsertAsistenteByDni } from './airtable.js';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Uso: npm run import -- "ruta/al/archivo.xlsx"
const input = process.argv[2];
if (!input) {
  console.error('Uso: npm run import -- "ruta/al/archivo.xlsx"');
  process.exit(1);
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita acentos
    .replace(/\s+/g, '_')                             // espacios -> _
    .replace(/[^a-z0-9_]/g, '');                      // limpia raros
}

// Intenta mapear encabezados del Excel a nuestros campos
function mapHeaderToField(h) {
  const n = norm(h);

  if (['uuid', 'id_unico'].includes(n))                         return 'uuid';
  if (['dni', 'documento', 'cedula', 'id'].includes(n))         return 'dni';
  if (['nombres', 'nombre', 'first_name'].includes(n))          return 'nombres';
  if (['apellidos', 'apellido', 'last_name'].includes(n))       return 'apellidos';
  if ([
    'institucion',
    'institucion_o_empresa',
    'empresa',
    'organization',
    'institucion_'
  ].includes(n))                                                return 'institucion';
  if (['puesto', 'profesion', 'cargo', 'role', 'ocupacion'].includes(n))
                                                                return 'puesto';
  if (['correo', 'email', 'correo_electronico', 'mail'].includes(n))
                                                                return 'correo';
  if (['pais', 'country'].includes(n))                          return 'pais';
  if (['estado_pago', 'pago', 'status_pago'].includes(n))       return 'estado_pago';
  if (['medio_pago', 'metodo_pago'].includes(n))                return 'medio_pago';

  // NUEVO: descripción libre del asistente
  if ([
    'descripcion',
    'description',
    'detalle',
    'detalles',
    'nota',
    'notas',
    'observaciones',
    'observacion'
  ].includes(n))                                                return 'descripcion';

  // Ignorar lo demás
  return null;
}

(async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.resolve(input));
  const ws = workbook.worksheets[0];

  // Lee encabezados
  const headers = {};
  ws.getRow(1).eachCell((cell, col) => {
    const field = mapHeaderToField(cell.value);
    if (field) headers[col] = field;
  });

  const used = Object.values(headers);
  console.log('Campos detectados en Excel ->', used.length ? used.join(', ') : '(ninguno)');
  if (!used.includes('dni')) {
    console.error('No se encontró columna DNI (obligatoria). Aborta.');
    process.exit(1);
  }

  let ok = 0, skipped = 0;
  for (let i = 2; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const record = {};
    row.eachCell((cell, col) => {
      const key = headers[col];
      if (!key) return;
      record[key] = (cell.value ?? '').toString().trim();
    });

    if (!record.dni) {
      skipped++;
      continue;
    }

    // Defaults/mapeos
    if (!record.uuid) record.uuid = uuidv4();
    if (!record.estado_pago) record.estado_pago = 'NO_PAGADO';

    // upsert (merge seguro en airtable.js)
    await upsertAsistenteByDni(record);
    ok++;
  }

  console.log(`Importados/actualizados: ${ok}. Filas sin DNI: ${skipped}.`);
})();
