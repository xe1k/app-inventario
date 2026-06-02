// Rutas de trabajadores: las personas que RETIRAN material de bodega.
// No inician sesión; se registran para poder responsabilizar cada salida.
const express = require('express');
const db = require('../db');
const { requireRol } = require('../middleware/auth');

const router = express.Router();

// GET /api/trabajadores?q=
router.get('/', (req, res) => {
  const { q } = req.query;
  let sql = 'SELECT * FROM trabajadores WHERE activo = 1';
  const params = [];
  if (q) {
    sql += ' AND (nombre LIKE ? OR identificador LIKE ? OR area LIKE ? OR cargo LIKE ?)';
    const like = '%' + q + '%';
    params.push(like, like, like, like);
  }
  sql += ' ORDER BY nombre';
  res.json(db.prepare(sql).all(...params));
});

// POST /api/trabajadores
router.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.nombre || !b.nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const info = db.prepare(
    'INSERT INTO trabajadores (nombre, identificador, area, cargo) VALUES (?,?,?,?)'
  ).run(b.nombre.trim(), b.identificador || null, b.area || null, b.cargo || null);
  db.prepare('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?,?,?)')
    .run(req.session.usuario.id, 'trabajador_crear', `Registró trabajador ${b.nombre}`);
  res.status(201).json(db.prepare('SELECT * FROM trabajadores WHERE id = ?').get(info.lastInsertRowid));
});

// PUT /api/trabajadores/:id
router.put('/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM trabajadores WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Trabajador no encontrado' });
  const b = req.body || {};
  db.prepare('UPDATE trabajadores SET nombre=?, identificador=?, area=?, cargo=? WHERE id=?')
    .run(b.nombre ?? t.nombre, b.identificador ?? t.identificador, b.area ?? t.area, b.cargo ?? t.cargo, t.id);
  db.prepare('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?,?,?)')
    .run(req.session.usuario.id, 'trabajador_editar', `Editó trabajador ${t.nombre}`);
  res.json(db.prepare('SELECT * FROM trabajadores WHERE id = ?').get(t.id));
});

// DELETE /api/trabajadores/:id  -> desactivar (conserva historial). Solo admin.
router.delete('/:id', requireRol('admin'), (req, res) => {
  const t = db.prepare('SELECT * FROM trabajadores WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Trabajador no encontrado' });
  db.prepare('UPDATE trabajadores SET activo = 0 WHERE id = ?').run(t.id);
  db.prepare('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?,?,?)')
    .run(req.session.usuario.id, 'trabajador_desactivar', `Desactivó trabajador ${t.nombre}`);
  res.json({ ok: true });
});

module.exports = router;
