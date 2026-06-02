// Reportes y auditoría. Pestañas: General, Stock, Movimientos, Por trabajador, Auditoría.
// Cada apartado se puede imprimir / guardar como PDF.
let esAdmin = false;
const cargado = {};   // qué pestaña ya cargó datos (para no recargar al cambiar)

function fechaCorta(s) { return s ? String(s).replace('T', ' ').slice(0, 16) : ''; }

// ---------- Navegación por pestañas ----------
function activarTab(nombre) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('activa', t.dataset.tab === nombre));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('activa', p.id === 'panel-' + nombre));
  if (!cargado[nombre]) { cargado[nombre] = true; CARGADORES[nombre] && CARGADORES[nombre](); }
}

// ---------- STOCK ----------
async function cargarStock() {
  const q = $('stockBuscar').value.trim();
  $('stockCSV').href = '/api/reportes/export/stock.csv' + (q ? '?q=' + encodeURIComponent(q) : '');
  $('stockImprimir').href = '/api/reportes/stock/imprimir' + (q ? '?q=' + encodeURIComponent(q) : '');
  const filas = await getJSON('/api/reportes/stock' + (q ? '?q=' + encodeURIComponent(q) : ''));
  if (!filas.length) { $('stockTabla').innerHTML = '<div class="empty">Sin items.</div>'; return; }
  let html = '<table><thead><tr><th>Código</th><th>Nombre</th><th>Tipo</th><th>Ubicación</th><th>Stock</th><th>Mínimo</th></tr></thead><tbody>';
  for (const it of filas) {
    html += `<tr>
      <td><strong>${esc(it.codigo)}</strong></td>
      <td>${esc(it.nombre)}${it.serie ? '<br><span class="muted">S/N ' + esc(it.serie) + '</span>' : ''}</td>
      <td><span class="badge ${it.tipo === 'retornable' ? 'ret' : 'con'}">${it.tipo === 'retornable' ? 'Retornable' : 'Consumible'}</span></td>
      <td>${esc(it.ubicacion || '—')}</td>
      <td class="${it.bajo ? 'stock-bajo' : ''}">${formatNum(it.stock)} ${esc(it.unidad)}</td>
      <td>${it.stock_minimo > 0 ? formatNum(it.stock_minimo) + ' ' + esc(it.unidad) : '—'}</td>
    </tr>`;
  }
  $('stockTabla').innerHTML = html + '</tbody></table>';
}

// ---------- MOVIMIENTOS ----------
const NOMBRE_TIPO = { entrada: 'Entradas', salida: 'Salidas', devolucion: 'Devoluciones', ajuste: 'Ajustes' };

async function cargarMovimientos() {
  const params = new URLSearchParams();
  if ($('movDesde').value) params.set('desde', $('movDesde').value);
  if ($('movHasta').value) params.set('hasta', $('movHasta').value);
  $('movCSV').href = '/api/reportes/export/movimientos.csv?' + params;
  $('movImprimir').href = '/api/reportes/movimientos/imprimir?' + params;
  const d = await getJSON('/api/reportes/movimientos?' + params);

  if (!d.por_tipo.length) {
    $('movPorTipo').innerHTML = '<div class="empty">Sin movimientos en el período.</div>';
  } else {
    let html = '<table><thead><tr><th>Tipo</th><th>Movimientos</th><th>Unidades</th></tr></thead><tbody>';
    for (const r of d.por_tipo) {
      html += `<tr><td>${NOMBRE_TIPO[r.tipo] || esc(r.tipo)}</td><td>${r.movimientos}</td><td>${formatNum(r.unidades)}</td></tr>`;
    }
    $('movPorTipo').innerHTML = html + '</tbody></table>';
  }

  if (!d.top_salidas.length) {
    $('movTop').innerHTML = '<div class="empty">Sin salidas en el período.</div>';
  } else {
    let html = '<table><thead><tr><th>Código</th><th>Item</th><th>Veces</th><th>Unidades</th></tr></thead><tbody>';
    for (const r of d.top_salidas) {
      html += `<tr><td><strong>${esc(r.codigo)}</strong></td><td>${esc(r.nombre)}</td><td>${r.veces}</td><td>${formatNum(r.unidades)} ${esc(r.unidad)}</td></tr>`;
    }
    $('movTop').innerHTML = html + '</tbody></table>';
  }
}

