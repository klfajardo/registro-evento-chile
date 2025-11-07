// dashboard.js — usa window.CFG (settings.js), sin /config.json

// ====== CONFIG ======
const CFG = window.CFG || { SEDE: 'sede' };

// Base opcional para apuntar a otra API (dejar vacío para mismo host)
const API_BASE = (CFG.API_BASE || '').replace(/\/+$/, '');
const withBase = (p) => (API_BASE ? API_BASE + p : p);

// Header opcional de admin si lo definiste en Ajustes
function addAdminHeader(h = {}) {
  const out = { ...h };
  if (CFG.ADMIN_TOKEN) out['x-admin-token'] = CFG.ADMIN_TOKEN;
  return out;
}

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

document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);

  const elMeta     = $('meta');
  const elTotal    = $('kTotal');
  const elPagados  = $('kPagados');
  const elImpresos = $('kImpresos');
  const elList     = $('kSesionesList');

  if (elMeta) elMeta.textContent = `SEDE: ${CFG.SEDE ?? '—'}`;

  function renderPorSesion(map) {
    if (!elList) return;

    const entries = Object.entries(map || {});
    if (!entries.length) {
      elList.classList.add('empty');
      elList.textContent = 'Sin accesos registrados todavía.';
      return;
    }

    elList.classList.remove('empty');
    entries.sort((a, b) => b[1] - a[1]);

    const frag = document.createDocumentFragment();
    for (const [name, count] of entries) {
      const row = document.createElement('div');
      row.className = 'sess-row';

      const left = document.createElement('div');
      left.className = 'sess-name';
      left.textContent = name;

      const right = document.createElement('div');
      right.className = 'sess-right';

      // Solo el número (pill), sin barra
      const pill = document.createElement('span');
      pill.className = 'sess-pill';
      pill.textContent = count;

      right.appendChild(pill);
      row.appendChild(left);
      row.appendChild(right);
      frag.appendChild(row);
    }

    elList.innerHTML = '';
    elList.appendChild(frag);
  }

  async function refresh() {
    const j = await fetchJSON('/api/dashboard');
    if (!j.success) return;

    if (elTotal)    elTotal.textContent    = j.total    ?? '—';
    if (elPagados)  elPagados.textContent  = j.pagados  ?? '—';
    if (elImpresos) elImpresos.textContent = j.impresos ?? '—';

    renderPorSesion(j.porSesion);
  }

  refresh();
  setInterval(refresh, 3000);
});
