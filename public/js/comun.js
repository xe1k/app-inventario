// Utilidades compartidas por las páginas de la app.
const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function formatNum(n) { return Number.isInteger(n) ? n : Number(n).toFixed(2); }

// Carga el usuario en sesión, lo pinta en #userInfo y lo devuelve.
async function cargarUsuario() {
  const r = await fetch('/api/auth/me');
  if (!r.ok) { window.location.href = '/login.html'; return null; }
  const { usuario } = await r.json();
  const el = $('userInfo');
  if (el) {
    const turno = usuario.turno ? ` · turno ${usuario.turno}` : '';
    el.textContent = `${usuario.nombre}${turno}`;
  }
  return usuario;
}

// Muestra un mensaje en un contenedor .msg (id dado).
function mostrarMsg(id, texto, tipo = 'ok') {
  const el = $(id);
  el.textContent = texto;
  el.className = 'msg ' + tipo;
}

// GET helper que devuelve JSON.
async function getJSON(url) { const r = await fetch(url); return r.json(); }

// POST helper. Devuelve { ok, data }.
async function postJSON(url, body, method = 'POST') {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { ok: r.ok, data: await r.json() };
}

// Busca un item por su código exacto (lo que entrega el escáner).
// Devuelve el item, o null si no existe (avisando al usuario).
async function itemPorCodigo(codigo) {
  const r = await fetch('/api/items/codigo/' + encodeURIComponent(codigo));
  if (r.status === 404) { alert('No hay ningún item con el código escaneado: ' + codigo); return null; }
  if (!r.ok) { alert('No se pudo buscar el código escaneado.'); return null; }
  return r.json();
}

// Conecta un input de búsqueda a un <select> de items.
// opts.tipo limita a 'retornable' / 'consumible'. Devuelve recargar().
function montarSelectorItems(buscarEl, selectEl, opts = {}) {
  async function recargar() {
    const params = new URLSearchParams();
    const q = buscarEl.value.trim();
    if (q) params.set('q', q);
    if (opts.tipo) params.set('tipo', opts.tipo);
    const items = await getJSON('/api/items?' + params);
    selectEl.innerHTML = '<option value="">— elige un item —</option>' + items.map(i =>
      `<option value="${i.id}" data-tipo="${i.tipo}" data-unidad="${esc(i.unidad)}" data-stock="${i.stock}"` +
      ` data-codigo="${esc(i.codigo)}" data-nombre="${esc(i.nombre)}" data-ubicacion="${esc(i.ubicacion || '')}">` +
      `${esc(i.codigo)} · ${esc(i.nombre)}${i.ubicacion ? ' · 📍 ' + esc(i.ubicacion) : ''} (stock ${formatNum(i.stock)} ${esc(i.unidad)})</option>`
    ).join('');
  }
  buscarEl.addEventListener('input', recargar);
  recargar();
  return recargar;
}
