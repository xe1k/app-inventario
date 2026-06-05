// Gestión de trabajadores que retiran material.
let rol = null;

async function cargar() {
  const q = $('buscar').value.trim();
  const lista = await getJSON('/api/trabajadores' + (q ? '?q=' + encodeURIComponent(q) : ''));
  const cont = $('lista');
  if (!lista.length) {
    cont.innerHTML = '<div class="empty">Aún no hay trabajadores. Agrega uno con “+ Nuevo trabajador”.</div>';
    return;
  }
  let html = '<table><thead><tr><th>Nombre</th><th>RUT / Ficha</th><th>Cargo</th><th>Área</th><th></th></tr></thead><tbody>';
  for (const t of lista) {
    html += `<tr>
      <td><strong>${esc(t.nombre)}</strong></td>
      <td>${esc(t.identificador || '—')}</td>
      <td>${esc(t.cargo || '—')}</td>
      <td>${esc(t.area || '—')}</td>
      <td><div class="acciones">
        <button class="btn-sm" style="background:#e2e8f0" onclick='editar(${t.id})'>Editar</button>
        ${rol === 'admin' ? `<button class="btn-sm" style="background:#fee2e2;color:#dc2626" onclick='quitar(${t.id},"${esc(t.nombre)}")'>Quitar</button>` : ''}
      </div></td>
    </tr>`;
  }
  cont.innerHTML = html + '</tbody></table>';
}

function abrir(t) {
  $('formMsg').className = 'msg';
  $('formT').reset();
  $('tId').value = t ? t.id : '';
  $('formTitulo').textContent = t ? 'Editar trabajador' : 'Nuevo trabajador';
  if (t) {
    $('t_nombre').value = t.nombre;
    $('t_identificador').value = t.identificador || '';
    $('t_cargo').value = t.cargo || '';
    $('t_area').value = t.area || '';
  }
  $('modalForm').classList.add('open');
}

async function editar(id) {
  const lista = await getJSON('/api/trabajadores');
  abrir(lista.find(x => x.id === id));
}

async function quitar(id, nombre) {
  if (!confirm(`¿Quitar a ${nombre}? Su historial de retiros se conserva.`)) return;
  const r = await fetch('/api/trabajadores/' + id, { method: 'DELETE' });
  if (r.ok) cargar(); else alert('No se pudo quitar.');
}

$('formT').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('tId').value;
  const body = {
    nombre: $('t_nombre').value.trim(),
    identificador: $('t_identificador').value.trim(),
    cargo: $('t_cargo').value.trim(),
    area: $('t_area').value.trim()
  };
  const { ok, data } = await postJSON(id ? '/api/trabajadores/' + id : '/api/trabajadores', body, id ? 'PUT' : 'POST');
  if (!ok) { mostrarMsg('formMsg', data.error || 'No se pudo guardar', 'error'); return; }
  $('modalForm').classList.remove('open');
  cargar();
});

$('btnNuevo').addEventListener('click', () => abrir(null));
$('btnCancelar').addEventListener('click', () => $('modalForm').classList.remove('open'));
$('buscar').addEventListener('input', cargar);

(async () => {
  const usuario = await cargarUsuario();
  if (!usuario) return;
  rol = usuario.rol;
  cargar();
})();