// ---------- POR TRABAJADOR ----------
async function cargarTrabajadores() {
  const params = new URLSearchParams();
  if ($('trabDesde').value) params.set('desde', $('trabDesde').value);
  if ($('trabHasta').value) params.set('hasta', $('trabHasta').value);
  $('trabCSV').href = '/api/reportes/export/trabajadores.csv?' + params;
  $('trabImprimir').href = '/api/reportes/trabajadores/imprimir?' + params;
  const filas = await getJSON('/api/reportes/trabajadores?' + params);
  if (!filas.length) { $('trabTabla').innerHTML = '<div class="empty">Sin trabajadores.</div>'; return; }
  let html = '<table><thead><tr><th>Trabajador</th><th>Área</th><th>Retiros</th><th>Unidades</th><th>Pendiente devolver</th></tr></thead><tbody>';
  for (const t of filas) {
    html += `<tr style="cursor:pointer" onclick="verTrabajador(${t.id})">
      <td><strong>${esc(t.nombre)}</strong>${t.identificador ? '<br><span class="muted">' + esc(t.identificador) + '</span>' : ''}</td>
      <td>${esc(t.area || '—')}</td>
      <td>${t.retiros}</td>
      <td>${formatNum(t.unidades_retiradas)}</td>
      <td class="${t.pendiente_devolver > 0 ? 'stock-bajo' : ''}">${formatNum(t.pendiente_devolver)}</td>
    </tr>`;
  }
  $('trabTabla').innerHTML = html + '</tbody></table>';
}

async function verTrabajador(id) {
  const d = await getJSON('/api/reportes/trabajador/' + id);
  $('trabModalTitulo').textContent = d.trabajador.nombre;
  let html = `<p class="muted">${esc(d.trabajador.area || '')}${d.trabajador.identificador ? ' · ' + esc(d.trabajador.identificador) : ''}</p>`;

  html += '<h2 class="section" style="margin-top:.8rem">Pendiente de devolver</h2>';
  if (!d.pendientes.length) {
    html += '<div class="empty" style="padding:1rem">✅ Nada pendiente.</div>';
  } else {
    html += '<table><thead><tr><th>Equipo</th><th>Desde</th><th>Pendiente</th></tr></thead><tbody>';
    for (const p of d.pendientes) {
      html += `<tr><td><strong>${esc(p.codigo)}</strong><br><span class="muted">${esc(p.nombre)}${p.serie ? ' · S/N ' + esc(p.serie) : ''}</span></td>
        <td>${fechaCorta(p.fecha)}</td><td class="stock-bajo">${formatNum(p.pendiente)} ${esc(p.unidad)}</td></tr>`;
    }
    html += '</tbody></table>';
  }

  html += '<h2 class="section" style="margin-top:1rem">Historial reciente</h2>';
  if (!d.historial.length) {
    html += '<div class="empty" style="padding:1rem">Sin movimientos.</div>';
  } else {
    html += '<table><thead><tr><th>Fecha</th><th>Tipo</th><th>Item</th><th>Cant.</th></tr></thead><tbody>';
    for (const h of d.historial) {
      html += `<tr><td>${fechaCorta(h.fecha)}</td><td>${NOMBRE_TIPO[h.tipo] || esc(h.tipo)}</td>
        <td>${esc(h.codigo)} · ${esc(h.nombre)}</td><td>${formatNum(h.cantidad)} ${esc(h.unidad)}</td></tr>`;
    }
    html += '</tbody></table>';
  }
  $('trabModalBody').innerHTML = html;
  $('modalTrab').classList.add('open');
}

// ---------- AUDITORÍA ----------
let accionesCargadas = false;
async function cargarAuditoria() {
  const params = new URLSearchParams();
  if ($('audAccion').value) params.set('accion', $('audAccion').value);
  if ($('audBuscar').value.trim()) params.set('q', $('audBuscar').value.trim());
  if ($('audDesde').value) params.set('desde', $('audDesde').value);
  if ($('audHasta').value) params.set('hasta', $('audHasta').value);
  $('audCSV').href = '/api/reportes/export/auditoria.csv?' + params;
  $('audImprimir').href = '/api/reportes/auditoria/imprimir?' + params;
  const d = await getJSON('/api/reportes/auditoria?' + params);

  if (!accionesCargadas && d.acciones) {
    $('audAccion').innerHTML = '<option value="">Todas las acciones</option>' +
      d.acciones.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
    accionesCargadas = true;
  }

  if (!d.registros.length) { $('audTabla').innerHTML = '<div class="empty">Sin registros.</div>'; return; }
  let html = '<table><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Detalle</th></tr></thead><tbody>';
  for (const r of d.registros) {
    html += `<tr>
      <td>${fechaCorta(r.fecha)}</td>
      <td>${esc(r.usuario || '—')}</td>
      <td><span class="badge ret">${esc(r.accion)}</span></td>
      <td>${esc(r.detalle || '')}</td>
    </tr>`;
  }
  $('audTabla').innerHTML = html + '</tbody></table>';
}

