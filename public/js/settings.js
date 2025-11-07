// /public/js/settings.js — versión simple (ROL, SEDE, SESSION_ID)
(function(){
  if (window.__CFG_BOOTSTRAPPED) return;
  window.__CFG_BOOTSTRAPPED = true;

  const DEFAULT_CFG = {
    ROL: 'staff',        // 'admin' | 'cajero' | 'staff'
    SEDE: 'sede',        // 'sede' | 'sala-1' | etc
    SESSION_ID: ''       // ej. 'charla_gallito_1'
  };

  const safeJSON = (s)=>{ try { return JSON.parse(s); } catch(_) { return null; } };
  const readLS   = ()=> safeJSON(localStorage.getItem('slp_cfg')) || {};
  const fromURL  = ()=>{
    const p = new URLSearchParams(location.search);
    const keys = ['ROL','SEDE','SESSION_ID'];
    const out = {};
    for (const k of keys){
      const v = p.get(k) || p.get(k.toLowerCase());
      if (v) out[k] = v;
    }
    return out;
  };

  // Construye CFG (respeta window.CFG si ya existe)
  const CFG = window.CFG
    ? Object.assign({}, DEFAULT_CFG, window.CFG, readLS(), fromURL())
    : Object.assign({}, DEFAULT_CFG, readLS(), fromURL());

  localStorage.setItem('slp_cfg', JSON.stringify(CFG));
  window.CFG = CFG;

  // Pinta meta si existe
  function paintMeta(){
    const meta = document.getElementById('meta');
    if(!meta) return;
    const bits = [`ROL: ${CFG.ROL}`, `SEDE: ${CFG.SEDE}`];
    if (CFG.SESSION_ID) bits.push(`SESIÓN: ${CFG.SESSION_ID}`);
    meta.textContent = bits.join(' | ');
  }
  paintMeta();

  // Guardado público
  window.saveCFG = (patch)=>{
    Object.assign(CFG, patch);
    localStorage.setItem('slp_cfg', JSON.stringify(CFG));
    paintMeta();
  };

  // AUTO-UI: si no existe botón/modal, los inyecta
  document.addEventListener('DOMContentLoaded', ()=>{
    let btnOpen  = document.getElementById('btnSettings');
    let modal    = document.getElementById('settingsModal');
    let form     = document.getElementById('settingsForm');

    if (!btnOpen || !modal || !form){
      // Estilos mínimos del modal
      const style = document.createElement('style');
      style.textContent = `
        #settingsModal.is-hidden{display:none!important}
        #settingsModal{position:fixed;inset:0;background:rgba(0,0,0,.35);display:grid;place-items:center;z-index:9999}
      `;
      document.head.appendChild(style);

      // Insertar botón en primer <nav> del header o flotar si no hay
      const header = document.querySelector('header .container') || document.body;
      let nav = header.querySelector('nav');
      if (!nav){
        nav = document.createElement('div');
        nav.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:9999';
        header.appendChild(nav);
      }

      btnOpen = document.createElement('a');
      btnOpen.id = 'btnSettings';
      btnOpen.href = '#';
      btnOpen.textContent = '⚙ Ajustes';
      btnOpen.style.marginLeft = '12px';
      nav.appendChild(btnOpen);

      // Modal + form
      modal = document.createElement('div');
      modal.id = 'settingsModal';
      modal.className = 'is-hidden';
      modal.innerHTML = `
        <div class="card" style="width:min(520px,92vw)" role="dialog" aria-modal="true">
          <h3 class="section-title" style="margin-top:0">Ajustes del dispositivo</h3>
          <form id="settingsForm" class="form-grid" style="margin-top:8px">
            <label>
              <div class="subtle" style="margin-bottom:6px">Rol</div>
              <select id="cfgRol" class="input">
                <option value="staff">staff</option>
                <option value="cajero">cajero</option>
                <option value="admin">admin</option>
              </select>
            </label>
            <label>
              <div class="subtle" style="margin-bottom:6px">Sede / Ubicación</div>
              <input id="cfgSede" class="input" placeholder="ej: sede" />
            </label>
            <label>
              <div class="subtle" style="margin-bottom:6px">SESSION_ID (Charla)</div>
              <input id="cfgSession" class="input" placeholder="ej: charla_gallito_1" />
            </label>
            <div class="actions" style="grid-template-columns:1fr 1fr; margin-top:12px">
              <button type="button" id="btnCloseSettings" class="btn secondary">Cancelar</button>
              <button type="submit" class="btn">Guardar</button>
            </div>
            <div class="actions" style="grid-template-columns:1fr; margin-top:8px">
              <button type="button" id="btnResetSettings" class="btn accent">Resetear (limpiar settings de este dispositivo)</button>
            </div>
          </form>
        </div>`;
      document.body.appendChild(modal);

      form = modal.querySelector('#settingsForm');
    }

    const btnClose = document.getElementById('btnCloseSettings');
    const btnReset = document.getElementById('btnResetSettings');
    const $ = (id)=> form.querySelector('#'+id);

    const fill = ()=>{
      if ($('cfgRol'))     $('cfgRol').value     = CFG.ROL;
      if ($('cfgSede'))    $('cfgSede').value    = CFG.SEDE;
      if ($('cfgSession')) $('cfgSession').value = CFG.SESSION_ID || '';
    };

    btnOpen.addEventListener('click', (e)=>{ e.preventDefault(); fill(); modal.classList.remove('is-hidden'); });
    btnClose?.addEventListener('click', ()=> modal.classList.add('is-hidden'));
    modal.addEventListener('click', (e)=>{ if(e.target===modal) modal.classList.add('is-hidden'); });

    form.addEventListener('submit', (e)=>{
      e.preventDefault();
      window.saveCFG({
        ROL: $('cfgRol')?.value?.trim() || 'staff',
        SEDE: $('cfgSede')?.value?.trim() || 'sede',
        SESSION_ID: $('cfgSession')?.value?.trim() || ''
      });
      modal.classList.add('is-hidden');
    });

    btnReset?.addEventListener('click', ()=>{
      localStorage.removeItem('slp_cfg');
      location.reload();
    });
  });
})();
