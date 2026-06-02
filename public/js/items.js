// Catálogo de items: listar, crear, editar, desactivar y ver/imprimir QR.
let soloBajos = false;
let usuarioRol = null;

const $ = (id) => document.getElementById(id);

async function cargarUsuario() {
  const r = await fetch('/api/auth/me');
  if (!r.ok) { window.location.href = '/login.html'; return; }
  const { usuario } = await r.json();
  usuarioRol = usuario.rol;
  $('userInfo').textContent = usuario.nombre;
}

async function cargarItems() {
  const q = $('buscar').value.trim();
  const tipo = $('filtroTipo').value;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (tipo) params.set('tipo', tipo);
  if (soloBajos) params.set('bajos', '1');

  const items = await (await fetch('/api/items?' + params)).json();
  const cont = $('lista');

  if (!items.length) {
    cont.innerHTML = '<div class="empty">No hay items que coincidan. Crea uno con “+ Nuevo item”.</div>';
    return;
  }

  let html = '<table><thead><tr><th>Código</th><th>Nombre</th><th>Tipo</th><th>Disponible</th><th>Ubicación</th><th></th></tr></thead><tbody>';
  for (const it of items) {
    const badge = it.tipo === 'retornable'
      ? '<span class="badge ret">Retornable</span>'
      : '<span class="badge con">Consumible</span>';
    const bajo = it.stock <= it.stock_minimo ? ' class="stock-bajo"' : '';
    let fuera = '';
    if (it.stock_reparacion > 0) {
      const enRep = it.stock_en_reparacion || 0;
      const dan = it.stock_reparacion - enRep;
      const partes = [];
      if (dan > 0) partes.push(`${formatNum(dan)} dañado`);
      if (enRep > 0) partes.push(`${formatNum(enRep)} en reparación`);
      fuera = `<br><span style="color:var(--naranjo);font-size:.78rem">🛠️ ${partes.join(' · ')}</span>`;
    }
    const stockTxt = `${formatNum(it.stock)} ${it.unidad}${fuera}`;
    html += `<tr>
      <td><strong>${esc(it.codigo)}</strong></td>
      <td>${esc(it.nombre)}${it.serie ? `<br><span class="muted">S/N: ${esc(it.serie)}</span>` : ''}</td>
      <td>${badge}</td>
      <td${bajo}>${stockTxt}</td>
      <td>${esc(it.ubicacion || '—')}</td>
      <td><div class="acciones">
        <button class="btn-sm" style="background:#e0f2fe" onclick='verQr(${it.id})'>QR</button>
        ${it.tipo === 'retornable' ? `<button class="btn-sm" style="background:#ffedd5;color:#9a3412" onclick='abrirEstado(${it.id})'>🛠️ Estado</button>` : ''}
        <button class="btn-sm" style="background:#e2e8f0" onclick='editar(${it.id})'>Editar</button>
        ${usuarioRol === 'admin' ? `<button class="btn-sm" style="background:#fee2e2;color:#dc2626" onclick='desactivar(${it.id},"${esc(it.codigo)}")'>Quitar</button>` : ''}
      </div></td>
    </tr>`;
  }
  html += '</tbody></table>';
  cont.innerHTML = html;
}

function formatNum(n) { return Number.isInteger(n) ? n : Number(n).toFixed(2); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ---- Crear / Editar ----
function abrirForm(item) {
  $('formMsg').className = 'msg';
  $('formItem').reset();
  if (item) {
    $('formTitulo').textContent = 'Editar item';
    $('itemId').value = item.id;
    $('f_nombre').value = item.nombre;
    $('f_tipo').value = item.tipo;
    $('f_tipo').disabled = true;          // no cambiar la naturaleza de un item ya creado
    $('f_categoria').value = item.categoria || '';
    $('f_codigo').value = item.codigo;
    $('f_codigo').disabled = true;
    $('f_serie').value = item.serie || '';
    $('f_stock').value = item.stock;
    $('f_stock').disabled = true;         // el stock se mueve por entradas/salidas, no a mano
    $('f_stock_minimo').value = item.stock_minimo;
    $('f_unidad').value = item.unidad;
    $('f_ubicacion').value = item.ubicacion || '';
  } else {
    $('formTitulo').textContent = 'Nuevo item';
    $('itemId').value = '';
    $('f_tipo').disabled = false;
    $('f_codigo').disabled = false;
    $('f_stock').disabled = false;
  }
  $('modalForm').classList.add('open');
}

async function editar(id) {
  const item = await (await fetch('/api/items/' + id)).json();
  abrirForm(item);
}

$('formItem').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('itemId').value;
  const payload = {
    nombre: $('f_nombre').value.trim(),
    tipo: $('f_tipo').value,
    categoria: $('f_categoria').value.trim(),
    codigo: $('f_codigo').value.trim(),
    serie: $('f_serie').value.trim(),
    stock: Number($('f_stock').value),
    stock_minimo: Number($('f_stock_minimo').value),
    unidad: $('f_unidad').value.trim() || 'unidad',
    ubicacion: $('f_ubicacion').value.trim()
  };
  const url = id ? '/api/items/' + id : '/api/items';
  const method = id ? 'PUT' : 'POST';
  const r = await fetch(url, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const data = await r.json();
  if (!r.ok) {
    $('formMsg').textContent = data.error || 'No se pudo guardar';
    $('formMsg').className = 'msg error';
    return;
  }
  $('modalForm').classList.remove('open');
  cargarItems();
});

async function desactivar(id, codigo) {
  if (!confirm(`¿Quitar el item ${codigo} del catálogo? Su historial se conserva.`)) return;
  const r = await fetch('/api/items/' + id, { method: 'DELETE' });
  if (r.ok) cargarItems();
  else alert('No se pudo quitar el item.');
}

