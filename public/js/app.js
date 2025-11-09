<!-- app.js -->
<script>
// app.js — INDEX (Registro). Búsqueda por UUID/DNI/Correo/Nombre+Apellido con lista de resultados.
// Requiere endpoint GET /api/search?by=(uuid|dni|correo|nombre)&q=... que devuelva:
// { success:true, results:[ { uuid, nombres, apellidos, dni, correo, institucion, puesto, pais, estado_pago, se_imprimio_at } ] }

const CFG = window.CFG || { ROL: 'staff', SEDE: 'sede' };

// ====== ELEMENTOS ======
const elSearchBy = document.getElementById('searchBy');
const elScan     = document.getElementById('scan');
const elResults  = document.getElementById('results');
const elInfo     = document.getElementById('info');
const btnPay     = document.getElementById('btnPay');
const btnPrint   = document.getElementById('btnPrint');

// --- campos de Alta ---
const btnAlta       = document.getElementById('btnAlta');
const fldDni        = document.getElementById('dni');
const fldNombres    = document.getElementById('nombres');
const fldApellidos  = document.getElementById('apellidos');
const fldInstit     = document.getElementById('institucion');
const fldPuesto     = document.getElementById('puesto');
const fldCorreo     = document.getElementById('correo');
const fldPais       = document.getElementById('pais');

// Pintar meta si existe
const meta = document.getElementById('meta');
if (meta) {
  const bits = [`ROL: ${CFG.ROL}`, `SEDE: ${CFG.SEDE}`];
  if (CFG.SESSION_ID) bits.push(`SESIÓN: ${CFG.SESSION_ID}`);
  meta.textContent = bits.join(' | ');
}

// ====== ESTADO ======
let current   = null;   // Attendee cargado
let busyScan  = false;
let busyPay   = false;
let busyPrint = false;
let busyAlta  = false;

// ====== HELPERS ======
function renderInfo(msg, cls=''){
  elInfo.className = 'info ' + (cls||'');
  elInfo.innerHTML = msg;
}
function setButtons(payDisabled, printDisabled){
  if (btnPay)   btnPay.disabled   = payDisabled;
  if (btnPrint) btnPrint.disabled = printDisabled;
}
function canUsePrinter(){
  return !!(window.BrowserPrint && typeof window.BrowserPrint.getDefaultDevice === 'function');
}
async function fetchJSON(url, opt = {}, timeoutMs = 8000){
  const ctrl = new AbortController();
  const id = setTimeout(()=>ctrl.abort(new Error('timeout')), timeoutMs);
  try {
    const r = await fetch(url, { ...opt, signal: ctrl.signal, cache: 'no-store' });
    if (!r.ok) return { success:false, status:r.status, message:`HTTP ${r.status}` };
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return { success:false, message:'Respuesta no-JSON' };
    return await r.json();
  } catch (e) {
    return { success:false, offline:true, error:String(e.message||e) };
  } finally {
    clearTimeout(id);
  }
}
function escapeZPL(s){ return String(s).replace(/[\^~\\]/g, ' '); }

function clearResults(){
  if (!elResults) return;
  elResults.innerHTML = '';
  elResults.classList.add('is-hidden');
}
function showResults(items){
  if (!elResults) return;
  elResults.innerHTML = '';
  if (!items || !items.length){ clearResults(); return; }
  const frag = document.createDocumentFragment();
  items.forEach((it)=>{
    const row = document.createElement('div');
    row.className = 'result-item';
    const nombre = `${it.nombres ?? ''} ${it.apellidos ?? ''}`.trim();
    const linea1 = nombre || '(Sin nombre)';
    const sub = [];
    if (it.dni) sub.push(`DNI: ${it.dni}`);
    if (it.correo) sub.push(it.correo);
    if (it.institucion) sub.push(it.institucion);
    row.innerHTML = `
      <div class="ri-main">${linea1}</div>
      <div class="ri-sub">${sub.join(' · ')}</div>
    `;
    row.addEventListener('click', ()=> selectCandidate(it));
    frag.appendChild(row);
  });
  elResults.appendChild(frag);
  elResults.classList.remove('is-hidden');
}

