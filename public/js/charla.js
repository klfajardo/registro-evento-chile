// charla.js — Control de acceso. Usa window.CFG.
// QR: contiene directamente el UUID (sin URL).
// Requiere ZXing UMD cargado antes (window.ZXing).

// ====== CONFIG ======
const CFG = window.CFG || { SEDE: 'sede', SESSION_ID: '' };

// ====== ELEMENTOS ======
const elMeta   = document.getElementById('meta');
const elScan   = document.getElementById('scan');
const msg      = document.getElementById('msg');
const count    = document.getElementById('count');

const camToggle = document.getElementById('cam-toggle');
const camWrap   = document.getElementById('cam-wrap');
const camView   = document.getElementById('cam-view');
const camStatus = document.getElementById('cam-status');

if (elMeta) {
  elMeta.textContent = `SEDE: ${CFG.SEDE || '—'} | SESSION: ${CFG.SESSION_ID || '—'}`;
}

// ====== NET HELPER ======
async function fetchJSON(url, opt = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs);
  try {
    const r = await fetch(url, { ...opt, signal: ctrl.signal, cache: 'no-store' });
    if (!r.ok) {
      return { success: false, status: r.status, message: `HTTP ${r.status}` };
    }
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      return { success: false, message: 'Respuesta no-JSON' };
    }
    return await r.json();
  } catch (e) {
    return { success: false, offline: true, error: String(e.message || e) };
  } finally {
    clearTimeout(id);
  }
}

function paint(ok, txt) {
  if (!msg) return;
  msg.innerHTML = ok
    ? `<b class="ok">${txt || 'OK'}</b>`
    : `<b class="no">${txt || 'Error'}</b>`;
}

// ====== UUID HELPER ======
function isValidUUID(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

// ====== CHECK-IN ======
async function checkIn(uuid) {
  if (!uuid || !isValidUUID(uuid)) {
    paint(false, 'UUID inválido');
    return;
  }

  try {
    const res = await fetchJSON('/api/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uuid,
        session_id: CFG.SESSION_ID,
        sede: CFG.SEDE
      })
    });

    if (res.success) {
      const offlineNote =
        res.message && /offline/i.test(res.message) ? ' (offline)' : '';
      paint(true, 'Registrado' + offlineNote);
      refresh();
    } else {
      paint(false, res.message || 'Error');
    }
  } catch {
    paint(false, 'Offline / error de red');
  }
}

// ====== INPUT MANUAL (scanner USB o tipeo) ======
elScan?.addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter' || e.repeat) return;

  const raw = elScan.value.trim();
  elScan.value = '';

  if (!isValidUUID(raw)) {
    paint(false, 'UUID inválido');
    return;
  }

  await checkIn(raw);
});

// ====== AUTO CHECK-IN OPCIONAL DESDE URL (?uuid=...&auto=1) ======
(function autoFromURL() {
  const p = new URLSearchParams(location.search);
  const uuid = p.get('uuid');
  const auto = p.get('auto') ?? '1';

  if (uuid && isValidUUID(uuid)) {
    if (elScan) elScan.value = uuid;
    if (auto !== '0') {
      checkIn(uuid);
    }
    try {
      history.replaceState({}, '', location.pathname);
    } catch {}
  }
})();

// ====== DASHBOARD SESIÓN ======
async function refresh() {
  const j = await fetchJSON('/api/dashboard');
  if (j.success) {
    const n = j.porSesion?.[CFG.SESSION_ID] ?? 0;
    if (count) {
      count.textContent = `Ingresos a esta sesión: ${n}`;
    }
  }
}
refresh();
setInterval(refresh, 3000);

// ====== ESCANEO CON CÁMARA (QR integrado) ======

let codeReader = null;
let scanning = false;
let lastUUID = null;
let lastScanTs = 0;

function ensureZXing() {
  if (!window.ZXing || !window.ZXing.BrowserMultiFormatReader) {
    console.error('ZXing no está disponible. Revisa la carga del script UMD.');
    if (camStatus) {
      camStatus.textContent = 'Error cargando lector QR. Revisa conexión.';
    }
    paint(false, 'No se pudo inicializar el lector QR');
    return false;
  }
  return true;
}

async function startCameraScanner() {
  if (!camView || scanning) return;
  if (!ensureZXing()) return;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (camStatus) camStatus.textContent = 'Este navegador no soporta cámara.';
    paint(false, 'Navegador sin soporte de cámara');
    return;
  }

  if (!codeReader) {
    codeReader = new window.ZXing.BrowserMultiFormatReader();
  }

  scanning = true;
  if (camWrap) camWrap.style.display = 'block';
  if (camStatus) camStatus.textContent = 'Apunta al código QR…';

  try {
    await codeReader.decodeFromVideoDevice(
      null,              // cámara por defecto
      camView,           // elemento <video>
      async (result, err) => {
        if (!scanning) return;

        if (result) {
          const text =
            (typeof result.getText === 'function'
              ? result.getText()
              : result.text) || '';
          const uuid = text.trim();

          if (!isValidUUID(uuid)) {
            // QR ajeno → ignorar
            return;
          }

          const now = Date.now();
          if (uuid === lastUUID && now - lastScanTs < 1500) {
            // evitar doble lectura inmediata
            return;
          }

          lastUUID = uuid;
          lastScanTs = now;

          await checkIn(uuid);
        }

        // Errores de lectura son normales mientras escanea.
        if (err && !(err instanceof window.ZXing.NotFoundException)) {
          console.warn('ZXing error:', err);
        }
      }
    );
  } catch (e) {
    scanning = false;
    console.error('Error al iniciar cámara:', e);
    if (camStatus) {
      camStatus.textContent =
        'No se pudo acceder a la cámara. Revisa permisos o usa el escáner manual.';
    }
    paint(false, 'Error al iniciar cámara');
  }
}

async function stopCameraScanner() {
  if (!codeReader || !scanning) {
    scanning = false;
    if (camWrap) camWrap.style.display = 'none';
    return;
  }

  scanning = false;
  try {
    codeReader.reset(); // detiene stream
  } catch (e) {
    console.warn('Error al detener cámara:', e);
  }

  if (camWrap) camWrap.style.display = 'none';
  if (camStatus) camStatus.textContent = 'Cámara detenida.';
}

// Toggle botón cámara
camToggle?.addEventListener('click', () => {
  if (!scanning) {
    startCameraScanner();
    if (camToggle) camToggle.textContent = 'Detener cámara';
  } else {
    stopCameraScanner();
    if (camToggle) camToggle.textContent = 'Usar cámara para escanear';
  }
});
