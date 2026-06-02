// Préstamos abiertos y registro de devoluciones.
let prestamos = [];   // último listado cargado, para buscar al escanear

async function cargar() {
  prestamos = await getJSON('/api/movimientos/prestamos');
  filtrar();
}

// Dibuja la lista, opcionalmente filtrada por el texto del buscador.
function filtrar() {
  const cont = $('lista');
  if (!prestamos.length) {
    cont.innerHTML = '<div class="empty">✅ No hay préstamos pendientes. Todo lo retornable está en bodega.</div>';
    return;
  }
  const q = $('buscar').value.trim().toLowerCase();
  const lista = q
    ? prestamos.filter(p => [p.codigo, p.nombre, p.trabajador, p.serie].some(v => String(v || '').toLowerCase().includes(q)))
    : prestamos;
  if (!lista.length) {
    cont.innerHTML = '<div class="empty">No hay préstamos que coincidan con “' + esc(q) + '”.</div>';
    return;
  }
  let html = '<table><thead><tr><th>Equipo</th><th>Trabajador</th><th>Pendiente</th><th>Desde</th><th>Entregó</th><th></th></tr></thead><tbody>';
  for (const p of lista) {
    html += `<tr>
      <td><strong>${esc(p.codigo)}</strong><br><span class="muted">${esc(p.nombre)}${p.serie ? ' · S/N ' + esc(p.serie) : ''}</span></td>
      <td>${esc(p.trabajador || '—')}${p.area ? '<br><span class="muted">' + esc(p.area) + '</span>' : ''}</td>
      <td class="stock-bajo">${formatNum(p.pendiente)} ${esc(p.unidad)}</td>
      <td><span class="muted">${esc(p.fecha)}</span>${p.turno ? '<br><span class="muted">turno ' + esc(p.turno) + '</span>' : ''}</td>
      <td><span class="muted">${esc(p.entregado_por || '—')}</span></td>
      <td><button class="btn-sm" style="background:#dcfce7;color:#166534" onclick='devolver(${p.id}, ${p.pendiente}, "${esc(p.codigo)}")'>Devolver</button></td>
    </tr>`;
  }
  cont.innerHTML = html + '</tbody></table>';
}

// Abre el modal de devolución; permite ajustar la cantidad y dejar un comentario
// (por ejemplo, si el equipo vuelve en mal estado).
let devPendiente = 0;
function devolver(prestamoId, pendiente, codigo) {
  devPendiente = pendiente;
  $('d_prestamo').value = prestamoId;
  $('devInfo').innerHTML = `Equipo <strong>${esc(codigo)}</strong> · pendiente: ${formatNum(pendiente)}`;
  $('d_cantidad').value = pendiente;
  $('d_cantidad').max = pendiente;
  $('d_estado').value = 'bueno';
  $('d_comentario').value = '';
  $('devMsg').className = 'msg';
  $('modalDev').classList.add('open');
}

$('formDev').addEventListener('submit', async (e) => {
  e.preventDefault();
  const cantidad = Number($('d_cantidad').value);
  if (!(cantidad > 0) || cantidad > devPendiente) {
    return mostrarMsg('devMsg', 'Cantidad inválida (máximo: ' + formatNum(devPendiente) + ')', 'error');
  }
  const body = {
    prestamo_ref: Number($('d_prestamo').value),
    cantidad,
    estado: $('d_estado').value,
    observacion: $('d_comentario').value.trim()
  };
  const { ok, data } = await postJSON('/api/movimientos/devolucion', body);
  if (!ok) return mostrarMsg('devMsg', data.error || 'No se pudo registrar la devolución', 'error');
  $('modalDev').classList.remove('open');
  cargar();
});

$('buscar').addEventListener('input', filtrar);

// Escanear el equipo que vuelve y registrar su devolución.
$('btnEscanear').addEventListener('click', () => {
  Escaner.abrir({
    titulo: 'Escanear equipo devuelto',
    onCodigo: (codigo) => {
      const cod = codigo.toUpperCase();
      const coincidencias = prestamos.filter(p => String(p.codigo).toUpperCase() === cod && p.pendiente > 0);
      if (!coincidencias.length) {
        alert('No hay ningún préstamo abierto del equipo ' + codigo + '.');
        return;
      }
      if (coincidencias.length === 1) {
        const p = coincidencias[0];
        devolver(p.id, p.pendiente, p.codigo);
      } else {
        // Varios préstamos del mismo código: filtra el buscador para elegir a mano.
        $('buscar').value = codigo;
        filtrar();
        alert('Hay ' + coincidencias.length + ' préstamos abiertos de ' + codigo + '. Elige cuál devolver en la lista.');
      }
    }
  });
});

(async () => { await cargarUsuario(); cargar(); })();
