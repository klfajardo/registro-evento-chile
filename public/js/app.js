// --- CARGA CONFIG ---
async function loadConfig(){ const r=await fetch('/config.json'); return r.json(); }
let CFG = await loadConfig();

// --- ELEMENTOS ---
const elScan  = document.getElementById('scan');
const elInfo  = document.getElementById('info');
const btnPay  = document.getElementById('btnPay');
const btnPrint= document.getElementById('btnPrint');
const meta    = document.getElementById('meta');

meta.textContent = `ROL: ${CFG.ROL} | SEDE: ${CFG.SEDE}`;

let current  = null;   // { uuid, nombres, apellidos, institucion, puesto|profesion, estado_pago, se_imprimio_at, correo, pais }
let busyScan = false;  // evita reentradas en búsqueda
let busyPay  = false;
let busyPrint= false;

// --- HELPERS UI/NET ---
function renderInfo(msg, cls=''){ elInfo.className = 'info ' + (cls||''); elInfo.innerHTML = msg; }

function setButtons(payDisabled, printDisabled){
  btnPay.disabled   = payDisabled;
  btnPrint.disabled = printDisabled;
}

// fetch con timeout
async function fetchJSON(url, opt = {}, timeoutMs = 8000){
  const ctrl = new AbortController();
  const id = setTimeout(()=>ctrl.abort(new Error('timeout')), timeoutMs);
  try {
    const r = await fetch(url, { ...opt, signal: ctrl.signal });
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

function canUsePrinter(){
  return !!(window.BrowserPrint && typeof window.BrowserPrint.getDefaultDevice === 'function');
}

// --- ESCANEO (lector HID pega uuid y Enter) ---
elScan.addEventListener('keydown', async (e)=>{
  if(e.key !== 'Enter') return;
  if(e.repeat) return;   // evita “pegas Enter sostenido”
  if(busyScan) return;   // evita llamadas concurrentes

  const uuid = elScan.value.trim();
  if(!uuid) return;

  busyScan = true;
  elScan.disabled = true;
  setButtons(true, true);
  renderInfo('Buscando…');

  // asegúrate que pinte antes del fetch
  await new Promise(r=>requestAnimationFrame(r));

  const data = await fetchJSON('/api/attendee/'+encodeURIComponent(uuid));

  if(!data.success){
    renderInfo('<b>No encontrado</b>', 'bad');
    current = null;
    setButtons(true, true);
    elScan.disabled = false;
    busyScan = false;
    return;
  }

  current = data.attendee;
  const estado = current.estado_pago || 'NO_PAGADO';
  const nombreCompleto = `${current.nombres ?? ''} ${current.apellidos ?? ''}`.trim();
  const institucion = current.institucion ?? '';
  const profesion   = (current.profesion ?? current.puesto ?? '');
  const correo      = current.correo ?? '';
  const pais        = current.pais ?? '';

  renderInfo(`
    <div><b>${nombreCompleto}</b></div>
    <div>${institucion} — ${profesion}</div>
    <div>${pais ? ('<span class="subtle">País: '+pais+'</span>') : ''} ${correo ? ('<span class="subtle"> · Correo: '+correo+'</span>') : ''}</div>
    <div>Estado pago: <span class="badge ${estado==='PAGADO'?'ok':'bad'}"><span class="dot"></span>${estado}</span></div>
    <div>Impreso: ${current.se_imprimio_at ? 'SI' : 'NO'}</div>
  `);

  const payAllowed   = CFG.SEDE === 'sede' && (CFG.ROL === 'admin' || CFG.ROL === 'cajero') && estado !== 'PAGADO';
  const printAllowed = (estado === 'PAGADO') && canUsePrinter();
  setButtons(!payAllowed, !printAllowed);

  if(estado === 'PAGADO' && !canUsePrinter()){
    renderInfo('Pago OK. <b>No hay impresora Zebra disponible</b>. Conéctala/instala BrowserPrint para habilitar impresión.', 'bad');
  }

  elScan.disabled = false;
  busyScan = false;
});

// --- PAGO (solo sede) ---
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

// --- IMPRESIÓN ---
// Flujo seguro: 1) imprimir físicamente 2) si OK -> marcar en servidor
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

  // 1) Intento Zebra
  try{
    await printPhysical(current); // lanza si falla
  }catch(e){
    renderInfo('Fallo de impresión. No se marcó como impreso. '+(e?.message||''), 'bad');
    btnPrint.disabled = false; // permitir reintento
    busyPrint = false;
    return;
  }

  // 2) Marcado en backend
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
    btnPrint.disabled = false; // permitir reintento de marcado
  }

  busyPrint = false;
});

// --- Rutina de impresión física (reintentos + ZPL 5 líneas + QR con UUID) ---
function printPhysical(att, maxRetry=5){
  const NOMBRE_COMPLETO = `${att.nombres ?? ''} ${att.apellidos ?? ''}`.trim();
  const INSTITUCION     = att.institucion ?? '';
  const PROFESION       = (att.profesion ?? att.puesto ?? '');
  const PAIS            = att.pais ?? '';
  const CORREO          = (att.correo ?? '').slice(0, 36); // evita desborde
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
        printer.send(zpl, function(){
          resolve(); // éxito real de Zebra
        }, function(err){
          if(attempts >= maxRetry){
            return reject(new Error('Error impresión Zebra: '+(err||'desconocido')));
          }
          renderInfo('Error impresión, reintentando...', 'bad');
          setTimeout(tryOnce, 1500);
        });
      }, function(err){
        if(attempts >= maxRetry){
          return reject(new Error('Impresora no disponible: '+(err||'desconocido')));
        }
        renderInfo('Impresora no disponible, reintentando...', 'bad');
        setTimeout(tryOnce, 1200);
      });
    }

    tryOnce();
  });
}

// Escapar caracteres que rompen ZPL
function escapeZPL(s){
  return String(s).replace(/[\^~\\]/g, ' ');
}

// --- Alta nueva (solo sede) ---
document.getElementById('btnAlta').addEventListener('click', async ()=>{
  const dni         = document.getElementById('dni').value.trim();
  const nombres     = document.getElementById('nombres').value.trim();
  const apellidos   = document.getElementById('apellidos').value.trim();
  const institucion = document.getElementById('institucion').value.trim();
  const puesto      = document.getElementById('puesto').value.trim(); // seguimos usando 'puesto'
  const correoEl    = document.getElementById('correo');
  const paisEl      = document.getElementById('pais');
  const correo      = (correoEl ? correoEl.value : '').trim();
  const pais        = (paisEl ? paisEl.value : '').trim();

  if(!dni || !nombres){ return alert('DNI y Nombres son obligatorios'); }
  if(CFG.SEDE!=='sede'){ return alert('Alta nueva solo en sede'); }

  const body = { dni, nombres, apellidos, institucion, puesto, correo, pais, sede_alta:'sede_principal' };

  const res = await fetchJSON('/api/register', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(body)
  });

  if(res.success){
    alert('Alta creada. Escanea el QR una vez generado.');
  } else {
    alert('Error creando alta');
  }
});
