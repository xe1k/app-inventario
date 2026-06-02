// Rutas de arqueo / cierre de turno: conteo físico de bodega.
// El bodeguero (o admin) cuenta los items y el sistema guarda lo contado vs.
// lo esperado. Cerrar el arqueo NO ajusta el stock: deja el descuadre registrado
// como evidencia (alimenta las alertas de descuadre del M7).
const express = require('express');
const db = require('../db');

const router = express.Router();

function auditar(usuarioId, accion, detalle) {
  db.prepare('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?,?,?)')
    .run(usuarioId, accion, detalle);
}

// Carga un arqueo y verifica que el usuario pueda operarlo.
// Devuelve el arqueo, o null si no existe / no tiene permiso (ya responde el error).
function cargarArqueo(req, res, { soloAbierto = false } = {}) {
  const arq = db.prepare('SELECT * FROM arqueos WHERE id = ?').get(req.params.id);
  if (!arq) { res.status(404).json({ error: 'Arqueo no encontrado' }); return null; }
  const u = req.session.usuario;
  if (u.rol !== 'admin' && arq.usuario_id !== u.id) {
    res.status(403).json({ error: 'Este arqueo es de otro bodeguero' }); return null;
  }
  if (soloAbierto && arq.estado !== 'abierto') {
    res.status(409).json({ error: 'El arqueo ya está cerrado' }); return null;
  }
  return arq;
}

// Resumen (totales) de un arqueo a partir de su detalle.
function resumen(arqueoId) {
  return db.prepare(
    `SELECT COUNT(*) AS contados,
            SUM(CASE WHEN diferencia <> 0 THEN 1 ELSE 0 END) AS descuadrados,
            COALESCE(SUM(CASE WHEN diferencia < 0 THEN -diferencia ELSE 0 END),0) AS faltante,
            COALESCE(SUM(CASE WHEN diferencia > 0 THEN diferencia ELSE 0 END),0) AS sobrante
       FROM arqueo_detalle WHERE arqueo_id = ?`
  ).get(arqueoId);
}

// ---------- ABRIR un arqueo ----------
router.post('/', (req, res) => {
  const u = req.session.usuario;
  const abierto = db.prepare("SELECT id FROM arqueos WHERE usuario_id = ? AND estado = 'abierto'").get(u.id);
  if (abierto) return res.status(409).json({ error: 'Ya tienes un arqueo abierto', id: abierto.id });

  const info = db.prepare('INSERT INTO arqueos (usuario_id, turno) VALUES (?,?)').run(u.id, u.turno || null);
  auditar(u.id, 'arqueo_abrir', `Abrió arqueo #${info.lastInsertRowid}`);
  res.status(201).json(db.prepare('SELECT * FROM arqueos WHERE id = ?').get(info.lastInsertRowid));
});

// ---------- ARQUEO ABIERTO del usuario actual ----------
router.get('/abierto', (req, res) => {
  const arq = db.prepare("SELECT * FROM arqueos WHERE usuario_id = ? AND estado = 'abierto'").get(req.session.usuario.id);
  res.json({ arqueo: arq || null });
});

// ---------- LISTA / historial de arqueos ----------
router.get('/', (req, res) => {
  const rows = db.prepare(
    `SELECT a.*, u.nombre AS usuario,
            (SELECT COUNT(*) FROM arqueo_detalle d WHERE d.arqueo_id = a.id) AS contados,
            (SELECT COUNT(*) FROM arqueo_detalle d WHERE d.arqueo_id = a.id AND d.diferencia <> 0) AS descuadrados
       FROM arqueos a
       JOIN usuarios u ON u.id = a.usuario_id
      ORDER BY a.abierto_en DESC, a.id DESC
      LIMIT 200`
  ).all();
  res.json(rows);
});

// ---------- HOJA DE CONTEO: items activos + lo ya contado en este arqueo ----------
router.get('/:id/hoja', (req, res) => {
  const arq = cargarArqueo(req, res);
  if (!arq) return;
  const items = db.prepare(
    `SELECT i.id, i.codigo, i.nombre, i.tipo, i.unidad, i.ubicacion, i.stock AS stock_sistema,
            d.stock_contado, d.diferencia, d.contado_en
       FROM items i
       LEFT JOIN arqueo_detalle d ON d.item_id = i.id AND d.arqueo_id = ?
      WHERE i.activo = 1
      ORDER BY i.nombre`
  ).all(arq.id);
  res.json({ arqueo: arq, items, resumen: resumen(arq.id) });
});

