// Solicitudes de los trabajadores: registrar lo que pidieron (sobre todo lo que no había)
// y llevar control de pendientes / resueltas. No afecta el stock.
let esAdmin = false;

function fechaCorta(s) { return s ? String(s).replace('T', ' ').slice(0, 16) : ''; }

// Datalist con los trabajadores registrados (comodidad al escribir el nombre).
async function cargarTrabajadores() {
  try {
    const lista = await getJSON('/api/trabajadores');
    $('trabajadoresList').innerHTML = lista.map(t => `<option value="${esc(t.nombre)}"></option>`).join('');
  } catch { /* sin trabajadores no pasa nada */ }
}

async function cargar() {
  const params = new URLSearchParams();
  if ($('fEstado').value) params.set('estado', $('fEstado').value);
  if ($('buscar').value.trim()) params.set('q', $('buscar').value.trim());
  const filas = await getJSON('/api/solicitudes?' + params);

  if (!filas.length) { $('lista').innerHTML = '<div class="empty">Sin solicitudes para estos filtros.</div>'; return; }

  let html = '<table><thead><tr><th>Fecha</th><th>Quién pidió</th><th>Qué pidió</th><th>Motivo</th><th>Estado</th><th></th></tr></thead><tbody>';
  for (const s of filas) {
    const pend = s.estado === 'pendiente';
    const badge = pend
      ? '<span class="badge" style="background:#fef3c7;color:#92400e">⏳ Pendiente</span>'
      : '<span class="badge con" style="background:#dcfce7;color:#166534">✅ Resuelta</span>';
    const cant = s.cantidad != null ? `<br><span class="muted">${formatNum(s.cantidad)} aprox.</span>` : '';
    const nota = s.nota ? `<br><span class="muted">📝 ${esc(s.nota)}</span>` : '';
    const acciones = []
    acciones.push(pend
      ? `<button class="btn-sm" onclick="resolver(${s.id})">Marcar resuelta</button>`
      : `<button class="btn-sm sec" onclick="reabrir(${s.id})">Reabrir</button>`);
    if (esAdmin) acciones.push(`<button class="btn-sm" style="background:#fee2e2;color:var(--rojo)" onclick="eliminar(${s.id})">Eliminar</button>`);

    html += `<tr>
      <td>${fechaCorta(s.fecha)}</td>
      <td><strong>${esc(s.solicitante)}</strong></td>
      <td>${esc(s.descripcion)}${cant}${nota}</td>
      <td>${esc(s.motivo || '—')}</td>
      <td>${badge}</td>
      <td style="white-space:nowrap">${acciones.join(' ')}</td>
    </tr>`;
  }
  $('lista').innerHTML = html + '</tbody></table>';
}

async function resolver(id) {
  const nota = prompt('¿Cómo se resolvió? (opcional)') ;
  if (nota === null) return;
  const { ok, data } = await postJSON('/api/solicitudes/' + id, { estado: 'resuelta', nota }, 'PUT');
  if (!ok) { alert(data.error || 'No se pudo actualizar'); return; }
  cargar();
}

async function reabrir(id) {
  const { ok, data } = await postJSON('/api/solicitudes/' + id, { estado: 'pendiente' }, 'PUT');
  if (!ok) { alert(data.error || 'No se pudo actualizar'); return; }
  cargar();
}

async function eliminar(id) {
  if (!confirm('¿Eliminar esta solicitud? No se puede deshacer.')) return;
  const r = await fetch('/api/solicitudes/' + id, { method: 'DELETE' });
  if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'No se pudo eliminar'); return; }
  cargar();
}

$('btnGuardar').addEventListener('click', async () => {
  const body = {
    solicitante: $('solicitante').value.trim(),
    descripcion: $('descripcion').value.trim(),
    cantidad: $('cantidad').value.trim() || null,
    motivo: $('motivo').value.trim() || null,
    nota: $('nota').value.trim() || null
  };
  if (!body.solicitante) { mostrarMsg('msg', 'Indica quién hizo la solicitud', 'error'); return; }
  if (!body.descripcion) { mostrarMsg('msg', 'Indica qué se solicitó', 'error'); return; }

  const { ok, data } = await postJSON('/api/solicitudes', body);
  if (!ok) { mostrarMsg('msg', data.error || 'No se pudo registrar', 'error'); return; }
  mostrarMsg('msg', '✔ Solicitud registrada.', 'ok');
  $('solicitante').value = ''; $('descripcion').value = '';
  $('cantidad').value = ''; $('motivo').value = ''; $('nota').value = '';
  $('fEstado').value = 'pendiente';
  cargar();
});

$('fEstado').addEventListener('change', cargar);
$('buscar').addEventListener('input', cargar);

(async () => {
  const u = await cargarUsuario();
  esAdmin = u && u.rol === 'admin';
  await cargarTrabajadores();
  cargar();
})();
