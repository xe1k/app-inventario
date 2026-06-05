// Rutas de movimientos: entrada, salida/préstamo, devolución y ajuste.
// Cada movimiento es inmutable y queda ligado a quién lo registró.
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { requireRol } = require('../middleware/auth');

const router = express.Router();

// Carpeta donde se guardan las fotos de comprobantes firmados.
const FIRMAS_DIR = path.join(__dirname, '..', '..', 'data', 'firmas');
if (!fs.existsSync(FIRMAS_DIR)) fs.mkdirSync(FIRMAS_DIR, { recursive: true });

// Carpeta donde se guardan las firmas personales de los usuarios.
const FIRMAS_USUARIOS_DIR = path.join(__dirname, '..', '..', 'data', 'firmas-usuarios');
if (!fs.existsSync(FIRMAS_USUARIOS_DIR)) fs.mkdirSync(FIRMAS_USUARIOS_DIR, { recursive: true });

const subirFirma = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, FIRMAS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `entrega-${req.params.entregaId}${ext}`);
    }
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'].includes(ext)) cb(null, true);
    else cb(new Error('Solo se permiten imágenes (JPG, PNG, WEBP)'));
  }
});

function auditar(usuarioId, accion, detalle) {
  db.prepare('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?,?,?)')
    .run(usuarioId, accion, detalle);
}

// Inserta un movimiento y actualiza el stock del item, todo en una transacción.
const registrar = db.transaction((mov, deltaStock) => {
  const info = db.prepare(
    `INSERT INTO movimientos (item_id, tipo, cantidad, usuario_id, trabajador_id, turno, motivo, observacion, estado, prestamo_ref)
     VALUES (@item_id, @tipo, @cantidad, @usuario_id, @trabajador_id, @turno, @motivo, @observacion, @estado, @prestamo_ref)`
  ).run(mov);
  db.prepare('UPDATE items SET stock = stock + ? WHERE id = ?').run(deltaStock, mov.item_id);
  return info.lastInsertRowid;
});

// Registra una devolución. Si el equipo vuelve fuera de servicio (dañado/incompleto)
// la cantidad va al compartimiento de reparación; si no, vuelve al stock disponible.
const registrarDevolucion = db.transaction((mov, aReparacion) => {
  const info = db.prepare(
    `INSERT INTO movimientos (item_id, tipo, cantidad, usuario_id, trabajador_id, turno, motivo, observacion, estado, prestamo_ref)
     VALUES (@item_id, @tipo, @cantidad, @usuario_id, @trabajador_id, @turno, @motivo, @observacion, @estado, @prestamo_ref)`
  ).run(mov);
  const col = aReparacion ? 'stock_reparacion' : 'stock';
  db.prepare(`UPDATE items SET ${col} = ${col} + ? WHERE id = ?`).run(mov.cantidad, mov.item_id);
  return info.lastInsertRowid;
});

// Registra una entrega (varios items, mismo trabajador) en una sola transacción.
// Asigna un N° correlativo NUMÉRICO de entrega. NO se puede entregar más de lo que
// hay en stock (la validación se hizo antes, todo-o-nada). Cada item entregado queda
// como su propio movimiento (trazabilidad + devoluciones de retornables).
const registrarEntrega = db.transaction((detalles, ctx) => {
  const entregaId = String(
    db.prepare("SELECT COALESCE(MAX(CAST(entrega_id AS INTEGER)),0) AS m FROM movimientos WHERE entrega_id GLOB '[0-9]*'").get().m + 1
  );

  const insMov = db.prepare(
    `INSERT INTO movimientos (item_id, tipo, cantidad, usuario_id, trabajador_id, turno, motivo, observacion, entrega_id)
     VALUES (?, 'salida', ?, ?, ?, ?, ?, ?, ?)`
  );
  const updStock = db.prepare('UPDATE items SET stock = stock - ? WHERE id = ?');

  const ids = [];
  for (const d of detalles) {
    const info = insMov.run(d.item.id, d.cantidad, ctx.usuario_id, ctx.trabajador_id, ctx.turno, ctx.motivo, ctx.observacion, entregaId);
    updStock.run(d.cantidad, d.item.id);
    ids.push(info.lastInsertRowid);
  }
  return { entregaId, ids };
});

function baseMov(req, item, tipo) {
  return {
    item_id: item.id,
    tipo,
    cantidad: 0,
    usuario_id: req.session.usuario.id,
    trabajador_id: null,
    turno: req.session.usuario.turno || null,
    motivo: null,
    observacion: null,
    estado: null,
    prestamo_ref: null
  };
}

// ---------- ENTRADA (ingreso de stock) ----------
router.post('/entrada', (req, res) => {
  const b = req.body || {};
  const cantidad = Number(b.cantidad);
  if (!b.item_id || !(cantidad > 0)) return res.status(400).json({ error: 'Item y cantidad (> 0) son obligatorios' });
  const item = db.prepare('SELECT * FROM items WHERE id = ? AND activo = 1').get(b.item_id);
  if (!item) return res.status(404).json({ error: 'Item no encontrado' });

  const mov = { ...baseMov(req, item, 'entrada'), cantidad, motivo: b.motivo || null, observacion: b.observacion || null };
  const id = registrar(mov, cantidad);
  auditar(req.session.usuario.id, 'entrada', `Ingreso ${cantidad} de ${item.codigo}`);
  res.status(201).json({ id, stock: db.prepare('SELECT stock FROM items WHERE id=?').get(item.id).stock });
});