// ---------- DETALLE de un arqueo (solo lo contado) ----------
router.get('/:id', (req, res) => {
  const arq = cargarArqueo(req, res);
  if (!arq) return;
  const detalle = db.prepare(
    `SELECT d.*, i.codigo, i.nombre, i.tipo, i.unidad
       FROM arqueo_detalle d JOIN items i ON i.id = d.item_id
      WHERE d.arqueo_id = ?
      ORDER BY (d.diferencia <> 0) DESC, i.nombre`
  ).all(arq.id);
  const u = db.prepare('SELECT nombre FROM usuarios WHERE id = ?').get(arq.usuario_id);
  res.json({ arqueo: { ...arq, usuario: u ? u.nombre : null }, detalle, resumen: resumen(arq.id) });
});

// ---------- CONTAR un item (registrar / actualizar conteo) ----------
router.post('/:id/contar', (req, res) => {
  const arq = cargarArqueo(req, res, { soloAbierto: true });
  if (!arq) return;
  const b = req.body || {};
  const item = db.prepare('SELECT * FROM items WHERE id = ? AND activo = 1').get(b.item_id);
  if (!item) return res.status(404).json({ error: 'Item no encontrado' });
  if (b.stock_contado == null || isNaN(Number(b.stock_contado)) || Number(b.stock_contado) < 0) {
    return res.status(400).json({ error: 'Indica la cantidad contada (0 o más)' });
  }

  const contado = Number(b.stock_contado);
  const sistema = item.stock;                 // stock esperado al momento de contar
  const diferencia = contado - sistema;
  db.prepare(
    `INSERT INTO arqueo_detalle (arqueo_id, item_id, stock_sistema, stock_contado, diferencia)
     VALUES (@arqueo_id, @item_id, @stock_sistema, @stock_contado, @diferencia)
     ON CONFLICT(arqueo_id, item_id) DO UPDATE SET
       stock_sistema = excluded.stock_sistema,
       stock_contado = excluded.stock_contado,
       diferencia    = excluded.diferencia,
       contado_en    = datetime('now','localtime')`
  ).run({ arqueo_id: arq.id, item_id: item.id, stock_sistema: sistema, stock_contado: contado, diferencia });

  const det = db.prepare('SELECT * FROM arqueo_detalle WHERE arqueo_id = ? AND item_id = ?').get(arq.id, item.id);
  res.status(201).json({ detalle: det, resumen: resumen(arq.id) });
});

// ---------- QUITAR el conteo de un item ----------
router.delete('/:id/contar/:itemId', (req, res) => {
  const arq = cargarArqueo(req, res, { soloAbierto: true });
  if (!arq) return;
  db.prepare('DELETE FROM arqueo_detalle WHERE arqueo_id = ? AND item_id = ?').run(arq.id, req.params.itemId);
  res.json({ ok: true, resumen: resumen(arq.id) });
});

// ---------- CERRAR el arqueo (no ajusta stock) ----------
router.post('/:id/cerrar', (req, res) => {
  const arq = cargarArqueo(req, res, { soloAbierto: true });
  if (!arq) return;
  const r = resumen(arq.id);
  if (r.contados === 0) return res.status(400).json({ error: 'No has contado ningún item todavía' });

  db.prepare("UPDATE arqueos SET estado='cerrado', cerrado_en=datetime('now','localtime'), observacion=? WHERE id=?")
    .run((req.body && req.body.observacion) || null, arq.id);
  auditar(req.session.usuario.id,
    'arqueo_cerrar',
    `Cerró arqueo #${arq.id}: ${r.contados} contados, ${r.descuadrados} con descuadre (faltante ${r.faltante}, sobrante ${r.sobrante})`);
  res.json({ arqueo: db.prepare('SELECT * FROM arqueos WHERE id = ?').get(arq.id), resumen: r });
});

// ---------- DESCARTAR un arqueo abierto (sin cerrarlo) ----------
router.delete('/:id', (req, res) => {
  const arq = cargarArqueo(req, res, { soloAbierto: true });
  if (!arq) return;
  db.prepare('DELETE FROM arqueos WHERE id = ?').run(arq.id);   // cascade borra el detalle
  auditar(req.session.usuario.id, 'arqueo_descartar', `Descartó arqueo #${arq.id} sin cerrar`);
  res.json({ ok: true });
});

module.exports = router;
