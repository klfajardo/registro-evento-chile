// charla.js — usa window.CFG (inyectada por settings.js), sin /config.json

// ====== CONFIG ======
const CFG = window.CFG || { SEDE: 'sede', SESSION_ID: 'sesion_demo' };

// Base opcional para apuntar a otra API (dejar vacío para mismo host)
const API_BASE = (CFG.API_BASE || '').replace(/\/+$/, '');
const withBase = (p) => (API_BASE ? API_BASE + p : p);

// Header opcional de admin si lo configuraste en Ajustes
function addAdminHeader(h = {}) {
  const out = { ...h };
  if (CFG.ADMIN_TOKEN) out['x-admin-token'] = CFG.ADMIN_TOKEN;
  return out;
}

// ====== ELEMENTOS ======
const elMeta  = document.getElementById('meta');
const elScan  = document.getElementById('scan');
const msg     = document.getElementById('msg');
const count   = document.getElementById('count');

if (elMeta) elMeta.textContent = `SEDE: ${CFG.SEDE} | SESSION: ${CFG.SESSION_ID}`;

// ====== NET HELPER (timeout + base + admin header) ======
async function fetchJSON(url, opt = {}, timeoutMs = 8000) {
  const full = url.startsWith('http') ? url : withBase(url);
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs);
  try {
    const r = await fetch(full, { ...opt, headers: addAdminHeader(opt.headers || {}), signal: ctrl.signal, cache: 'no-store' });
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

// ====== CHECK-IN POR UUID ======
elScan.addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  if (e.repeat) return;

  const uuid = elScan.value.trim();
  if (!uuid) return;

  try {
    const res = await fetchJSON('/api/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uuid, session_id: CFG.SESSION_ID, sede: CFG.SEDE })
    });

    if (res.success) {
      const offlineNote = res.message && /offline/i.test(res.message) ? ' (offline)' : '';
      msg.innerHTML = `<b class="ok">OK${offlineNote}</b>`;
      refresh();
    } else {
      msg.innerHTML = '<b class="no">Error</b> ' + (res.message || '');
    }
  } catch (_) {
    msg.innerHTML = '<b class="no">Offline. Se reintentará.</b>';
  }

  elScan.value = '';
});

// ====== DASHBOARD DE LA SESIÓN ======
async function refresh() {
  const j = await fetchJSON('/api/dashboard');
  if (j.success) {
    const n = (j.porSesion && j.porSesion[CFG.SESSION_ID]) || 0;
    if (count) count.textContent = `Ingresos a esta sesión: ${n}`;
  }
}

setInterval(refresh, 3000);
refresh();