// ---------- SALIDA (entrega / préstamo) ----------
router.post('/salida', (req, res) => {
  const b = req.body || {};
  const cantidad = Number(b.cantidad);
  if (!b.item_id || !(cantidad > 0)) return res.status(400).json({ error: 'Item y cantidad (> 0) son obligatorios' });
  if (!b.trabajador_id) return res.status(400).json({ error: 'Debes indicar a qué trabajador se entrega' });

  const item = db.prepare('SELECT * FROM items WHERE id = ? AND activo = 1').get(b.item_id);
  if (!item) return res.status(404).json({ error: 'Item no encontrado' });
  const trab = db.prepare('SELECT * FROM trabajadores WHERE id = ? AND activo = 1').get(b.trabajador_id);
  if (!trab) return res.status(404).json({ error: 'Trabajador no encontrado' });

  if (cantidad > item.stock) {
    return res.status(409).json({ error: `Stock insuficiente: hay ${item.stock} ${item.unidad} de ${item.codigo}` });
  }

  const mov = {
    ...baseMov(req, item, 'salida'),
    cantidad, trabajador_id: trab.id, motivo: b.motivo || null, observacion: b.observacion || null
  };
  const id = registrar(mov, -cantidad);
  auditar(req.session.usuario.id, 'salida', `Salida ${cantidad} de ${item.codigo} a ${trab.nombre}`);
  res.status(201).json({
    id,
    esPrestamo: item.tipo === 'retornable',
    stock: db.prepare('SELECT stock FROM items WHERE id=?').get(item.id).stock
  });
});

// ---------- SALIDA MÚLTIPLE (varios items a un mismo trabajador, una entrega) ----------
router.post('/salida-multiple', (req, res) => {
  const b = req.body || {};
  const trab = db.prepare('SELECT * FROM trabajadores WHERE id = ? AND activo = 1').get(b.trabajador_id);
  if (!trab) return res.status(404).json({ error: 'Trabajador no encontrado' });

  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) return res.status(400).json({ error: 'Agrega al menos un item a la entrega' });

  // No se entrega más de lo que hay: si algún item no alcanza, se rechaza TODO.
  // Lo que se pidió y no había se anota aparte en "Solicitudes", no aquí.
  const detalles = [];
  const sinStock = [];
  for (const it of items) {
    const cantidad = Number(it.cantidad);
    const item = db.prepare('SELECT * FROM items WHERE id = ? AND activo = 1').get(it.item_id);
    if (!item) return res.status(404).json({ error: 'Un item de la lista no existe' });
    if (!(cantidad > 0)) return res.status(400).json({ error: `Cantidad inválida para ${item.codigo}` });
    if (cantidad > item.stock) sinStock.push(`${item.codigo} (pide ${cantidad}, hay ${item.stock} ${item.unidad})`);
    detalles.push({ item, cantidad });
  }
  if (sinStock.length) {
    return res.status(409).json({ error: 'Stock insuficiente: ' + sinStock.join('; ') + '. Ajusta las cantidades o registra una solicitud.' });
  }

  const ctx = {
    usuario_id: req.session.usuario.id, trabajador_id: trab.id,
    turno: req.session.usuario.turno || null,
    motivo: b.area || null, observacion: b.observacion || null
  };
  const { entregaId, ids } = registrarEntrega(detalles, ctx);

  const resumen = detalles.map(d => `${d.cantidad} ${d.item.codigo}`).join(', ');
  auditar(req.session.usuario.id, 'salida',
    `Entrega #${entregaId} a ${trab.nombre} (${ids.length} items): ${resumen}`);

  res.status(201).json({
    entrega_id: entregaId, ids, total_items: ids.length,
    hay_retornables: detalles.some(d => d.item.tipo === 'retornable')
  });
});

// ---------- DEVOLUCIÓN (de un retornable prestado) ----------
router.post('/devolucion', (req, res) => {
  const b = req.body || {};
  const prestamo = db.prepare(
    `SELECT m.*, i.tipo AS item_tipo, i.codigo, i.unidad FROM movimientos m
     JOIN items i ON i.id = m.item_id WHERE m.id = ? AND m.tipo = 'salida'`
  ).get(b.prestamo_ref);
  if (!prestamo) return res.status(404).json({ error: 'Préstamo no encontrado' });
  if (prestamo.item_tipo !== 'retornable') return res.status(400).json({ error: 'Solo se devuelven items retornables' });

  const devuelto = db.prepare(
    `SELECT COALESCE(SUM(cantidad),0) AS s FROM movimientos WHERE tipo='devolucion' AND prestamo_ref = ?`
  ).get(prestamo.id).s;
  const pendiente = prestamo.cantidad - devuelto;

  const cantidad = b.cantidad != null ? Number(b.cantidad) : pendiente;
  if (!(cantidad > 0)) return res.status(400).json({ error: 'Cantidad inválida' });
  if (cantidad > pendiente) {
    return res.status(409).json({ error: `Solo quedan ${pendiente} por devolver de este préstamo` });
  }

  // Condición del equipo al volver (bueno / con detalle / dañado / incompleto).
  const ESTADOS = ['bueno', 'detalle', 'danado', 'incompleto'];
  const estado = ESTADOS.includes(b.estado) ? b.estado : 'bueno';
  // Si vuelve dañado o incompleto, NO regresa al stock disponible: queda fuera de servicio.
  const aReparacion = estado === 'danado' || estado === 'incompleto';

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(prestamo.item_id);
  const mov = {
    ...baseMov(req, item, 'devolucion'),
    cantidad, trabajador_id: prestamo.trabajador_id,
    motivo: b.motivo || null, observacion: b.observacion || null, estado, prestamo_ref: prestamo.id
  };
  const id = registrarDevolucion(mov, aReparacion);
  const etqEstado = estado !== 'bueno' ? ` [${estado}]` : '';
  auditar(req.session.usuario.id, 'devolucion',
    `Devolución ${cantidad} de ${item.codigo} (préstamo #${prestamo.id})${etqEstado}`);
  res.status(201).json({ id, pendiente: pendiente - cantidad, fueraServicio: aReparacion });
});

