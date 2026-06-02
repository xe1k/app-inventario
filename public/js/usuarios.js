// Gestión de usuarios + cambio de la propia contraseña.
// La tarjeta de "cambiar mi clave" la ve cualquiera; la tabla de usuarios, solo el admin.
let usuarioActual = null;
let esAdmin = false;

const ROL_LBL = { admin: 'Administrador', bodeguero: 'Bodeguero' };
const TURNO_LBL = { dia: 'Día', noche: 'Noche' };

// ---------- Tabla de usuarios (admin) ----------
let usuariosCache = [];
async function cargarUsuarios() {
  usuariosCache = await getJSON('/api/usuarios');
  const cont = $('lista');
  if (!usuariosCache.length) { cont.innerHTML = '<div class="empty">Sin usuarios.</div>'; return; }
  let html = '<table><thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Turno</th><th>Clave</th><th>Estado</th><th></th></tr></thead><tbody>';
  for (const u of usuariosCache) {
    const esYo = u.id === usuarioActual.id;
    const clave = u.password_plain
      ? `<span style="font-family:monospace">${esc(u.password_plain)}</span>`
      : '<span class="muted">— usa “Clave”</span>';
    html += `<tr${u.activo ? '' : ' style="opacity:.55"'}>
      <td><strong>${esc(u.username)}</strong>${esYo ? ' <span class="muted">(tú)</span>' : ''}</td>
      <td>${esc(u.nombre)}</td>
      <td><span class="badge ${u.rol === 'admin' ? 'ret' : 'con'}">${ROL_LBL[u.rol] || esc(u.rol)}</span></td>
      <td>${u.turno ? TURNO_LBL[u.turno] : '—'}</td>
      <td>${clave}</td>
      <td>${u.activo ? '<span style="color:var(--verde);font-weight:600">Activo</span>' : '<span class="muted">Inactivo</span>'}</td>
      <td><div class="acciones">
        <button class="btn-sm" style="background:#e0f2fe" onclick="editarUsuario(${u.id})">Editar</button>
        <button class="btn-sm" style="background:#fef9c3" onclick="abrirReset(${u.id})">Clave</button>
        ${esYo ? '' : `<button class="btn-sm" style="background:${u.activo ? '#fee2e2;color:var(--rojo)' : '#dcfce7;color:#166534'}" onclick="toggleActivo(${u.id})">${u.activo ? 'Desactivar' : 'Reactivar'}</button>`}
      </div></td>
    </tr>`;
  }
  cont.innerHTML = html + '</tbody></table>';
}

// ---------- Modal crear / editar ----------
function ajustarCamposRol() {
  const esAdminRol = $('u_rol').value === 'admin';
  $('campoTurno').style.visibility = esAdminRol ? 'hidden' : 'visible';
}

function abrirNuevo() {
  $('formTitulo').textContent = 'Nuevo usuario';
  $('u_id').value = '';
  $('u_username').value = '';
  $('u_username').disabled = false;
  $('u_nombre').value = '';
  $('u_rol').value = 'bodeguero';
  $('u_turno').value = '';
  $('u_password').value = '';
  $('campoClave').style.display = '';
  $('lblActivo').style.display = 'none';
  $('formMsg').className = 'msg';
  ajustarCamposRol();
  $('modalForm').classList.add('open');
}

function editarUsuario(id) {
  const u = usuariosCache.find(x => x.id === id);
  if (!u) return;
  $('formTitulo').textContent = 'Editar usuario';
  $('u_id').value = u.id;
  $('u_username').value = u.username;
  $('u_username').disabled = true;             // el acceso no se cambia
  $('u_nombre').value = u.nombre;
  $('u_rol').value = u.rol;
  $('u_turno').value = u.turno || '';
  $('campoClave').style.display = 'none';       // la clave se cambia con "Clave"
  $('u_activo').checked = !!u.activo;
  $('lblActivo').style.display = u.id === usuarioActual.id ? 'none' : '';
  $('formMsg').className = 'msg';
  ajustarCamposRol();
  $('modalForm').classList.add('open');
}

$('u_rol').addEventListener('change', ajustarCamposRol);

$('formUsuario').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('u_id').value;
  const body = {
    nombre: $('u_nombre').value.trim(),
    rol: $('u_rol').value,
    turno: $('u_rol').value === 'bodeguero' ? ($('u_turno').value || null) : null
  };
  let resp;
  if (id) {
    body.activo = $('u_activo').checked;
    resp = await postJSON('/api/usuarios/' + id, body, 'PUT');
  } else {
    body.username = $('u_username').value.trim();
    body.password = $('u_password').value;
    resp = await postJSON('/api/usuarios', body);
  }
  if (!resp.ok) return mostrarMsg('formMsg', resp.data.error || 'No se pudo guardar', 'error');
  $('modalForm').classList.remove('open');
  cargarUsuarios();
});

// ---------- Resetear clave de un usuario ----------
function abrirReset(id) {
  const u = usuariosCache.find(x => x.id === id);
  if (!u) return;
  $('r_id').value = u.id;
  $('r_nueva').value = '';
  $('resetInfo').innerHTML = `Nueva clave para <strong>${esc(u.username)}</strong> (${esc(u.nombre)}).`;
  $('resetMsg').className = 'msg';
  $('modalReset').classList.add('open');
}

$('formReset').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { ok, data } = await postJSON('/api/usuarios/' + $('r_id').value + '/reset-clave', { nueva: $('r_nueva').value });
  if (!ok) return mostrarMsg('resetMsg', data.error || 'No se pudo resetear', 'error');
  $('modalReset').classList.remove('open');
});

// ---------- Activar / desactivar ----------
async function toggleActivo(id) {
  const u = usuariosCache.find(x => x.id === id);
  if (!u) return;
  if (u.activo) {
    if (!confirm(`¿Desactivar a ${u.nombre}? No podrá iniciar sesión, pero su historial se conserva.`)) return;
    const { ok, data } = await postJSON('/api/usuarios/' + id, {}, 'DELETE');
    if (!ok) return alert(data.error || 'No se pudo desactivar');
  } else {
    const { ok, data } = await postJSON('/api/usuarios/' + id, { activo: true }, 'PUT');
    if (!ok) return alert(data.error || 'No se pudo reactivar');
  }
  cargarUsuarios();
}

// ---------- Eventos de modales ----------
$('btnNuevo').addEventListener('click', abrirNuevo);
$('btnCancelar').addEventListener('click', () => $('modalForm').classList.remove('open'));
$('btnResetCancelar').addEventListener('click', () => $('modalReset').classList.remove('open'));

(async () => {
  usuarioActual = await cargarUsuario();
  if (!usuarioActual) return;
  esAdmin = usuarioActual.rol === 'admin';
  // Pantalla exclusiva del administrador.
  if (!esAdmin) { window.location.href = '/'; return; }
  $('adminSeccion').style.display = '';
  cargarUsuarios();
})();
