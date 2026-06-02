// Rutas del catálogo de items (equipos retornables e insumos consumibles).
const express = require('express');
const QRCode = require('qrcode');
const db = require('../db');
const { requireRol } = require('../middleware/auth');

const router = express.Router();

function auditar(usuarioId, accion, detalle) {
  db.prepare('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?,?,?)')
    .run(usuarioId, accion, detalle);
}

// Genera un código correlativo del tipo RET-00001 / CON-00001.
function generarCodigo(tipo) {
  const prefijo = tipo === 'retornable' ? 'RET' : 'CON';
  const row = db.prepare(
    `SELECT codigo FROM items WHERE codigo LIKE ? ORDER BY id DESC LIMIT 1`
  ).get(prefijo + '-%');
  let n = 1;
  if (row) {
    const m = row.codigo.match(/(\d+)$/);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  return `${prefijo}-${String(n).padStart(5, '0')}`;
}

// GET /api/items  -> lista con filtros opcionales (?tipo=&q=&bajos=1)
router.get('/', (req, res) => {
  const { tipo, q, bajos } = req.query;
  let sql = 'SELECT * FROM items WHERE activo = 1';
  const params = [];
  if (tipo) { sql += ' AND tipo = ?'; params.push(tipo); }
  if (q) {
    sql += ' AND (nombre LIKE ? OR codigo LIKE ? OR categoria LIKE ? OR serie LIKE ?)';
    const like = '%' + q + '%';
    params.push(like, like, like, like);
  }
  if (bajos === '1') sql += ' AND stock <= stock_minimo';
  sql += ' ORDER BY nombre';
  res.json(db.prepare(sql).all(...params));
});

// GET /api/items/codigo/:codigo  -> buscar por código (para el escáner)
router.get('/codigo/:codigo', (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE codigo = ? AND activo = 1').get(req.params.codigo);
  if (!item) return res.status(404).json({ error: 'No existe un item con ese código' });
  res.json(item);
});

// GET /api/items/:id
router.get('/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item no encontrado' });
  res.json(item);
});

// GET /api/items/:id/qr.png  -> imagen QR del código del item
router.get('/:id/qr.png', async (req, res) => {
  const item = db.prepare('SELECT codigo FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item no encontrado' });
  try {
    const buf = await QRCode.toBuffer(item.codigo, { width: 300, margin: 1 });
    res.type('png').send(buf);
  } catch {
    res.status(500).json({ error: 'No se pudo generar el QR' });
  }
});

// POST /api/items  -> crear item
router.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.nombre || !b.tipo) return res.status(400).json({ error: 'Nombre y tipo son obligatorios' });
  if (!['retornable', 'consumible'].includes(b.tipo)) {
    return res.status(400).json({ error: 'Tipo inválido' });
  }

  const codigo = (b.codigo && b.codigo.trim()) || generarCodigo(b.tipo);
  if (db.prepare('SELECT 1 FROM items WHERE codigo = ?').get(codigo)) {
    return res.status(409).json({ error: 'Ya existe un item con ese código' });
  }

  try {
    const info = db.prepare(
      `INSERT INTO items (codigo, nombre, tipo, categoria, unidad, ubicacion, stock, stock_minimo, serie)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(
      codigo, b.nombre.trim(), b.tipo, b.categoria || null, b.unidad || 'unidad',
      b.ubicacion || null, Number(b.stock) || 0, Number(b.stock_minimo) || 0, b.serie || null
    );
    auditar(req.session.usuario.id, 'item_crear', `Creó item ${codigo} - ${b.nombre}`);
    res.status(201).json(db.prepare('SELECT * FROM items WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) {
    res.status(500).json({ error: 'Error al crear el item' });
  }
});

// PUT /api/items/:id  -> editar datos (no toca el stock; eso se hace por movimientos)
router.put('/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item no encontrado' });
  const b = req.body || {};

  db.prepare(
    `UPDATE items SET nombre=?, categoria=?, unidad=?, ubicacion=?, stock_minimo=?, serie=? WHERE id=?`
  ).run(
    b.nombre ?? item.nombre, b.categoria ?? item.categoria, b.unidad ?? item.unidad,
    b.ubicacion ?? item.ubicacion, b.stock_minimo ?? item.stock_minimo, b.serie ?? item.serie,
    item.id
  );
  auditar(req.session.usuario.id, 'item_editar', `Editó item ${item.codigo}`);
  res.json(db.prepare('SELECT * FROM items WHERE id = ?').get(item.id));
});

// DELETE /api/items/:id  -> desactivar (no se borra, queda el historial). Solo admin.
router.delete('/:id', requireRol('admin'), (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item no encontrado' });
  db.prepare('UPDATE items SET activo = 0 WHERE id = ?').run(item.id);
  auditar(req.session.usuario.id, 'item_desactivar', `Desactivó item ${item.codigo}`);
  res.json({ ok: true });
});

module.exports = router;