// ---------- AJUSTE (corrección de inventario) - solo admin ----------
router.post('/ajuste', requireRol('admin'), (req, res) => {
  const b = req.body || {};
  const item = db.prepare('SELECT * FROM items WHERE id = ? AND activo = 1').get(b.item_id);
  if (!item) return res.status(404).json({ error: 'Item no encontrado' });
  if (b.stock_real == null || isNaN(Number(b.stock_real))) return res.status(400).json({ error: 'Indica el stock real contado' });
  if (!b.motivo) return res.status(400).json({ error: 'El motivo del ajuste es obligatorio' });

  const stockReal = Number(b.stock_real);
  const delta = stockReal - item.stock;
  if (delta === 0) return res.json({ ok: true, sinCambios: true });

  const mov = { ...baseMov(req, item, 'ajuste'), cantidad: delta, motivo: b.motivo, observacion: b.observacion || null };
  const id = registrar(mov, delta);
  auditar(req.session.usuario.id, 'ajuste', `Ajuste de ${item.codigo}: ${item.stock} -> ${stockReal} (${b.motivo})`);
  res.status(201).json({ id, stock: stockReal, delta });
});

// ---------- PRÉSTAMOS ABIERTOS (retornables que no han vuelto) ----------
router.get('/prestamos', (req, res) => {
  const rows = db.prepare(
    `SELECT m.id, m.cantidad, m.fecha, m.turno, m.motivo,
            i.codigo, i.nombre, i.unidad, i.serie,
            t.nombre AS trabajador, t.area,
            u.nombre AS entregado_por,
            m.cantidad - COALESCE((SELECT SUM(d.cantidad) FROM movimientos d WHERE d.tipo='devolucion' AND d.prestamo_ref = m.id),0) AS pendiente
     FROM movimientos m
     JOIN items i ON i.id = m.item_id
     LEFT JOIN trabajadores t ON t.id = m.trabajador_id
     LEFT JOIN usuarios u ON u.id = m.usuario_id
     WHERE m.tipo='salida' AND i.tipo='retornable'
     ORDER BY m.fecha DESC`
  ).all().filter(r => r.pendiente > 0);
  res.json(rows);
});

// ---------- DEVOLUCIONES REGISTRADAS (para revisar estado/condición) ----------
// Lista los retornos de equipos con su estado (bueno/dañado/…) y comentario,
// para que el admin/bodeguero revise cómo volvió cada cosa. ?estado= filtra.
router.get('/devoluciones', (req, res) => {
  const { estado } = req.query;
  let sql =
    `SELECT m.id, m.fecha, m.cantidad, m.estado, m.observacion, m.turno,
            i.codigo, i.nombre, i.unidad, i.serie,
            t.nombre AS trabajador, t.area,
            u.nombre AS recibido_por
       FROM movimientos m
       JOIN items i ON i.id = m.item_id
       LEFT JOIN trabajadores t ON t.id = m.trabajador_id
       LEFT JOIN usuarios u ON u.id = m.usuario_id
      WHERE m.tipo = 'devolucion'`;
  const params = [];
  if (estado) { sql += ' AND m.estado = ?'; params.push(estado); }
  sql += ' ORDER BY m.fecha DESC, m.id DESC LIMIT 500';
  res.json(db.prepare(sql).all(...params));
});

// ---------- FUERA DE SERVICIO (equipos dañados / en reparación) ----------
// Lista los items con unidades fuera de servicio. Para cada uno adjunta las últimas
// devoluciones dañadas/incompletas (incidencias) que ayudan a identificar el equipo.
router.get('/fuera-servicio', (req, res) => {
  const items = db.prepare(
    `SELECT id, codigo, nombre, unidad, serie, stock, stock_reparacion, stock_en_reparacion
       FROM items WHERE activo = 1 AND stock_reparacion > 0 ORDER BY nombre`
  ).all();
  const incidencias = db.prepare(
    `SELECT m.item_id, m.fecha, m.cantidad, m.estado, m.observacion,
            t.nombre AS trabajador, u.nombre AS recibido_por
       FROM movimientos m
       LEFT JOIN trabajadores t ON t.id = m.trabajador_id
       LEFT JOIN usuarios u ON u.id = m.usuario_id
      WHERE m.tipo='devolucion' AND m.estado IN ('danado','incompleto')
      ORDER BY m.fecha DESC, m.id DESC LIMIT 200`
  ).all();
  const porItem = {};
  for (const inc of incidencias) (porItem[inc.item_id] = porItem[inc.item_id] || []).push(inc);
  for (const it of items) it.incidencias = porItem[it.id] || [];
  res.json(items);
});