// ---------- GENERAL (semana) ----------
// La semana de bodega va de MIÉRCOLES a MARTES (coincide con el cambio de turno).
let semanaInicio = miercolesDe(new Date());
function miercolesDe(d) { const x = new Date(d); const off = (x.getDay() - 3 + 7) % 7; x.setDate(x.getDate() - off); x.setHours(0, 0, 0, 0); return x; }
function fmtISO(d) { const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
function fmtLindo(d) { return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' }); }

async function cargarSemana() {
  const ini = new Date(semanaInicio);
  const fin = new Date(ini); fin.setDate(fin.getDate() + 6);
  const desde = fmtISO(ini), hasta = fmtISO(fin);
  $('semRango').textContent = `Semana (mié–mar): ${fmtLindo(ini)} – ${fmtLindo(fin)} ${fin.getFullYear()}`;
  $('semImprimir').href = `/api/reportes/semana/imprimir?desde=${desde}&hasta=${hasta}`;

  const d = await getJSON(`/api/reportes/semana?desde=${desde}&hasta=${hasta}`);
  const r = d.reparaciones;
  const bajas = r.baja_reparacion + r.baja_disponible;
  const kpi = (n, lbl, sub) => `<div class="kpi"><div class="num">${n}</div><div class="lbl">${lbl}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;

  let html = '<div class="kpis" style="margin-bottom:1rem">'
    + kpi(d.ingresos.movimientos, 'Ingresos de stock', formatNum(d.ingresos.unidades) + ' unidades')
    + kpi(d.salidas.movimientos, 'Salidas / entregas', formatNum(d.salidas.unidades) + ' unidades')
    + kpi(formatNum(r.reparados), 'Equipos reparados', 'volvieron a servicio')
    + kpi(formatNum(bajas), 'Dados de baja', formatNum(r.baja_reparacion) + ' tras reparación')
    + '</div>';

  html += '<h2 class="section">Reparaciones</h2><div class="kpis" style="margin:.4rem 0 1rem">'
    + kpi(formatNum(r.enviados), 'Enviados a reparación', '')
    + kpi(formatNum(r.danados_bodega), 'Dañados en bodega', '')
    + kpi(formatNum(r.reparados), 'Reparados', '')
    + kpi(formatNum(r.baja_reparacion), 'De baja (irreparables)', '')
    + '</div>';

  html += '<h2 class="section">Items bajo el stock mínimo (reponer)</h2>';
  if (!d.bajo_stock.length) html += '<div class="empty">✔ Ningún item bajo el mínimo.</div>';
  else {
    html += '<table><thead><tr><th>Código</th><th>Item</th><th>Stock</th><th>Mínimo</th><th>Falta</th></tr></thead><tbody>';
    for (const i of d.bajo_stock) html += `<tr><td><strong>${esc(i.codigo)}</strong></td><td>${esc(i.nombre)}</td><td class="stock-bajo">${formatNum(i.stock)} ${esc(i.unidad)}</td><td>${formatNum(i.stock_minimo)}</td><td class="stock-bajo">${formatNum(Math.max(0, i.stock_minimo - i.stock))}</td></tr>`;
    html += '</tbody></table>';
  }

  html += '<h2 class="section" style="margin-top:1rem">Solicitudes de trabajadores (pedidos registrados)</h2>';
  if (!d.solicitudes.length) html += '<div class="empty">✔ No se registraron solicitudes en la semana.</div>';
  else {
    html += '<table><thead><tr><th>Fecha</th><th>Quién pidió</th><th>Qué pidió</th><th>Motivo</th><th>Estado</th></tr></thead><tbody>';
    for (const s of d.solicitudes) {
      const est = s.estado === 'pendiente' ? '<span class="stock-bajo">Pendiente</span>' : 'Resuelta';
      const cant = s.cantidad != null ? ` (${formatNum(s.cantidad)})` : '';
      html += `<tr><td>${fechaCorta(s.fecha)}</td><td><strong>${esc(s.solicitante)}</strong></td><td>${esc(s.descripcion)}${cant}</td><td>${esc(s.motivo || '—')}</td><td>${est}</td></tr>`;
    }
    html += '</tbody></table>';
  }

  $('semContenido').innerHTML = html;
}

const CARGADORES = {
  semana: cargarSemana, stock: cargarStock, movimientos: cargarMovimientos,
  trabajadores: cargarTrabajadores, auditoria: cargarAuditoria
};

// ---------- Eventos ----------
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => activarTab(t.dataset.tab)));
$('stockBuscar').addEventListener('input', cargarStock);
$('movAplicar').addEventListener('click', cargarMovimientos);
$('trabAplicar').addEventListener('click', cargarTrabajadores);
$('audAplicar').addEventListener('click', cargarAuditoria);
$('semAnt').addEventListener('click', () => { semanaInicio.setDate(semanaInicio.getDate() - 7); cargarSemana(); });
$('semSig').addEventListener('click', () => { semanaInicio.setDate(semanaInicio.getDate() + 7); cargarSemana(); });
$('semHoy').addEventListener('click', () => { semanaInicio = miercolesDe(new Date()); cargarSemana(); });
$('trabCerrar').addEventListener('click', () => $('modalTrab').classList.remove('open'));

(async () => {
  const u = await cargarUsuario();
  esAdmin = u && u.rol === 'admin';
  if (esAdmin) $('tabAuditoria').style.display = '';
  cargado.semana = true;
  cargarSemana();
})();
