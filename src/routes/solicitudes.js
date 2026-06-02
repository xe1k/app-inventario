// Rutas de solicitudes: pedidos de los trabajadores que se anotan para tener
// registro de qué se pidió (especialmente lo que NO había en bodega).
// No afectan el stock; son un "buzón" de pedidos para reponer / responder.
const express = require('express');
const db = require('../db');
const { requireRol } = require('../middleware/auth');

const router = express.Router();

function auditar(usuarioId, accion, detalle) {
  db.prepare('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?,?,?)')
    .run(usuarioId, accion, detalle);
}

// GET /api/solicitudes?estado=pendiente|resuelta&q=
router.get('/', (req, res) => {
  const { estado, q } = req.query;
  let sql =
    `SELECT s.*, t.nombre AS trabajador, i.codigo AS item_codigo, i.nombre AS item_nombre,
            u.nombre AS registrado_por
       FROM solicitudes s
       LEFT JOIN trabajadores t ON t.id = s.trabajador_id
       LEFT JOIN items i ON i.id = s.item_id
       LEFT JOIN usuarios u ON u.id = s.usuario_id
      WHERE 1=1`;
  const params = [];
  if (estado) { sql += ' AND s.estado = ?'; params.push(estado); }
  if (q && q.trim()) {
    sql += ' AND (s.solicitante LIKE ? OR s.descripcion LIKE ?)';
    const like = '%' + q.trim() + '%';
    params.push(like, like);
  }
  // Pendientes primero, luego por fecha reciente.
  sql += " ORDER BY (s.estado='pendiente') DESC, s.fecha DESC, s.id DESC LIMIT 500";
  res.json(db.prepare(sql).all(...params));
});

// POST /api/solicitudes
router.post('/', (req, res) => {
  const b = req.body || {};
  const solicitante = (b.solicitante || '').trim();
  const descripcion = (b.descripcion || '').trim();
  if (!solicitante) return res.status(400).json({ error: 'Indica quién hizo la solicitud' });
  if (!descripcion) return res.status(400).json({ error: 'Indica qué se solicitó' });

  const cantidad = b.cantidad != null && b.cantidad !== '' ? Number(b.cantidad) : null;
  if (cantidad != null && !(cantidad > 0)) return res.status(400).json({ error: 'La cantidad debe ser mayor que 0' });

  const info = db.prepare(
    `INSERT INTO solicitudes (solicitante, trabajador_id, item_id, descripcion, cantidad, motivo, nota, usuario_id)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(
    solicitante, b.trabajador_id || null, b.item_id || null, descripcion,
    cantidad, b.motivo || null, b.nota || null, req.session.usuario.id
  );
  auditar(req.session.usuario.id, 'solicitud_crear', `Registró solicitud de ${solicitante}: ${descripcion}`);
  res.status(201).json(db.prepare('SELECT * FROM solicitudes WHERE id = ?').get(info.lastInsertRowid));
});

// PUT /api/solicitudes/:id  -> cambiar estado (resolver / reabrir) y/o nota
router.put('/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM solicitudes WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Solicitud no encontrada' });
  const b = req.body || {};

  let estado = s.estado, resueltaEn = s.resuelta_en;
  if (b.estado && ['pendiente', 'resuelta'].includes(b.estado)) {
    estado = b.estado;
    resueltaEn = estado === 'resuelta' ? "datetime('now','localtime')" : null;
  }
  const nota = b.nota != null ? (String(b.nota).trim() || null) : s.nota;

  // resuelta_en se setea con expresión SQL solo cuando pasa a resuelta.
  if (estado === 'resuelta' && s.estado !== 'resuelta') {
    db.prepare("UPDATE solicitudes SET estado=?, nota=?, resuelta_en=datetime('now','localtime') WHERE id=?")
      .run(estado, nota, s.id);
  } else if (estado === 'pendiente') {
    db.prepare('UPDATE solicitudes SET estado=?, nota=?, resuelta_en=NULL WHERE id=?').run(estado, nota, s.id);
  } else {
    db.prepare('UPDATE solicitudes SET estado=?, nota=? WHERE id=?').run(estado, nota, s.id);
  }

  auditar(req.session.usuario.id, 'solicitud_editar', `Actualizó solicitud #${s.id} de ${s.solicitante} (${estado})`);
  res.json(db.prepare('SELECT * FROM solicitudes WHERE id = ?').get(s.id));
});

// DELETE /api/solicitudes/:id  -> solo admin
router.delete('/:id', requireRol('admin'), (req, res) => {
  const s = db.prepare('SELECT * FROM solicitudes WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Solicitud no encontrada' });
  db.prepare('DELETE FROM solicitudes WHERE id = ?').run(s.id);
  auditar(req.session.usuario.id, 'solicitud_eliminar', `Eliminó solicitud #${s.id} de ${s.solicitante}`);
  res.json({ ok: true });
});

module.exports = router;