// Gestiona el estado de los equipos retornables. admin y bodeguero.
//   Estados: DISPONIBLE (stock) | FUERA DE SERVICIO (stock_reparacion), que se divide en
//            'dañado esperando' y 'en reparación' (stock_en_reparacion ⊆ stock_reparacion).
//   accion 'enviar_reparacion'  : dañado -> en reparación  (solo etiqueta, NO cambia el stock)
//   accion 'danar_disponible'   : disponible -> en reparación (se dañó en bodega; descuenta del disponible)
//   accion 'reparado'           : fuera de servicio -> disponible (quedó operativo)
//   accion 'baja'               : sale del inventario (origen: 'reparacion' o 'disponible')
router.post('/estado-equipo', (req, res) => {
  const b = req.body || {};
  const cantidad = Number(b.cantidad);
  const item = db.prepare('SELECT * FROM items WHERE id = ? AND activo = 1').get(b.item_id);
  if (!item) return res.status(404).json({ error: 'Item no encontrado' });
  if (!(cantidad > 0)) return res.status(400).json({ error: 'Indica una cantidad válida' });

  const u = item.unidad;
  const danadosEsperando = item.stock_reparacion - item.stock_en_reparacion;

  if (b.accion === 'enviar_reparacion') {
    if (cantidad > danadosEsperando) return res.status(409).json({ error: `Solo hay ${danadosEsperando} ${u} dañado(s) sin enviar de ${item.codigo}` });
    db.prepare('UPDATE items SET stock_en_reparacion = stock_en_reparacion + ? WHERE id = ?').run(cantidad, item.id);
    auditar(req.session.usuario.id, 'reparacion_enviar', `Marcó en reparación ${cantidad} de ${item.codigo}`);

  } else if (b.accion === 'danar_disponible') {
    if (cantidad > item.stock) return res.status(409).json({ error: `Solo hay ${item.stock} ${u} disponibles de ${item.codigo}` });
    db.prepare('UPDATE items SET stock = stock - ?, stock_reparacion = stock_reparacion + ?, stock_en_reparacion = stock_en_reparacion + ? WHERE id = ?').run(cantidad, cantidad, cantidad, item.id);
    auditar(req.session.usuario.id, 'reparacion_danar', `Envió a reparación ${cantidad} disponible(s) de ${item.codigo}${b.motivo ? ' (' + b.motivo + ')' : ''}`);

  } else if (b.accion === 'reparado') {
    if (cantidad > item.stock_reparacion) return res.status(409).json({ error: `Solo hay ${item.stock_reparacion} ${u} fuera de servicio de ${item.codigo}` });
    db.prepare('UPDATE items SET stock_reparacion = stock_reparacion - ?, stock = stock + ?, stock_en_reparacion = MAX(0, stock_en_reparacion - ?) WHERE id = ?').run(cantidad, cantidad, cantidad, item.id);
    auditar(req.session.usuario.id, 'reparacion_reparado', `Marcó reparado ${cantidad} de ${item.codigo}: vuelve a disponible`);

  } else if (b.accion === 'baja') {
    if (b.origen === 'disponible') {
      if (cantidad > item.stock) return res.status(409).json({ error: `Solo hay ${item.stock} ${u} disponibles de ${item.codigo}` });
      db.prepare('UPDATE items SET stock = stock - ? WHERE id = ?').run(cantidad, item.id);
    } else {
      if (cantidad > item.stock_reparacion) return res.status(409).json({ error: `Solo hay ${item.stock_reparacion} ${u} fuera de servicio de ${item.codigo}` });
      db.prepare('UPDATE items SET stock_reparacion = stock_reparacion - ?, stock_en_reparacion = MAX(0, stock_en_reparacion - ?) WHERE id = ?').run(cantidad, cantidad, item.id);
    }
    auditar(req.session.usuario.id, 'reparacion_baja', `Dio de baja ${cantidad} de ${item.codigo} (desde ${b.origen === 'disponible' ? 'disponible' : 'fuera de servicio'})${b.motivo ? ' · ' + b.motivo : ''}`);

  } else {
    return res.status(400).json({ error: 'Acción inválida' });
  }

  // Registro estructurado del evento (para el reporte semanal).
  const origenEvento = b.accion === 'baja' ? (b.origen === 'disponible' ? 'disponible' : 'reparacion') : null;
  db.prepare('INSERT INTO eventos_equipo (item_id, accion, origen, cantidad, usuario_id) VALUES (?,?,?,?,?)')
    .run(item.id, b.accion, origenEvento, cantidad, req.session.usuario.id);

  const fila = db.prepare('SELECT stock, stock_reparacion, stock_en_reparacion FROM items WHERE id = ?').get(item.id);
  res.json({ ok: true, ...fila });
});

// ---------- EDITAR un movimiento (solo admin) ----------
// Corrige datos que pudo equivocar el bodeguero (área/motivo, observación y, en
// salidas, el trabajador). NO toca la cantidad ni el stock: para eso está eliminar.
router.put('/:id', requireRol('admin'), (req, res) => {
  const mov = db.prepare('SELECT * FROM movimientos WHERE id = ?').get(req.params.id);
  if (!mov) return res.status(404).json({ error: 'Movimiento no encontrado' });
  const b = req.body || {};

  const motivo = b.motivo != null ? (String(b.motivo).trim() || null) : mov.motivo;
  const observacion = b.observacion != null ? (String(b.observacion).trim() || null) : mov.observacion;

  // El trabajador solo aplica a salidas (entregas/préstamos).
  let trabajadorId = mov.trabajador_id;
  if (mov.tipo === 'salida' && b.trabajador_id != null) {
    const t = db.prepare('SELECT * FROM trabajadores WHERE id = ? AND activo = 1').get(b.trabajador_id);
    if (!t) return res.status(404).json({ error: 'Trabajador no encontrado' });
    trabajadorId = t.id;
  }

  db.prepare('UPDATE movimientos SET motivo = ?, observacion = ?, trabajador_id = ? WHERE id = ?')
    .run(motivo, observacion, trabajadorId, mov.id);
  const item = db.prepare('SELECT codigo FROM items WHERE id = ?').get(mov.item_id);
  auditar(req.session.usuario.id, 'movimiento_editar', `Editó movimiento #${mov.id} (${mov.tipo} de ${item ? item.codigo : '?'})`);
  res.json({ ok: true });
});

// ---------- ELIMINAR un movimiento (solo admin) ----------
// Para corregir cuando el bodeguero registró algo por error. Revierte el efecto
// en el stock y borra el registro, todo en una transacción y dejándolo auditado.
const eliminarMov = db.transaction((movId, col, deltaRevertir, itemId) => {
  db.prepare(`UPDATE items SET ${col} = ${col} + ? WHERE id = ?`).run(deltaRevertir, itemId);
  db.prepare('DELETE FROM movimientos WHERE id = ?').run(movId);
});

