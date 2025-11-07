<script type="module">
// settings.js
(function(){
  const DEFAULT_CFG = {
    ROL: 'staff',          // 'admin' | 'cajero' | 'staff'
    SEDE: 'sede',          // 'sede' | 'remoto' | etc
    SESSION_ID: '',        // ej. 'charla_gallito_1'
    API_BASE: '',          // ej. 'https://registro-evento-chile.onrender.com'
    ADMIN_TOKEN: ''        // opcional: para endpoints protegidos (import)
  };

  function safeJSON(str){ try{ return JSON.parse(str); }catch(_){ return null; } }
  function readLS(){ return safeJSON(localStorage.getItem('slp_cfg')) || {}; }

  function fromURL(){
    const p = new URLSearchParams(location.search);
    const get = k => p.get(k) || p.get(k.toLowerCase()) || undefined;
    const keys = ['ROL','SEDE','SESSION_ID','API_BASE','ADMIN_TOKEN'];
    const out = {};
    for (const k of keys){ const v = get(k); if (v) out[k] = v; }
    return out;
  }

  const CFG = Object.assign({}, DEFAULT_CFG, readLS(), fromURL());
  localStorage.setItem('slp_cfg', JSON.stringify(CFG));
  window.CFG = CFG;

  // helper para pintar meta si existe
  function paintMeta(){
    const meta = document.getElementById('meta');
    if(!meta) return;
    const bits = [`ROL: ${CFG.ROL}`, `SEDE: ${CFG.SEDE}`];
    if (CFG.SESSION_ID) bits.push(`SESIÓN: ${CFG.SESSION_ID}`);
    meta.textContent = bits.join(' | ');
  }
  paintMeta();

  // Exponer guardado
  window.saveCFG = (patch) => {
    Object.assign(CFG, patch);
    localStorage.setItem('slp_cfg', JSON.stringify(CFG));
    paintMeta();
  };

  // Wire modal si existe en el DOM
  document.addEventListener('DOMContentLoaded', ()=>{
    const btnOpen  = document.getElementById('btnSettings');
    const modal    = document.getElementById('settingsModal');
    const form     = document.getElementById('settingsForm');
    const btnClose = document.getElementById('btnCloseSettings');
    const btnReset = document.getElementById('btnResetSettings');

    if(!btnOpen || !modal || !form) return;

    const $ = id => form.querySelector(`#${id}`);

    // Cargar valores
    const fill = ()=>{
      $('cfgRol').value        = CFG.ROL;
      $('cfgSede').value       = CFG.SEDE;
      $('cfgSession').value    = CFG.SESSION_ID || '';
      $('cfgApiBase').value    = CFG.API_BASE || '';
      $('cfgAdminToken').value = CFG.ADMIN_TOKEN || '';
    };

    // Abrir
    btnOpen.addEventListener('click', ()=>{
      fill();
      modal.classList.remove('is-hidden');
    });
    // Cerrar
    btnClose?.addEventListener('click', ()=> modal.classList.add('is-hidden'));
    modal.addEventListener('click', (e)=>{ if(e.target===modal) modal.classList.add('is-hidden'); });

    // Guardar
    form.addEventListener('submit', (e)=>{
      e.preventDefault();
      saveCFG({
        ROL: $('cfgRol').value.trim() || 'staff',
        SEDE: $('cfgSede').value.trim() || 'sede',
        SESSION_ID: $('cfgSession').value.trim(),
        API_BASE: $('cfgApiBase').value.trim(),
        ADMIN_TOKEN: $('cfgAdminToken').value.trim()
      });
      modal.classList.add('is-hidden');
      // Aviso visual simple
      const hint = document.getElementById('settingsHint');
      if (hint){ hint.textContent = 'Ajustes guardados.'; setTimeout(()=>hint.textContent='', 2000); }
    });

    // Reset
    btnReset?.addEventListener('click', ()=>{
      localStorage.removeItem('slp_cfg');
      window.location.reload();
    });
  });
})();
</script>
