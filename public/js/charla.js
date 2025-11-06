async function cfg(){ return (await fetch('/config.json')).json(); }
const CFG = await cfg();
document.getElementById('meta').textContent = `SEDE: ${CFG.SEDE} | SESSION: ${CFG.SESSION_ID}`;

const elScan = document.getElementById('scan');
const msg = document.getElementById('msg');
const count = document.getElementById('count');

elScan.addEventListener('keydown', async (e)=>{
  if(e.key!=='Enter') return;
  const uuid = elScan.value.trim();
  if(!uuid) return;
  try{
    const r = await fetch('/api/checkin', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ uuid, session_id: CFG.SESSION_ID, sede: CFG.SEDE }) });
    const j = await r.json();
    if(j.success){ msg.innerHTML = '<b class="ok">OK</b>'; refresh(); }
    else msg.innerHTML = '<b class="no">Error</b> ' + (j.message||'');
  }catch(e){ msg.innerHTML = '<b class="no">Offline. Se reintentará.</b>'; }
  elScan.value='';
});

async function refresh(){
  const r = await fetch('/api/dashboard'); const j = await r.json();
  if(j.success){
    const n = j.porSesion?.[CFG.SESSION_ID] || 0;
    count.textContent = `Ingresos a esta sesión: ${n}`;
  }
}
setInterval(refresh, 3000); refresh();