router.delete('/:id', requireRol('admin'), (req, res) => {
  const mov = db.prepare('SELECT * FROM movimientos WHERE id = ?').get(req.params.id);
  if (!mov) return res.status(404).json({ error: 'Movimiento no encontrado' });

  // Una salida con devoluciones registradas no se puede borrar sin dejar huérfanas
  // esas devoluciones: el admin debe eliminar primero las devoluciones.
  if (mov.tipo === 'salida') {
    const devs = db.prepare(
      `SELECT COUNT(*) AS n FROM movimientos WHERE tipo='devolucion' AND prestamo_ref = ?`
    ).get(mov.id).n;
    if (devs > 0) {
      return res.status(409).json({ error: 'Este préstamo tiene devoluciones registradas. Elimina primero esas devoluciones.' });
    }
  }

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(mov.item_id);

  // ¿En qué compartimiento impactó el movimiento? Las devoluciones dañadas/incompletas
  // fueron a "fuera de servicio"; el resto, al stock disponible.
  const aReparacion = mov.tipo === 'devolucion' && (mov.estado === 'danado' || mov.estado === 'incompleto');
  const col = aReparacion ? 'stock_reparacion' : 'stock';
  // Delta original que aplicó al compartimiento; lo revertimos con el opuesto.
  const deltaOriginal = mov.tipo === 'salida' ? -mov.cantidad : mov.cantidad;
  const deltaRevertir = -deltaOriginal;

  if (item) {
    if (aReparacion && (item.stock_reparacion - item.stock_en_reparacion) < mov.cantidad) {
      return res.status(409).json({ error: 'Este equipo ya fue gestionado en “Fuera de servicio” (enviado a reparación, reparado o dado de baja). No se puede eliminar la devolución.' });
    }
    if (item[col] + deltaRevertir < 0) {
      return res.status(409).json({ error: 'Eliminar este movimiento dejaría el stock en negativo. Revisa el inventario antes.' });
    }
  }

  try {
    eliminarMov(mov.id, col, deltaRevertir, mov.item_id);
  } catch (e) {
    return res.status(409).json({ error: 'No se pudo eliminar: hay registros que dependen de este movimiento.' });
  }
  auditar(req.session.usuario.id, 'movimiento_eliminar',
    `Eliminó movimiento #${mov.id} (${mov.tipo} ${mov.cantidad} de ${item ? item.codigo : '?'})`);
  res.json({ ok: true });
});

// ---------- COMPROBANTE DE ENTREGA (imprimible) ----------
// Devuelve una página HTML lista para imprimir, con quién retiró qué, cuándo y
// quién lo entregó, más espacios de firma. Respaldo físico anti-robo de una salida.
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function numFmt(n) { return Number.isInteger(n) ? n : Number(n).toFixed(2); }