function paintAttendee(att){
  const estado = att.estado_pago || 'NO_PAGADO';
  const nombreCompleto = `${att.nombres ?? ''} ${att.apellidos ?? ''}`.trim();
  const institucion = att.institucion ?? '';
  const profesion   = (att.profesion ?? att.puesto ?? '');
  const correo      = att.correo ?? '';
  const pais        = att.pais ?? '';

  renderInfo(`
    <div><b>${nombreCompleto}</b></div>
    <div>${institucion} — ${profesion}</div>
    <div>${pais ? ('<span class="subtle">País: '+pais+'</span>') : ''} ${correo ? ('<span class="subtle"> · Correo: '+correo+'</span>') : ''}</div>
    <div>Estado pago: <span class="badge ${estado==='PAGADO'?'ok':'bad'}"><span class="dot"></span>${estado}</span></div>
    <div>Impreso: ${att.se_imprimio_at ? 'SI' : 'NO'}</div>
  `);

  const payAllowed   = CFG.SEDE === 'sede' && (CFG.ROL === 'admin' || CFG.ROL === 'cajero') && estado !== 'PAGADO';
  const printAllowed = (estado === 'PAGADO') && canUsePrinter();
  setButtons(!payAllowed, !printAllowed);

  if(estado === 'PAGADO' && !canUsePrinter()){
    renderInfo('Pago OK. <b>No hay impresora Zebra disponible</b>. Conéctala/instala BrowserPrint para habilitar impresión.', 'bad');
  }
}

async function loadAttendeeByUUID(uuid){
  const data = await fetchJSON('/api/attendee/'+encodeURIComponent(uuid));
  if(!data.success) return { ok:false, reason:data.message || 'NO_ENCONTRADO' };
  current = data.attendee;
  paintAttendee(current);
  return { ok:true };
}

async function selectCandidate(item){
  clearResults();
  if (elScan) elScan.value = item.uuid || '';
  renderInfo('Cargando…');
  await loadAttendeeByUUID(item.uuid);
  elScan?.focus();
}

// ====== BUSCAR ======
async function doSearch(){
  if (busyScan) return;
  const mode = (elSearchBy?.value || 'uuid').toLowerCase();
  const q    = (elScan?.value || '').trim();
  if(!q) return;

  busyScan = true;
  if (elScan) elScan.disabled = true;
  setButtons(true, true);
  clearResults();
  renderInfo('Buscando…');

  await new Promise(r=>requestAnimationFrame(r));

  if (mode === 'uuid'){
    const r = await loadAttendeeByUUID(q);
    if (!r.ok){
      renderInfo('<b>No encontrado</b>', 'bad');
      current = null;
      setButtons(true, true);
    }
    if (elScan) elScan.disabled = false;
    busyScan = false;
    return;
  }

  // nombre/dni/correo → lista
  const byParam = (mode === 'nombre') ? 'nombre' : mode; // nombre concat nombres+apellidos en backend
  const res = await fetchJSON(`/api/search?by=${encodeURIComponent(byParam)}&q=${encodeURIComponent(q)}`);

  if(!res.success){
    const msg = res.status===404 ? 'Servidor sin endpoint /api/search' : (res.message || 'Error de búsqueda');
    renderInfo(`No se pudo buscar (${msg}).`, 'bad');
    if (elScan) elScan.disabled = false;
    busyScan = false;
    return;
  }

  const list = Array.isArray(res.results) ? res.results : [];
  if (list.length === 0){
    renderInfo('<b>No encontrado</b>', 'bad');
    current = null;
    setButtons(true, true);
  } else if (list.length === 1){
    await selectCandidate(list[0]);
  } else {
    if (list.length > 20){
      renderInfo(`Demasiados resultados (${list.length}). Afina la búsqueda.`, 'bad');
      showResults(list.slice(0, 20));
    } else {
      renderInfo('Selecciona un asistente de la lista:');
      showResults(list);
    }
  }

  if (elScan) elScan.disabled = false;
  busyScan = false;
}

