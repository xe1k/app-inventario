// Gestión de usuarios que OPERAN la app (inician sesión).
//   - El admin crea/edita/desactiva usuarios y resetea claves.
//   - Cualquier usuario puede cambiar su propia contraseña.
// Resguardos clave: nunca se devuelve el hash, y no se permite quedarse sin
// ningún admin activo ni que un admin se bloquee a sí mismo.
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireRol } = require('../middleware/auth');

const router = express.Router();

const ROLES = ['admin', 'bodeguero'];
const TURNOS = ['dia', 'noche'];

function auditar(usuarioId, accion, detalle) {
  db.prepare('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?,?,?)')
    .run(usuarioId, accion, detalle);
}

// Campos que ve el admin. Incluye password_plain (clave en texto) a pedido: en una
// bodega chica el admin necesita poder consultar la clave de cada cuenta. NUNCA se
// expone el hash, y este listado solo lo sirve un endpoint con requireRol('admin').
const COLS = 'id, username, nombre, rol, turno, activo, creado_en, password_plain';

function adminsActivos(exceptoId) {
  let sql = `SELECT COUNT(*) AS n FROM usuarios WHERE rol='admin' AND activo=1`;
  const params = [];
  if (exceptoId != null) { sql += ' AND id <> ?'; params.push(exceptoId); }
  return db.prepare(sql).get(...params).n;
}

// Normaliza el turno según el rol (el turno solo aplica a bodegueros).
function turnoSegunRol(rol, turno) {
  if (rol !== 'bodeguero') return null;
  return TURNOS.includes(turno) ? turno : null;
}

// ---------- LISTAR (solo admin) ----------
router.get('/', requireRol('admin'), (req, res) => {
  res.json(db.prepare(`SELECT ${COLS} FROM usuarios ORDER BY activo DESC, rol, nombre`).all());
});

// ---------- CREAR (solo admin) ----------
router.post('/', requireRol('admin'), (req, res) => {
  const b = req.body || {};
  const username = (b.username || '').trim().toLowerCase();
  const nombre = (b.nombre || '').trim();
  const password = b.password || '';
  const rol = b.rol;

  if (!username || !nombre) return res.status(400).json({ error: 'Usuario y nombre son obligatorios' });
  if (!/^[a-z0-9._-]+$/.test(username)) return res.status(400).json({ error: 'El usuario solo admite letras, números, punto, guion y guion bajo' });
  if (!ROLES.includes(rol)) return res.status(400).json({ error: 'Rol inválido' });
  if (password.length < 4) return res.status(400).json({ error: 'La clave debe tener al menos 4 caracteres' });
  if (db.prepare('SELECT 1 FROM usuarios WHERE username = ?').get(username)) {
    return res.status(409).json({ error: 'Ya existe un usuario con ese nombre de acceso' });
  }

  const turno = turnoSegunRol(rol, b.turno);
  const info = db.prepare(
    'INSERT INTO usuarios (username, nombre, password_hash, password_plain, rol, turno) VALUES (?,?,?,?,?,?)'
  ).run(username, nombre, bcrypt.hashSync(password, 10), password, rol, turno);
  auditar(req.session.usuario.id, 'usuario_crear', `Creó usuario ${username} (${rol}${turno ? '/' + turno : ''})`);
  res.status(201).json(db.prepare(`SELECT ${COLS} FROM usuarios WHERE id = ?`).get(info.lastInsertRowid));
});

// ---------- EDITAR datos/rol/turno/activo (solo admin) ----------
router.put('/:id', requireRol('admin'), (req, res) => {
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  const b = req.body || {};
  const esYo = u.id === req.session.usuario.id;

  const nombre = (b.nombre != null ? String(b.nombre).trim() : u.nombre) || u.nombre;
  const rol = b.rol != null ? b.rol : u.rol;
  if (!ROLES.includes(rol)) return res.status(400).json({ error: 'Rol inválido' });
  const activo = b.activo != null ? (b.activo ? 1 : 0) : u.activo;

  // Resguardos para no quedarse sin admin ni autobloquearse.
  if (esYo && rol !== 'admin') return res.status(409).json({ error: 'No puedes quitarte a ti mismo el rol de administrador' });
  if (esYo && activo === 0) return res.status(409).json({ error: 'No puedes desactivar tu propia cuenta' });
  if (u.rol === 'admin' && (rol !== 'admin' || activo === 0) && adminsActivos(u.id) === 0) {
    return res.status(409).json({ error: 'Debe quedar al menos un administrador activo' });
  }

  const turno = turnoSegunRol(rol, b.turno != null ? b.turno : u.turno);
  db.prepare('UPDATE usuarios SET nombre=?, rol=?, turno=?, activo=? WHERE id=?')
    .run(nombre, rol, turno, activo, u.id);
  auditar(req.session.usuario.id, 'usuario_editar', `Editó usuario ${u.username} (${rol}${turno ? '/' + turno : ''}${activo ? '' : ', inactivo'})`);
  res.json(db.prepare(`SELECT ${COLS} FROM usuarios WHERE id = ?`).get(u.id));
});

// ---------- RESETEAR CLAVE de otro usuario (solo admin) ----------
router.post('/:id/reset-clave', requireRol('admin'), (req, res) => {
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  const nueva = (req.body && req.body.nueva) || '';
  if (nueva.length < 4) return res.status(400).json({ error: 'La clave debe tener al menos 4 caracteres' });
  db.prepare('UPDATE usuarios SET password_hash = ?, password_plain = ? WHERE id = ?')
    .run(bcrypt.hashSync(nueva, 10), nueva, u.id);
  auditar(req.session.usuario.id, 'usuario_reset_clave', `Reseteó la clave de ${u.username}`);
  res.json({ ok: true });
});

// ---------- DESACTIVAR (solo admin) ----------
router.delete('/:id', requireRol('admin'), (req, res) => {
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (u.id === req.session.usuario.id) return res.status(409).json({ error: 'No puedes desactivar tu propia cuenta' });
  if (u.rol === 'admin' && adminsActivos(u.id) === 0) {
    return res.status(409).json({ error: 'Debe quedar al menos un administrador activo' });
  }
  db.prepare('UPDATE usuarios SET activo = 0 WHERE id = ?').run(u.id);
  auditar(req.session.usuario.id, 'usuario_desactivar', `Desactivó usuario ${u.username}`);
  res.json({ ok: true });
});

module.exports = router;
