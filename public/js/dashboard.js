document.addEventListener('DOMContentLoaded', async () => {
  const $ = id => document.getElementById(id);

  const elMeta     = $('meta');
  const elTotal    = $('kTotal');
  const elPagados  = $('kPagados');
  const elImpresos = $('kImpresos');
  const elList     = $('kSesionesList');

  async function loadCfg(){
    try{
      const r = await fetch('/config.json', { cache:'no-store' });
      if(!r.ok) return {};
      return await r.json();
    }catch(_){ return {}; }
  }
  const CFG = await loadCfg();
  if (elMeta) elMeta.textContent = `SEDE: ${CFG.SEDE ?? '—'}`;

  function renderPorSesion(map){
    if (!elList) return;

    const entries = Object.entries(map || {});
    if (!entries.length){
      elList.classList.add('empty');
      elList.textContent = 'Sin accesos registrados todavía.';
      return;
    }

    elList.classList.remove('empty');
    entries.sort((a,b)=>b[1]-a[1]);

    const frag = document.createDocumentFragment();
    for (const [name, count] of entries){
      const row = document.createElement('div');
      row.className = 'sess-row';

      const left  = document.createElement('div');
      left.className = 'sess-name';
      left.textContent = name;

      const right = document.createElement('div');
      right.className = 'sess-right';

      // SOLO el número a la par (pill), sin barra
      const pill  = document.createElement('span');
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

  async function refresh(){
    try{
      const r = await fetch('/api/dashboard', { cache:'no-store' });
      if(!r.ok) return;
      const j = await r.json();
      if(!j.success) return;

      if (elTotal)    elTotal.textContent    = j.total    ?? '—';
      if (elPagados)  elPagados.textContent  = j.pagados  ?? '—';
      if (elImpresos) elImpresos.textContent = j.impresos ?? '—';
      renderPorSesion(j.porSesion);
    }catch(_){ /* silencioso */ }
  }

  refresh();
  setInterval(refresh, 3000);
});
