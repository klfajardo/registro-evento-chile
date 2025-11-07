// charla.js — Control de acceso con auto check-in si llega ?uuid=... (&auto=1). Usa window.CFG.

// ====== CONFIG ======
const CFG = window.CFG || { SEDE: 'sede', SESSION_ID: '' };

// ====== ELEMENTOS ======
const elMeta  = document.getElementById('meta');
const elScan  = document.getElementById('scan');
const msg     = document.getElementById('msg');
const count   = document.getElementById('count');

if (elMeta) elMeta.textContent = `SEDE: ${CFG.SEDE || '—'} | SESSION: ${CFG.SESSION_ID || '—'}`;

// ====== NET HELPER ======
async function fetchJSON(url, opt = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs);
  try {
    const r = await fetch(url, { ...opt, signal: ctrl.signal, cache: 'no-store' });
    if (!r.ok) return { success: false, status: r.status, message: `HTTP ${r.status}` };
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return { success: false, message: 'Respuesta no-JSON' };
    return await r.json();
  } catch (e) {
    return { success: false, offline: true, error: String(e.message || e) };
  } finally {
    clearTimeout(id);
  }
}

function paint(ok, txt){
  msg.innerHTML = ok ? `<b class="ok">${txt||'OK'}</b>` : `<b class="no">${txt||'Error'}</b>`;
}

// ====== CHECK-IN ======
async function checkIn(uuid){
  if (!uuid) return;
  try{
    const res = await fetchJSON('/api/checkin', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ uuid, session_id: CFG.SESSION_ID, sede: CFG.SEDE })
    });
    if (res.success){
      const offlineNote = res.message && /offline/i.test(res.message) ? ' (offline)' : '';
      paint(true, 'Registrado' + offlineNote);
      refresh();
    } else {
      paint(false, res.message || 'Error');
    }
  }catch(_){
    paint(false, 'Offline / error de red');
  }
}

// ENTER manual
elScan?.addEventListener('keydown', async (e)=>{
  if (e.key !== 'Enter') return;
  if (e.repeat) return;
  const uuid = elScan.value.trim();
  elScan.value = '';
  await checkIn(uuid);
});

// Auto check-in desde URL (?uuid=...&auto=1)
(async function autoFromURL(){
  const p = new URLSearchParams(location.search);
  const uuid = p.get('uuid');
  const auto = p.get('auto') ?? '1';
  if (uuid){
    if (elScan) elScan.value = uuid;
    if (auto !== '0'){ await checkIn(uuid); }
    // limpiar la URL para evitar dobles registros si recargan
    try { history.replaceState({}, '', location.pathname); } catch(_) {}
  }
})();

// ====== DASHBOARD SESIÓN ======
async function refresh(){
  const j = await fetchJSON('/api/dashboard');
  if (j.success){
    const n = j.porSesion?.[CFG.SESSION_ID] || 0;
    if (count) count.textContent = `Ingresos a esta sesión: ${n}`;
  }
}
refresh();
setInterval(refresh, 3000);
