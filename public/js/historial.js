// Historial de movimientos con filtros.
const ETIQUETA = {
  entrada: { txt: 'Entrada', color: '#16a34a', signo: '+' },
  salida: { txt: 'Salida', color: '#dc2626', signo: '−' },
  devolucion: { txt: 'Devolución', color: '#2563eb', signo: '+' },
  ajuste: { txt: 'Ajuste', color: '#ea580c', signo: '' }
};

let trabajadores = [];
let rol = null;
let movsCache = [];

async function cargar() {
  const params = new URLSearchParams();
  if ($('fTipo').value) params.set('tipo', $('fTipo').value);
  if ($('fDesde').value) params.set('desde', $('fDesde').value);
  if ($('fHasta').value) params.set('hasta', $('fHasta').value);

  // El filtro por trabajador es por nombre: resolvemos a id si coincide uno.
  const qTrab = $('fTrab').value.trim().toLowerCase();
  if (qTrab) {
    const t = trabajadores.find(x => x.nombre.toLowerCase().includes(qTrab));
    if (t) params.set('trabajador_id', t.id);
  }

  const movs = await getJSON('/api/movimientos?' + params);
  movsCache = movs;
  const cont = $('lista');
  if (!movs.length) { cont.innerHTML = '<div class="empty">Sin movimientos para estos filtros.</div>'; return; }

  const admin = rol === 'admin';
  let html = '<table><thead><tr><th>Fecha</th><th>Tipo</th><th>Item</th><th>Cant.</th><th>Trabajador</th><th>Registró</th><th>Motivo</th>' +
    (admin ? '<th></th>' : '') + '</tr></thead><tbody>';
  for (const m of movs) {
    const e = ETIQUETA[m.tipo] || { txt: m.tipo, color: '#475569', signo: '' };
    const cant = `${e.signo}${formatNum(Math.abs(m.cantidad))} ${esc(m.unidad)}`;
    html += `<tr>
      <td><span class="muted">${esc(m.fecha)}</span>${m.turno ? '<br><span class="muted">turno ' + esc(m.turno) + '</span>' : ''}</td>
      <td><span style="color:${e.color};font-weight:700">${e.txt}</span></td>
      <td><strong>${esc(m.codigo)}</strong><br><span class="muted">${esc(m.item_nombre)}</span></td>
      <td style="color:${e.color};font-weight:600">${cant}</td>
      <td>${esc(m.trabajador || '—')}</td>
      <td><span class="muted">${esc(m.usuario || '—')}</span></td>
      <td><span class="muted">${esc(m.motivo || '')}${m.observacion ? ' · ' + esc(m.observacion) : ''}</span></td>
      ${admin ? `<td><div class="acciones">
        <button class="btn-sm" style="background:#e2e8f0" onclick="editarMov(${m.id})">Editar</button>
        <button class="btn-sm" style="background:#fee2e2;color:var(--rojo)" onclick="eliminarMov(${m.id})">Eliminar</button>
      </div></td>` : ''}
    </tr>`;
  }
  cont.innerHTML = html + '</tbody></table>';
}

// ---------- Edición / eliminación (solo admin) ----------
function editarMov(id) {
  const m = movsCache.find(x => x.id === id);
  if (!m) return;
  $('e_id').value = m.id;
  $('editInfo').innerHTML = `#${m.id} · ${esc(m.codigo)} · ${esc(m.item_nombre)} · ${formatNum(Math.abs(m.cantidad))} ${esc(m.unidad)}`;
  $('e_motivo').value = m.motivo || '';
  $('e_obs').value = m.observacion || '';

  // El trabajador solo se edita en salidas (entregas/préstamos).
  if (m.tipo === 'salida') {
    $('e_trab').innerHTML = trabajadores.map(t =>
      `<option value="${t.id}">${esc(t.nombre)}${t.area ? ' · ' + esc(t.area) : ''}</option>`).join('');
    $('e_trab').value = m.trabajador_id || '';
    $('e_trabWrap').style.display = '';
  } else {
    $('e_trabWrap').style.display = 'none';
  }
  $('editMsg').className = 'msg';
  $('modalEdit').classList.add('open');
}

$('formEdit').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('e_id').value;
  const body = { motivo: $('e_motivo').value.trim(), observacion: $('e_obs').value.trim() };
  if ($('e_trabWrap').style.display !== 'none' && $('e_trab').value) body.trabajador_id = Number($('e_trab').value);
  const { ok, data } = await postJSON('/api/movimientos/' + id, body, 'PUT');
  if (!ok) return mostrarMsg('editMsg', data.error || 'No se pudo guardar', 'error');
  $('modalEdit').classList.remove('open');
  cargar();
});

async function eliminarMov(id) {
  const m = movsCache.find(x => x.id === id);
  if (!m) return;
  if (!confirm(`¿Eliminar el movimiento #${m.id} (${m.tipo} de ${m.codigo})? Se revertirá su efecto en el stock. Esta acción no se puede deshacer.`)) return;
  const { ok, data } = await postJSON('/api/movimientos/' + id, {}, 'DELETE');
  if (!ok) { alert(data.error || 'No se pudo eliminar'); return; }
  cargar();
}

['fTipo', 'fDesde', 'fHasta'].forEach(id => $(id).addEventListener('change', cargar));
$('fTrab').addEventListener('input', cargar);

(async () => {
  const usuario = await cargarUsuario();
  rol = usuario ? usuario.rol : null;
  trabajadores = await getJSON('/api/trabajadores');
  cargar();
})();