router.get('/:id/comprobante', (req, res) => {
  const m = db.prepare(
    `SELECT m.*, i.codigo, i.nombre AS item_nombre, i.tipo AS item_tipo, i.unidad, i.serie,
            t.nombre AS trabajador, t.identificador AS trab_id, t.cargo, t.area,
            u.nombre AS entregado_por
       FROM movimientos m
       JOIN items i ON i.id = m.item_id
       LEFT JOIN trabajadores t ON t.id = m.trabajador_id
       LEFT JOIN usuarios u ON u.id = m.usuario_id
      WHERE m.id = ?`
  ).get(req.params.id);
  if (!m) return res.status(404).send('Movimiento no encontrado');
  if (m.tipo !== 'salida') return res.status(400).send('Solo las salidas/préstamos tienen comprobante de entrega.');

  const esPrestamo = m.item_tipo === 'retornable';
  const titulo = esPrestamo ? 'Comprobante de préstamo' : 'Comprobante de entrega';
  const fila = (et, val) => val ? `<tr><th>${et}</th><td>${escHtml(val)}</td></tr>` : '';

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${titulo} N° ${m.id}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, "Segoe UI", Roboto, sans-serif; color: #0f172a; margin: 0; padding: 1.5rem; background: #f1f5f9; }
  .hoja { background: #fff; max-width: 620px; margin: 0 auto; padding: 1.8rem 2rem; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,.08); }
  .cab { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1e3a8a; padding-bottom: .8rem; }
  .cab .marca { font-weight: 800; color: #1e3a8a; font-size: 1.15rem; }
  .cab .tit { text-align: right; }
  .cab .tit .t { font-weight: 700; font-size: 1.05rem; }
  .cab .tit .n { color: #64748b; font-size: .9rem; }
  .pill { display: inline-block; margin-top: .3rem; padding: .15rem .6rem; border-radius: 999px; font-size: .72rem; font-weight: 700;
          background: ${esPrestamo ? '#dbeafe;color:#1e3a8a' : '#fef3c7;color:#92400e'}; }
  table.datos { width: 100%; border-collapse: collapse; margin-top: 1.1rem; }
  table.datos th { text-align: left; width: 38%; padding: .45rem .3rem; color: #475569; font-size: .82rem; vertical-align: top; font-weight: 600; }
  table.datos td { padding: .45rem .3rem; border-bottom: 1px solid #eef2f7; font-size: .95rem; }
  .destacado td { font-size: 1.15rem; font-weight: 700; }
  .nota { margin-top: 1rem; padding: .6rem .8rem; background: #fff7ed; border-left: 3px solid #ea580c; font-size: .85rem; color: #9a3412; border-radius: 4px; }
  .firmas { display: flex; gap: 2rem; margin-top: 2.8rem; }
  .firma { flex: 1; text-align: center; }
  .firma .linea { border-top: 1px solid #475569; padding-top: .35rem; font-size: .82rem; color: #475569; }
  .pie { margin-top: 1.6rem; text-align: center; color: #94a3b8; font-size: .72rem; }
  .barra { max-width: 620px; margin: 0 auto 1rem; text-align: center; }
  .barra button { background: #1d4ed8; color: #fff; border: none; padding: .6rem 1.2rem; border-radius: 9px; font-weight: 600; font-size: 1rem; cursor: pointer; }
  @media print { body { background: #fff; padding: 0; } .hoja { box-shadow: none; border-radius: 0; max-width: 100%; } .barra { display: none; } }
</style></head>
<body>
  <div class="barra"><button onclick="window.print()">🖨️ Imprimir</button></div>
  <div class="hoja">
    <div class="cab">
      <div class="marca">📦 Inventario de Bodega</div>
      <div class="tit">
        <div class="t">${titulo}</div>
        <div class="n">N° ${m.id} · ${escHtml(m.fecha)}</div>
        <div class="pill">${esPrestamo ? 'PRÉSTAMO (debe volver)' : 'ENTREGA / CONSUMO'}</div>
      </div>
    </div>

    <table class="datos">
      <tr class="destacado"><th>Item entregado</th><td>${escHtml(m.codigo)} · ${escHtml(m.item_nombre)}</td></tr>
      <tr class="destacado"><th>Cantidad</th><td>${numFmt(m.cantidad)} ${escHtml(m.unidad)}</td></tr>
      ${fila('N° de serie', m.serie)}
      <tr><th>Retirado por</th><td><strong>${escHtml(m.trabajador || '—')}</strong></td></tr>
      ${fila('Cargo', m.cargo)}
      ${fila('Identificador', m.trab_id)}
      <tr><th>Entregado por</th><td>${escHtml(m.entregado_por || '—')}${m.turno ? ' · turno ' + escHtml(m.turno) : ''}</td></tr>
      ${fila('Área', m.motivo)}
      ${fila('Observación', m.observacion)}
    </table>

    ${esPrestamo ? '<div class="nota">⚠️ Equipo <strong>retornable</strong>: debe ser devuelto a bodega. Este comprobante respalda el préstamo hasta su devolución.</div>' : ''}

    <div class="firmas">
      <div class="firma"><div class="linea">Firma de quien retira</div></div>
      <div class="firma"><div class="linea">Firma de bodega</div></div>
    </div>

    <div class="pie">Documento generado por el sistema de inventario · ${escHtml(m.fecha)}</div>
  </div>
  <script>window.addEventListener('load', () => setTimeout(() => window.print(), 350));</script>
</body></html>`;

  res.type('html').send(html);
});

// ---------- COMPROBANTE DE ENTREGA MÚLTIPLE (varios items, imprimible) ----------
router.get('/entrega/:entregaId/comprobante', (req, res) => {
  const movs = db.prepare(
    `SELECT m.cantidad, m.motivo, m.observacion, m.turno, m.fecha, m.usuario_id,
            i.codigo, i.nombre AS item_nombre, i.tipo AS item_tipo, i.unidad, i.serie,
            t.nombre AS trabajador, t.identificador AS trab_id, t.cargo,
            u.nombre AS entregado_por
       FROM movimientos m
       JOIN items i ON i.id = m.item_id
       LEFT JOIN trabajadores t ON t.id = m.trabajador_id
       LEFT JOIN usuarios u ON u.id = m.usuario_id
      WHERE m.entrega_id = ? AND m.tipo = 'salida'
      ORDER BY i.tipo, i.nombre`
  ).all(req.params.entregaId);
  if (!movs.length) return res.status(404).send('Entrega no encontrada');

  const e = movs[0];   // datos comunes de la entrega (trabajador, área, fecha, quien entregó)
  const hayRetornables = movs.some(m => m.item_tipo === 'retornable');
  const fila = (et, val) => val ? `<tr><th>${et}</th><td>${escHtml(val)}</td></tr>` : '';

  // Faltantes de esta entrega (lo que se pidió y no había en stock).
  const faltantes = db.prepare(
    `SELECT i.codigo, i.nombre, i.unidad, f.solicitado, f.faltante
       FROM faltantes f JOIN items i ON i.id = f.item_id WHERE f.entrega_id = ?`
  ).all(req.params.entregaId);
  const notaFaltantes = faltantes.length
    ? '<div class="nota" style="background:#fef2f2;border-left-color:#dc2626;color:#991b1b">⚠️ <strong>Faltantes (no había stock suficiente):</strong> '
      + faltantes.map(f => `${escHtml(f.codigo)} ${escHtml(f.nombre)} — faltaron ${numFmt(f.faltante)} de ${numFmt(f.solicitado)} ${escHtml(f.unidad)}`).join('; ')
      + '</div>'
    : '';

  const filasItems = movs.map(m => {
    const pill = m.item_tipo === 'retornable'
      ? '<span class="tipo ret">Retornable · debe volver</span>'
      : '<span class="tipo con">Consumible</span>';
    return `<tr>
      <td><strong>${escHtml(m.codigo)}</strong> · ${escHtml(m.item_nombre)}${m.serie ? '<br><span class="sn">S/N ' + escHtml(m.serie) + '</span>' : ''}</td>
      <td class="cant">${numFmt(m.cantidad)} ${escHtml(m.unidad)}</td>
      <td>${pill}</td>
    </tr>`;
  }).join('');

  // Firma del trabajador (digital o foto adjunta).
  const eidSan = req.params.entregaId.replace(/[^a-zA-Z0-9_-]/g, '');
  const archivoFirma = fs.readdirSync(FIRMAS_DIR).find(f => f.startsWith(`entrega-${eidSan}.`));
  let firmaHtml = '<div style="height:64px"></div>';
  if (archivoFirma) {
    const ext = path.extname(archivoFirma).toLowerCase();
    const mime = (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
    const b64 = fs.readFileSync(path.join(FIRMAS_DIR, archivoFirma)).toString('base64');
    firmaHtml = `<img src="data:${mime};base64,${b64}" style="max-width:220px;max-height:80px;display:block;margin:0 auto .35rem;border-radius:4px;border:1px solid #e2e8f0">`;
  }

  // Firma del bodeguero (firma personal guardada por el usuario que registró la entrega).
  const archivoFirmaUsuario = fs.readdirSync(FIRMAS_USUARIOS_DIR)
    .find(f => f.startsWith(`usuario-${e.usuario_id}.`));
  let firmaUsuarioHtml = '<div style="height:64px"></div>';
  if (archivoFirmaUsuario) {
    const ext = path.extname(archivoFirmaUsuario).toLowerCase();
    const mime = (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' : 'image/png';
    const b64 = fs.readFileSync(path.join(FIRMAS_USUARIOS_DIR, archivoFirmaUsuario)).toString('base64');
    firmaUsuarioHtml = `<img src="data:${mime};base64,${b64}" style="max-width:220px;max-height:80px;display:block;margin:0 auto .35rem;border-radius:4px;border:1px solid #e2e8f0">`;
  }

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Comprobante de entrega ${escHtml(req.params.entregaId)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, "Segoe UI", Roboto, sans-serif; color: #0f172a; margin: 0; padding: 1.5rem; background: #f1f5f9; }
  .hoja { background: #fff; max-width: 680px; margin: 0 auto; padding: 1.8rem 2rem; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,.08); }
  .cab { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1e3a8a; padding-bottom: .8rem; }
  .cab .marca { font-weight: 800; color: #1e3a8a; font-size: 1.15rem; }
  .cab .tit { text-align: right; }
  .cab .tit .t { font-weight: 700; font-size: 1.05rem; }
  .cab .tit .n { color: #64748b; font-size: .9rem; }
  table.datos { width: 100%; border-collapse: collapse; margin-top: 1.1rem; }
  table.datos th { text-align: left; width: 32%; padding: .4rem .3rem; color: #475569; font-size: .82rem; vertical-align: top; font-weight: 600; }
  table.datos td { padding: .4rem .3rem; border-bottom: 1px solid #eef2f7; font-size: .95rem; }
  h3.sec { margin: 1.4rem 0 .4rem; font-size: .95rem; color: #1e3a8a; }
  table.items { width: 100%; border-collapse: collapse; }
  table.items th { background: #f8fafc; text-align: left; padding: .5rem .5rem; font-size: .72rem; text-transform: uppercase; letter-spacing: .03em; color: #475569; border-bottom: 1px solid #e2e8f0; }
  table.items td { padding: .55rem .5rem; border-bottom: 1px solid #eef2f7; font-size: .92rem; vertical-align: top; }
  table.items td.cant { white-space: nowrap; font-weight: 700; }
  .sn { color: #94a3b8; font-size: .8rem; }
  .tipo { display: inline-block; padding: .12rem .5rem; border-radius: 999px; font-size: .7rem; font-weight: 700; }
  .tipo.ret { background: #dbeafe; color: #1e3a8a; }
  .tipo.con { background: #fef3c7; color: #92400e; }
  .nota { margin-top: 1rem; padding: .6rem .8rem; background: #fff7ed; border-left: 3px solid #ea580c; font-size: .85rem; color: #9a3412; border-radius: 4px; }
  .firmas { display: flex; gap: 2rem; margin-top: 2.8rem; }
  .firma { flex: 1; text-align: center; }
  .firma .linea { border-top: 1px solid #475569; padding-top: .35rem; font-size: .82rem; color: #475569; }
  .pie { margin-top: 1.6rem; text-align: center; color: #94a3b8; font-size: .72rem; }
  .compromiso { margin-top: 1.4rem; padding: .85rem 1rem; background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #1e3a8a; border-radius: 6px; font-size: .82rem; color: #1e293b; }
  .compromiso strong { display: block; margin-bottom: .45rem; font-size: .85rem; color: #1e3a8a; text-transform: uppercase; letter-spacing: .04em; }
  .compromiso ul { margin: .35rem 0 .5rem 1.1rem; padding: 0; }
  .compromiso ul li { margin-bottom: .2rem; }
  .compromiso p { margin: .45rem 0 0; color: #475569; }
  .barra { max-width: 680px; margin: 0 auto 1rem; text-align: center; }
  .barra button { background: #1d4ed8; color: #fff; border: none; padding: .6rem 1.2rem; border-radius: 9px; font-weight: 600; font-size: 1rem; cursor: pointer; }
  @media print { body { background: #fff; padding: 0; } .hoja { box-shadow: none; border-radius: 0; max-width: 100%; } .barra { display: none; } }
</style></head>
<body>
  <div class="barra"><button onclick="window.print()">🖨️ Imprimir</button></div>
  <div class="hoja">
    <div class="cab">
      <div class="marca">📦 Inventario de Bodega</div>
      <div class="tit">
        <div class="t">Comprobante de entrega</div>
        <div class="n">N° ${escHtml(req.params.entregaId)} · ${escHtml(e.fecha)}</div>
      </div>
    </div>

    <table class="datos">
      <tr><th>Retirado por</th><td><strong>${escHtml(e.trabajador || '—')}</strong></td></tr>
      ${fila('Cargo', e.cargo)}
      ${fila('Identificador', e.trab_id)}
      ${fila('Área', e.motivo)}
      <tr><th>Entregado por</th><td>${escHtml(e.entregado_por || '—')}${e.turno ? ' · turno ' + escHtml(e.turno) : ''}</td></tr>
      ${fila('Observación', e.observacion)}
    </table>

    <h3 class="sec">Items entregados (${movs.length})</h3>
    <table class="items">
      <thead><tr><th>Item</th><th>Cantidad</th><th>Tipo</th></tr></thead>
      <tbody>${filasItems}</tbody>
    </table>

    ${hayRetornables ? '<div class="nota">⚠️ Esta entrega incluye equipos <strong>retornables</strong> (marcados arriba): deben devolverse a bodega. Este comprobante respalda el préstamo hasta su devolución.</div>' : ''}
    ${notaFaltantes}

    <div class="compromiso">
      <strong>Compromiso de cuidado y responsabilidad</strong>
      El trabajador que suscribe declara haber recibido los elementos indicados en este documento en buen estado y se compromete a:
      <ul>
        <li>Utilizarlos exclusivamente en las labores asignadas y de acuerdo con su finalidad.</li>
        <li>Mantenerlos en buen estado, resguardarlos con el debido cuidado y no cederlos a terceros.</li>
        <li>Reportar de inmediato al encargado de bodega cualquier falla, deterioro, pérdida o hurto, sin excepción.</li>
        <li>Devolver los equipos retornables en el plazo acordado y en condiciones adecuadas de uso.</li>
      </ul>
      <p>El incumplimiento de estas obligaciones —incluyendo no reportar oportunamente daños o pérdidas— podrá dar lugar a las medidas disciplinarias establecidas en el Reglamento Interno de la empresa, sin perjuicio de las responsabilidades civiles o penales que pudieren corresponder.</p>
    </div>

    <div class="firmas">
      <div class="firma">
        ${firmaHtml}
        <div class="linea">Firma de quien retira</div>
      </div>
      <div class="firma">
        ${firmaUsuarioHtml}
        <div class="linea">Firma de bodega · ${escHtml(e.entregado_por || '')}</div>
      </div>
    </div>

    <div class="pie">Documento generado por el sistema de inventario · ${escHtml(e.fecha)}</div>
  </div>
  <script>window.addEventListener('load', () => setTimeout(() => window.print(), 350));</script>
</body></html>`;

  res.type('html').send(html);
});

// ---------- LISTADO DE ENTREGAS (para reimprimir comprobantes) ----------
router.get('/entregas', (req, res) => {
  const { desde, hasta, q } = req.query;
  let sql = `
    SELECT m.entrega_id,
           MIN(m.fecha) AS fecha,
           t.nombre    AS trabajador,
           t.identificador AS trab_id,
           t.cargo,
           u.nombre    AS entregado_por,
           m.motivo    AS area,
           COUNT(*)    AS total_items,
           SUM(CASE WHEN i.tipo = 'retornable' THEN 1 ELSE 0 END) AS retornables
      FROM movimientos m
      JOIN items i ON i.id = m.item_id
      LEFT JOIN trabajadores t ON t.id = m.trabajador_id
      LEFT JOIN usuarios u    ON u.id = m.usuario_id
     WHERE m.entrega_id IS NOT NULL AND m.tipo = 'salida'`;
  const params = [];
  if (desde) { sql += ' AND m.fecha >= ?'; params.push(desde); }
  if (hasta)  { sql += ' AND m.fecha <= ?'; params.push(hasta + ' 23:59:59'); }
  if (q) {
    sql += ' AND (t.nombre LIKE ? OR m.entrega_id LIKE ?)';
    params.push('%' + q + '%', '%' + q + '%');
  }
  sql += ' GROUP BY m.entrega_id ORDER BY MIN(m.fecha) DESC LIMIT 300';
  const rows = db.prepare(sql).all(...params);

  // Marcar cuáles tienen foto de firma subida.
  const conFirma = new Set(
    fs.readdirSync(FIRMAS_DIR).map(f => f.replace(/^entrega-/, '').replace(/\.[^.]+$/, ''))
  );
  res.json(rows.map(r => ({ ...r, tiene_firma: conFirma.has(String(r.entrega_id)) })));
});

// GET /entrega/:entregaId/firma  -> devuelve la foto del comprobante firmado
router.get('/entrega/:entregaId/firma', (req, res) => {
  const eid = req.params.entregaId.replace(/[^a-zA-Z0-9_-]/g, '');
  const archivo = fs.readdirSync(FIRMAS_DIR).find(f => f.startsWith(`entrega-${eid}.`));
  if (!archivo) return res.status(404).json({ error: 'Sin firma' });
  res.sendFile(path.join(FIRMAS_DIR, archivo));
});

// POST /entrega/:entregaId/firma  -> sube foto del comprobante firmado
router.post('/entrega/:entregaId/firma', (req, res) => {
  const eid = req.params.entregaId.replace(/[^a-zA-Z0-9_-]/g, '');
  // Eliminar firma anterior si existe (reemplazar).
  fs.readdirSync(FIRMAS_DIR).filter(f => f.startsWith(`entrega-${eid}.`))
    .forEach(f => fs.unlinkSync(path.join(FIRMAS_DIR, f)));
  subirFirma.single('firma')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });
    res.json({ ok: true });
  });
});

// POST /entrega/:entregaId/firma-digital  -> guarda firma capturada en canvas como PNG
router.post('/entrega/:entregaId/firma-digital', (req, res) => {
  const eid = req.params.entregaId.replace(/[^a-zA-Z0-9_-]/g, '');
  const { firma } = req.body;
  if (!firma || !firma.startsWith('data:image/png;base64,')) {
    return res.status(400).json({ error: 'Firma inválida' });
  }
  fs.readdirSync(FIRMAS_DIR).filter(f => f.startsWith(`entrega-${eid}.`))
    .forEach(f => fs.unlinkSync(path.join(FIRMAS_DIR, f)));
  const buf = Buffer.from(firma.replace(/^data:image\/png;base64,/, ''), 'base64');
  fs.writeFileSync(path.join(FIRMAS_DIR, `entrega-${eid}.png`), buf);
  res.json({ ok: true });
});

// ---------- HISTORIAL ----------
router.get('/', (req, res) => {
  const { item_id, trabajador_id, tipo, desde, hasta } = req.query;
  let sql = `SELECT m.*, i.codigo, i.nombre AS item_nombre, i.unidad,
                    t.nombre AS trabajador, u.nombre AS usuario
             FROM movimientos m
             JOIN items i ON i.id = m.item_id
             LEFT JOIN trabajadores t ON t.id = m.trabajador_id
             LEFT JOIN usuarios u ON u.id = m.usuario_id
             WHERE 1=1`;
  const params = [];
  if (item_id) { sql += ' AND m.item_id = ?'; params.push(item_id); }
  if (trabajador_id) { sql += ' AND m.trabajador_id = ?'; params.push(trabajador_id); }
  if (tipo) { sql += ' AND m.tipo = ?'; params.push(tipo); }
  if (desde) { sql += ' AND m.fecha >= ?'; params.push(desde); }
  if (hasta) { sql += ' AND m.fecha <= ?'; params.push(hasta + ' 23:59:59'); }
  sql += ' ORDER BY m.fecha DESC, m.id DESC LIMIT 500';
  res.json(db.prepare(sql).all(...params));
});

module.exports = router;