// ====== EVENTO ENTER ======
elScan?.addEventListener('keydown', async (e)=>{
  if(e.key !== 'Enter') return;
  if(e.repeat) return;
  await doSearch();
});

// ====== PAGO ======
btnPay?.addEventListener('click', async ()=>{
  if(!current || busyPay) return;
  busyPay = true;

  const medio = prompt('Medio de pago: efectivo / tarjeta','efectivo');
  if(!medio){ busyPay=false; return; }

  setButtons(true, true);
  renderInfo('Registrando pago…');

  const res = await fetchJSON('/api/pay', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ uuid: current.uuid, medio })
  });

  if(res.success){
    current.estado_pago = 'PAGADO';
    const printAllowed = canUsePrinter();
    setButtons(true, !printAllowed);
    renderInfo(printAllowed ? 'Pago registrado. Puedes imprimir.' : 'Pago registrado. <b>Conecta/instala la Zebra</b> para imprimir.', printAllowed ? 'ok' : 'bad');
  }else{
    setButtons(false, true);
    renderInfo('Error registrando pago', 'bad');
  }

  busyPay = false;
});

// ====== IMPRESIÓN ======
btnPrint?.addEventListener('click', async ()=>{
  if(!current || busyPrint) return;

  if((current.estado_pago || 'NO_PAGADO') !== 'PAGADO'){
    renderInfo('Bloqueado: NO PAGADO', 'bad');
    return;
  }

  if(!canUsePrinter()){
    renderInfo('Impresora Zebra no disponible.', 'bad');
    btnPrint.disabled = true;
    return;
  }

  busyPrint = true;
  btnPrint.disabled = true;
  renderInfo('Imprimiendo…');

  try{
    await printPhysical(current);
  }catch(e){
    renderInfo('Fallo de impresión. No se marcó como impreso. '+(e?.message||''), 'bad');
    btnPrint.disabled = false;
    busyPrint = false;
    return;
  }

  const mark = await fetchJSON('/api/print', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ uuid: current.uuid })
  });

  if(mark.success){
    current.se_imprimio_at = mark.se_imprimio_at || new Date().toISOString();
    renderInfo('Impresión OK y registrada en servidor.', 'ok');
  }else{
    renderInfo('La Zebra imprimió, pero el servidor NO marcó como impreso. Reintenta marcar o avisa al admin.', 'bad');
    btnPrint.disabled = false;
  }

  busyPrint = false;
});