// ---- QR ----
async function verQr(id) {
  const item = await (await fetch('/api/items/' + id)).json();
  $('qrCodigo').textContent = item.codigo;
  $('qrNombre').textContent = item.nombre;
  $('qrImg').src = '/api/items/' + id + '/qr.png';
  $('modalQr').classList.add('open');
}

// ---- Estado del equipo (enviar a reparación / reparado / baja) ----
let estadoItemId = null;

async function abrirEstado(id) {
  const item = await (await fetch('/api/items/' + id)).json();
  estadoItemId = item.id;
  $('estadoTitulo').textContent = 'Estado: ' + item.codigo + ' · ' + item.nombre;
  $('estadoMsg').className = 'msg';
  renderEstado(item);
  $('modalEstado').classList.add('open');
}

function renderEstado(item) {
  const u = esc(item.unidad);
  const X = item.stock;
  const R = item.stock_en_reparacion || 0;          // ya en reparación
  const FS = item.stock_reparacion || 0;            // total fuera de servicio
  const D = FS - R;                                 // dañados esperando ser enviados

  let html = `<p>Disponibles: <strong>${formatNum(X)}</strong> ${u}`
    + ` · 🛠️ Dañados: <strong style="color:var(--naranjo)">${formatNum(D)}</strong>`
    + ` · 🔧 En reparación: <strong style="color:var(--naranjo)">${formatNum(R)}</strong></p>`;

  // Bloque fuera de servicio (dañados + en reparación)
  if (FS > 0) {
    html += `<div class="card" style="margin-top:.8rem;background:#fff7ed;border:1px solid #fed7aa">
      <strong>🛠️ Fuera de servicio (${formatNum(FS)})</strong>`;
    if (D > 0) {
      html += `<label style="margin-top:.6rem">Enviar a reparación (solo marca que está en el taller; NO cambia el stock)</label>
        <div style="display:flex;gap:.5rem">
          <input type="number" id="es_enviar" value="${formatNum(D)}" min="0.01" max="${D}" step="any" style="flex:1">
          <button type="button" class="btn-inline" onclick="accionEstado('enviar_reparacion','es_enviar')">A reparación</button>
        </div>`;
    }
    html += `<label style="margin-top:.6rem">Reparado (vuelve al stock disponible)</label>
      <div style="display:flex;gap:.5rem">
        <input type="number" id="es_rep" value="1" min="0.01" max="${FS}" step="any" style="flex:1">
        <button type="button" class="btn-inline" style="background:#16a34a" onclick="accionEstado('reparado','es_rep')">Reparado</button>
      </div>
      <label style="margin-top:.6rem">Dar de baja (sale del inventario)</label>
      <div style="display:flex;gap:.5rem">
        <input type="number" id="es_baja_r" value="1" min="0.01" max="${FS}" step="any" style="flex:1">
        <button type="button" class="btn-inline danger" onclick="accionEstado('baja','es_baja_r',{origen:'reparacion'})">Baja</button>
      </div>
    </div>`;
  }

  // Bloque unidades disponibles
  if (X > 0) {
    html += `<div class="card" style="margin-top:.8rem">
      <strong>Unidades disponibles (${formatNum(X)})</strong>
      <label style="margin-top:.6rem">¿Se dañó una en bodega? Enviar a reparación (descuenta del disponible)</label>
      <div style="display:flex;gap:.5rem">
        <input type="number" id="es_danar" value="1" min="0.01" max="${X}" step="any" style="flex:1">
        <button type="button" class="btn-inline" onclick="accionEstado('danar_disponible','es_danar')">A reparación</button>
      </div>
      <label style="margin-top:.6rem">Dar de baja una disponible (sale del inventario)</label>
      <div style="display:flex;gap:.5rem">
        <input type="number" id="es_baja_d" value="1" min="0.01" max="${X}" step="any" style="flex:1">
        <button type="button" class="btn-inline danger" onclick="accionEstado('baja','es_baja_d',{origen:'disponible'})">Baja</button>
      </div>
    </div>`;
  }

  if (X <= 0 && FS <= 0) html += '<p class="muted">Este equipo no tiene unidades.</p>';
  $('estadoBody').innerHTML = html;
}

async function postEstado(body) {
  const r = await fetch('/api/movimientos/estado-equipo', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const data = await r.json();
  if (!r.ok) { $('estadoMsg').textContent = data.error || 'No se pudo registrar'; $('estadoMsg').className = 'msg error'; return; }
  const item = await (await fetch('/api/items/' + estadoItemId)).json();
  renderEstado(item);
  $('estadoMsg').textContent = 'Listo ✔'; $('estadoMsg').className = 'msg ok';
  cargarItems();
}

function accionEstado(accion, inputId, extra) {
  postEstado(Object.assign({ item_id: estadoItemId, accion, cantidad: Number($(inputId).value) }, extra || {}));
}

// ---- Eventos ----
$('btnNuevo').addEventListener('click', () => abrirForm(null));
$('btnCancelar').addEventListener('click', () => $('modalForm').classList.remove('open'));
$('btnCerrarQr').addEventListener('click', () => $('modalQr').classList.remove('open'));
$('btnImprimir').addEventListener('click', () => window.print());
$('buscar').addEventListener('input', () => { soloBajos = false; cargarItems(); });
$('filtroTipo').addEventListener('change', cargarItems);
$('btnBajos').addEventListener('click', () => { soloBajos = !soloBajos; cargarItems(); });

cargarUsuario();
cargarItems();
