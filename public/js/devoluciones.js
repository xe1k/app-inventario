// Revisión de devoluciones: cómo volvió cada equipo (estado + comentario).
const ESTADO = {
  bueno:      { txt: '✅ Bueno',       bg: '#dcfce7', color: '#166534', alerta: false },
  detalle:    { txt: '🟡 Con detalle',  bg: '#fef9c3', color: '#854d0e', alerta: false },
  danado:     { txt: '🔴 Dañado',       bg: '#fee2e2', color: '#b91c1c', alerta: true },
  incompleto: { txt: '⚠️ Incompleto',  bg: '#ffedd5', color: '#9a3412', alerta: true }
};

let cache = [];

// ---------- Equipos fuera de servicio (dañados / en reparación) ----------
async function cargarFuera() {
  const items = await getJSON('/api/movimientos/fuera-servicio');
  const wrap = $('fueraServicioWrap');
  const cont = $('fuera');
  if (!items.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';

  let html = '';
  for (const it of items) {
    const R = it.stock_en_reparacion || 0;
    const D = it.stock_reparacion - R;
    const partes = [];
    if (D > 0) partes.push(`🛠️ ${formatNum(D)} dañado(s)`);
    if (R > 0) partes.push(`🔧 ${formatNum(R)} en reparación`);
    const incid = (it.incidencias || []).map(inc =>
      `<div class="muted" style="margin-top:.2rem">• ${esc(inc.fecha)} · ${esc(ESTADO[inc.estado] ? ESTADO[inc.estado].txt : inc.estado)}` +
      `${inc.trabajador ? ' · devolvió ' + esc(inc.trabajador) : ''}` +
      `${inc.observacion ? ' · “' + esc(inc.observacion) + '”' : ''}</div>`).join('');
    html += `<div class="card" style="margin-top:.6rem">
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:.6rem;align-items:flex-start">
        <div>
          <strong>${esc(it.codigo)}</strong> · ${esc(it.nombre)}${it.serie ? ' · S/N ' + esc(it.serie) : ''}<br>
          <span style="color:var(--naranjo);font-weight:700">${partes.join(' · ')}</span>
          <span class="muted"> · ${formatNum(it.stock)} ${esc(it.unidad)} disponibles</span>
          ${incid}
        </div>
        <div class="acciones">
          ${D > 0 ? `<button class="btn-sm" style="background:#ffedd5;color:#9a3412" onclick='enviarReparacion(${it.id}, ${D}, "${esc(it.codigo)}")'>A reparación</button>` : ''}
          <button class="btn-sm" style="background:#dcfce7;color:#166534" onclick='marcarReparado(${it.id}, ${it.stock_reparacion}, "${esc(it.codigo)}")'>Reparado</button>
          <button class="btn-sm" style="background:#fee2e2;color:var(--rojo)" onclick='darBaja(${it.id}, ${it.stock_reparacion}, "${esc(it.codigo)}")'>Dar de baja</button>
        </div>
      </div>
    </div>`;
  }
  cont.innerHTML = html;
}

function pedirCantidad(max, codigo, verbo) {
  if (max <= 1) return confirm(`¿${verbo} ${codigo}?`) ? max : null;
  const txt = prompt(`¿Cuántas unidades de ${codigo} quieres ${verbo.toLowerCase()}? (fuera de servicio: ${max})`, String(max));
  if (txt === null) return null;
  const n = Number(txt);
  if (!(n > 0) || n > max) { alert('Cantidad inválida.'); return null; }
  return n;
}

async function enviarReparacion(itemId, max, codigo) {
  const cantidad = pedirCantidad(max, codigo, 'Enviar a reparación');
  if (cantidad === null) return;
  const { ok, data } = await postJSON('/api/movimientos/estado-equipo', { item_id: itemId, accion: 'enviar_reparacion', cantidad });
  if (!ok) { alert(data.error || 'No se pudo registrar'); return; }
  recargar();
}

async function marcarReparado(itemId, max, codigo) {
  const cantidad = pedirCantidad(max, codigo, 'Marcar reparado');
  if (cantidad === null) return;
  const { ok, data } = await postJSON('/api/movimientos/estado-equipo', { item_id: itemId, accion: 'reparado', cantidad });
  if (!ok) { alert(data.error || 'No se pudo registrar'); return; }
  recargar();
}

async function darBaja(itemId, max, codigo) {
  const cantidad = pedirCantidad(max, codigo, 'Dar de baja');
  if (cantidad === null) return;
  const { ok, data } = await postJSON('/api/movimientos/estado-equipo', { item_id: itemId, accion: 'baja', origen: 'reparacion', cantidad });
  if (!ok) { alert(data.error || 'No se pudo registrar'); return; }
  recargar();
}

async function cargar() {
  const estado = $('fEstado').value;
  cache = await getJSON('/api/movimientos/devoluciones' + (estado ? '?estado=' + estado : ''));
  filtrar();
}

function filtrar() {
  const cont = $('lista');
  if (!cache.length) {
    cont.innerHTML = '<div class="empty">No hay devoluciones registradas para este filtro.</div>';
    return;
  }
  const q = $('buscar').value.trim().toLowerCase();
  const lista = q
    ? cache.filter(d => [d.codigo, d.nombre, d.trabajador, d.observacion, d.serie]
        .some(v => String(v || '').toLowerCase().includes(q)))
    : cache;
  if (!lista.length) {
    cont.innerHTML = '<div class="empty">No hay devoluciones que coincidan con “' + esc(q) + '”.</div>';
    return;
  }

  let html = '<table><thead><tr><th>Fecha</th><th>Equipo</th><th>Cant.</th><th>Trabajador</th><th>Recibió</th><th>Estado</th><th>Comentario</th></tr></thead><tbody>';
  for (const d of lista) {
    const e = ESTADO[d.estado] || ESTADO.bueno;
    const badge = `<span class="badge" style="background:${e.bg};color:${e.color}">${e.txt}</span>`;
    html += `<tr${e.alerta ? ' style="background:#fff5f5"' : ''}>
      <td><span class="muted">${esc(d.fecha)}</span>${d.turno ? '<br><span class="muted">turno ' + esc(d.turno) + '</span>' : ''}</td>
      <td><strong>${esc(d.codigo)}</strong><br><span class="muted">${esc(d.nombre)}${d.serie ? ' · S/N ' + esc(d.serie) : ''}</span></td>
      <td>${formatNum(d.cantidad)} ${esc(d.unidad)}</td>
      <td>${esc(d.trabajador || '—')}${d.area ? '<br><span class="muted">' + esc(d.area) + '</span>' : ''}</td>
      <td><span class="muted">${esc(d.recibido_por || '—')}</span></td>
      <td>${badge}</td>
      <td>${d.observacion ? esc(d.observacion) : '<span class="muted">—</span>'}</td>
    </tr>`;
  }
  cont.innerHTML = html + '</tbody></table>';
}

// Recarga ambas secciones (fuera de servicio + historial).
function recargar() { cargarFuera(); cargar(); }

$('fEstado').addEventListener('change', cargar);
$('buscar').addEventListener('input', filtrar);

(async () => { await cargarUsuario(); recargar(); })();