// ====== ZEBRA: impresión física (VERTICAL / PORTRAIT) ======
// Solo: PRIMER NOMBRE, PRIMER APELLIDO, PAÍS + QR (sin correo).
// QR: URL a charla.html con ?uuid=...&auto=1
// Dimensiones para pulsera 59×102 mm a 203 dpi: ^PW=472, ^LL=816.
function printPhysical(att, maxRetry = 5){
  const sanitize = s => String(s||'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '');

  // Primer nombre y primer apellido SOLAMENTE
  const rawNombre   = (att.nombres   || '').trim();
  const rawApellido = (att.apellidos || '').trim();

  const firstName   = sanitize((rawNombre.split(/\s+/)[0] || '')).toUpperCase();
  const firstLast   = sanitize((rawApellido.split(/\s+/)[0] || '')).toUpperCase();

  const PAIS        = sanitize((att.pais || '').trim()).toUpperCase();
  const UUID        = String(att.uuid || '');

  // URL para auto check-in en charla.html
  const QR_URL = `${location.origin}/charla.html?uuid=${encodeURIComponent(UUID)}&auto=1`;

  // Recortes duros para evitar overflow en 1 línea
  const cut = (s, n) => (s.length > n ? s.slice(0, n) : s);
  const L1 = cut(firstName,  22);
  const L2 = cut(firstLast,  22);
  const L3 = cut(PAIS,       20);

  // Tamaños adaptativos conservadores (nombres más cortos → fuente más grande)
  const sizeName    = (L1.length > 12) ? 76 : 86;
  const sizeLast    = (L2.length > 12) ? 76 : 86;
  const sizeCountry = (L3.length > 14) ? 44 : 56;

  const zpl = `
^XA
^CI28
^PON
^FWN
^PW472
^LL816
^LS0
^LH0,0
^PQ1

^FX ---- QR centrado arriba ----
^FO136,24
^BQN,2,7
^FDLA,${escapeZPL(QR_URL)}^FS

^FX ---- Primer Nombre (centrado) ----
^FO20,330
^A0N,${sizeName},${sizeName}
^FB432,1,0,C,0
^FD${escapeZPL(L1)}^FS

^FX ---- Primer Apellido (centrado) ----
^FO20,420
^A0N,${sizeLast},${sizeLast}
^FB432,1,0,C,0
^FD${escapeZPL(L2)}^FS

^FX ---- País (centrado) ----
^FO20,510
^A0N,${sizeCountry},${sizeCountry}
^FB432,1,0,C,0
^FD${escapeZPL(L3)}^FS

^XZ`;

  return new Promise((resolve, reject)=>{
    let attempts = 0;
    const tryOnce = ()=>{
      attempts++;
      if (!window.BrowserPrint || typeof window.BrowserPrint.getDefaultDevice !== 'function'){
        return reject(new Error('BrowserPrint no disponible'));
      }
      window.BrowserPrint.getDefaultDevice('printer', (printer)=>{
        if(!printer){
          if(attempts >= maxRetry) return reject(new Error('No se encontró impresora Zebra'));
          renderInfo('No se encontró impresora. Reintentando...', 'bad');
          return setTimeout(tryOnce, 1200);
        }
        printer.send(zpl, ()=>resolve(), (err)=>{
          if(attempts >= maxRetry){
            return reject(new Error('Error impresión Zebra: ' + (err || 'desconocido')));
          }
          renderInfo('Error impresión, reintentando...', 'bad');
          setTimeout(tryOnce, 1500);
        });
      }, (err)=>{
        if(attempts >= maxRetry){
          return reject(new Error('Impresora no disponible: ' + (err || 'desconocido')));
        }
        renderInfo('Impresora no disponible, reintentando...', 'bad');
        setTimeout(tryOnce, 1200);
      });
    };
    tryOnce();
  });
}

// ====== ALTA NUEVA (solo sede principal) ======
btnAlta?.addEventListener('click', async ()=>{
  if (busyAlta) return;
  const dni         = (fldDni?.value || '').trim();
  const nombres     = (fldNombres?.value || '').trim();
  const apellidos   = (fldApellidos?.value || '').trim();
  const institucion = (fldInstit?.value || '').trim();
  const puesto      = (fldPuesto?.value || '').trim();
  const correo      = (fldCorreo?.value || '').trim();
  const pais        = (fldPais?.value || '').trim();

  if (!dni || !nombres){
    alert('DNI y Nombres son obligatorios');
    return;
  }
  if ((CFG.SEDE || '').toLowerCase() !== 'sede'){
    alert('Alta nueva solo en SEDE principal');
    return;
  }

  busyAlta = true;
  btnAlta.disabled = true;
  renderInfo('Creando alta…');

  const res = await fetchJSON('/api/register', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({
      dni, nombres, apellidos, institucion, puesto, correo, pais, sede_alta:'sede_principal'
    })
  });

  if (res.success){
    renderInfo('Alta creada. Escanea el QR una vez generado.', 'ok');
    // Limpieza rápida
    fldDni && (fldDni.value = '');
    fldNombres && (fldNombres.value = '');
    fldApellidos && (fldApellidos.value = '');
    fldInstit && (fldInstit.value = '');
    fldPuesto && (fldPuesto.value = '');
    fldCorreo && (fldCorreo.value = '');
    fldPais && (fldPais.value = '');
  } else {
    renderInfo('Error creando alta' + (res.message ? `: ${res.message}` : ''), 'bad');
    console.error('Alta error:', res);
  }

  btnAlta.disabled = false;
  busyAlta = false;
});
</script>
