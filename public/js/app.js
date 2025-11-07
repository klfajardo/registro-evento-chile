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

// ====== HELPERS ======
function renderInfo(msg, cls=''){
  elInfo.className = 'info ' + (cls||'');
  elInfo.innerHTML = msg;
}
function setButtons(payDisabled, printDisabled){
  btnPay.disabled   = payDisabled;
  btnPrint.disabled = printDisabled;
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
  elResults.innerHTML = '';
  elResults.classList.add('is-hidden');
}
function showResults(items){
  elResults.innerHTML = '';
  if (!items || !items.length){ clearResults(); return; }
  const frag = document.createDocumentFragment();
  items.forEach((it)=>{
    const row = document.createElement('div');
    row.className = 'result-item';
    const nombre = `${it.nombres ?? ''} ${it.apellidos ?? ''}`.trim();
    const linea1 = nombre || '(Sin nombre)';
    const sub = []
    if (it.dni) sub.push(`DNI: ${it.dni}`);
    if (it.correo) sub.push(it.correo);
    if (it.institucion) sub.push(it.institucion);
    // contenido
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
  elScan.value = item.uuid || '';
  renderInfo('Cargando…');
  await loadAttendeeByUUID(item.uuid);
  elScan.focus();
}

// ====== BUSCAR ======
async function doSearch(){
  if (busyScan) return;
  const mode = (elSearchBy.value || 'uuid').toLowerCase();
  const q    = elScan.value.trim();
  if(!q) return;

  busyScan = true;
  elScan.disabled = true;
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
    elScan.disabled = false;
    busyScan = false;
    return;
  }

  // nombre/dni/correo → lista
  const byParam = (mode === 'nombre') ? 'nombre' : mode; // nombre concat nombres+apellidos en backend
  const res = await fetchJSON(`/api/search?by=${encodeURIComponent(byParam)}&q=${encodeURIComponent(q)}`);

  if(!res.success){
    const msg = res.status===404 ? 'Servidor sin endpoint /api/search' : (res.message || 'Error de búsqueda');
    renderInfo(`No se pudo buscar (${msg}).`, 'bad');
    elScan.disabled = false;
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
    // Limitar y mostrar
    if (list.length > 20){
      renderInfo(`Demasiados resultados (${list.length}). Afina la búsqueda.`, 'bad');
      showResults(list.slice(0, 20));
    } else {
      renderInfo('Selecciona un asistente de la lista:');
      showResults(list);
    }
  }

  elScan.disabled = false;
  busyScan = false;
}

// ====== EVENTO ENTER ======
elScan.addEventListener('keydown', async (e)=>{
  if(e.key !== 'Enter') return;
  if(e.repeat) return;
  await doSearch();
});

// ====== PAGO ======
btnPay.addEventListener('click', async ()=>{
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
btnPrint.addEventListener('click', async ()=>{
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

// ====== ZPL (QR + 5 líneas, vertical) ======
function printPhysical(att, maxRetry=5){
  const NOMBRE_COMPLETO = `${att.nombres ?? ''} ${att.apellidos ?? ''}`.trim();
  const INSTITUCION     = att.institucion ?? '';
  const PROFESION       = (att.profesion ?? att.puesto ?? '');
  const PAIS            = att.pais ?? '';
  const CORREO          = (att.correo ?? '').slice(0, 36);
  const UUID            = att.uuid || '';

  const zpl = `
^XA
^PW800
^LL600
^LH0,0

^FO40,40
^BQN,2,6
^FDLA,${escapeZPL(UUID)}^FS

^FO40,250
^A0R,70,70
^FB700,2,10,C,0
^FD${escapeZPL(INSTITUCION)}\\&^FS

^FO160,250
^A0R,70,70
^FB700,2,10,C,0
^FD${escapeZPL(PROFESION)}\\&^FS

^FO280,250
^A0R,70,70
^FB700,2,10,C,0
^FD${escapeZPL(PAIS)}\\&^FS

^FO400,250
^A0R,60,60
^FB700,2,10,C,0
^FD${escapeZPL(CORREO)}\\&^FS

^FO520,250
^A0R,110,110
^FB700,2,10,C,0
^FD${escapeZPL(NOMBRE_COMPLETO)}\\&^FS

^XZ`;

  return new Promise((resolve, reject)=>{
    let attempts = 0;
    function tryOnce(){
      attempts++;
      window.BrowserPrint.getDefaultDevice('printer', function(printer){
        if(!printer){
          if(attempts >= maxRetry) return reject(new Error('No se encontró impresora Zebra'));
          renderInfo('No se encontró impresora. Reintentando...', 'bad');
          return setTimeout(tryOnce, 1200);
        }
        printer.send(zpl, function(){ resolve(); }, function(err){
          if(attempts >= maxRetry) return reject(new Error('Error impresión Zebra: '+(err||'desconocido')));
          renderInfo('Error impresión, reintentando...', 'bad');
          setTimeout(tryOnce, 1500);
        });
      }, function(err){
        if(attempts >= maxRetry) return reject(new Error('Impresora no disponible: '+(err||'desconocido')));
        renderInfo('Impresora no disponible, reintentando...', 'bad');
        setTimeout(tryOnce, 1200);
      });
    }
    tryOnce();
  });
}
