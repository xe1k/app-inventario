// Bitácora de auditoría: quién editó o movió, y cuándo. Solo administrador.
// Consume /api/reportes/auditoria (protegido con requireRol('admin') en el backend).
let accionesCargadas = false;

function fechaCorta(s) { return s ? String(s).replace('T', ' ').slice(0, 16) : ''; }

async function cargar() {
  const params = new URLSearchParams();
  if ($('audAccion').value) params.set('accion', $('audAccion').value);
  if ($('audBuscar').value.trim()) params.set('q', $('audBuscar').value.trim());
  if ($('audDesde').value) params.set('desde', $('audDesde').value);
  if ($('audHasta').value) params.set('hasta', $('audHasta').value);
  $('audCSV').href = '/api/reportes/export/auditoria.csv?' + params;
  $('audImprimir').href = '/api/reportes/auditoria/imprimir?' + params;

  const r = await fetch('/api/reportes/auditoria?' + params);
  if (r.status === 403) { window.location.href = '/'; return; }
  const d = await r.json();

  if (!accionesCargadas && d.acciones) {
    $('audAccion').innerHTML = '<option value="">Todas las acciones</option>' +
      d.acciones.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
    accionesCargadas = true;
  }

  if (!d.registros.length) { $('audTabla').innerHTML = '<div class="empty">Sin registros para estos filtros.</div>'; return; }
  let html = '<table><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Detalle</th></tr></thead><tbody>';
  for (const reg of d.registros) {
    html += `<tr>
      <td>${fechaCorta(reg.fecha)}</td>
      <td>${esc(reg.usuario || '—')}</td>
      <td><span class="badge ret">${esc(reg.accion)}</span></td>
      <td>${esc(reg.detalle || '')}</td>
    </tr>`;
  }
  $('audTabla').innerHTML = html + '</tbody></table>';
}

$('audAplicar').addEventListener('click', cargar);
$('audBuscar').addEventListener('input', cargar);
$('audAccion').addEventListener('change', cargar);

// Atajo: cargar la semana de bodega en curso (miércoles a martes, según cambio de turno).
$('audSemana').addEventListener('click', () => {
  const hoy = new Date();
  const ini = new Date(hoy);
  ini.setDate(ini.getDate() - ((ini.getDay() - 3 + 7) % 7));  // miércoles más reciente
  const fin = new Date(ini); fin.setDate(fin.getDate() + 6);  // martes
  const iso = d => { const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
  $('audDesde').value = iso(ini);
  $('audHasta').value = iso(fin);
  cargar();
});

(async () => {
  const usuario = await cargarUsuario();
  if (!usuario) return;
  if (usuario.rol !== 'admin') { window.location.href = '/'; return; }
  cargar();
})();
