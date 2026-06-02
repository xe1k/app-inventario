// Rutas de reportes y auditoría (M8): visión de gestión para el jefe.
//   1) Resumen general (KPIs de bodega).
//   2) Reporte de stock (existencias y valor de control).
//   3) Reporte de movimientos por período (agregados y rotación).
//   4) Reporte por trabajador (qué retiró y qué tiene pendiente de devolver).
//   5) Bitácora de auditoría: quién hizo qué y cuándo (solo admin).
// Cada reporte se puede descargar en CSV (Excel) desde /export/*.csv.
const express = require('express');
const db = require('../db');
const { requireRol } = require('../middleware/auth');

const router = express.Router();

// --- Helpers de período (?desde=YYYY-MM-DD&hasta=YYYY-MM-DD) ---
// Devuelve un fragmento SQL y sus parámetros para filtrar por la columna `col`.
function rango(col, desde, hasta) {
  let clause = '';
  const params = [];
  if (desde) { clause += ` AND ${col} >= ?`; params.push(desde); }
  if (hasta) { clause += ` AND ${col} <= ?`; params.push(hasta + ' 23:59:59'); }
  return { clause, params };
}

// --- Helper CSV (con BOM y separador ';' para que Excel lo abra bien en español) ---
function toCSV(columnas, filas) {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lineas = [columnas.map(c => cell(c.label)).join(';')];
  for (const f of filas) lineas.push(columnas.map(c => cell(f[c.key])).join(';'));
  return '﻿' + lineas.join('\r\n');
}
function enviarCSV(res, nombre, columnas, filas) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  res.send(toCSV(columnas, filas));
}

// ============================================================
//  1) RESUMEN GENERAL (KPIs)
// ============================================================
router.get('/resumen', (req, res) => {
  const porTipo = db.prepare(
    `SELECT tipo, COUNT(*) AS items, COALESCE(SUM(stock),0) AS stock
       FROM items WHERE activo = 1 GROUP BY tipo`
  ).all();
  const tipo = { retornable: { items: 0, stock: 0 }, consumible: { items: 0, stock: 0 } };
  for (const r of porTipo) tipo[r.tipo] = { items: r.items, stock: r.stock };

  const stockBajo = db.prepare(
    `SELECT COUNT(*) AS n FROM items WHERE activo = 1 AND stock_minimo > 0 AND stock <= stock_minimo`
  ).get().n;

  const fueraServicio = db.prepare(
    `SELECT COUNT(*) AS items, COALESCE(SUM(stock_reparacion),0) AS unidades
       FROM items WHERE activo = 1 AND stock_reparacion > 0`
  ).get();

  // Préstamos de retornables con saldo pendiente.
  const prestamos = db.prepare(
    `SELECT COALESCE(SUM(pend),0) AS unidades, COUNT(*) AS lineas FROM (
        SELECT m.cantidad - COALESCE((SELECT SUM(d.cantidad) FROM movimientos d
                 WHERE d.tipo='devolucion' AND d.prestamo_ref = m.id),0) AS pend
          FROM movimientos m JOIN items i ON i.id = m.item_id
         WHERE m.tipo='salida' AND i.tipo='retornable'
     ) WHERE pend > 0`
  ).get();

  const mov = (cond) => db.prepare(
    `SELECT COUNT(*) AS n FROM movimientos WHERE ${cond}`
  ).get().n;

  res.json({
    items_total: tipo.retornable.items + tipo.consumible.items,
    retornables: tipo.retornable,
    consumibles: tipo.consumible,
    stock_bajo: stockBajo,
    fuera_servicio: { items: fueraServicio.items, unidades: fueraServicio.unidades },
    prestamos_pendientes: { lineas: prestamos.lineas, unidades: prestamos.unidades },
    trabajadores_activos: db.prepare('SELECT COUNT(*) AS n FROM trabajadores WHERE activo = 1').get().n,
    usuarios_activos: db.prepare('SELECT COUNT(*) AS n FROM usuarios WHERE activo = 1').get().n,
    movimientos: {
      hoy: mov(`date(fecha) = date('now','localtime')`),
      semana: mov(`fecha >= datetime('now','localtime','-7 days')`),
      mes: mov(`fecha >= datetime('now','localtime','start of month')`)
    }
  });
});

// ============================================================
//  2) STOCK
// ============================================================
function consultarStock(q) {
  let sql = `SELECT codigo, nombre, tipo, categoria, unidad, ubicacion, serie,
                    stock, stock_minimo,
                    CASE WHEN stock_minimo > 0 AND stock <= stock_minimo THEN 1 ELSE 0 END AS bajo
               FROM items WHERE activo = 1`;
  const params = [];
  if (q && q.trim()) {
    sql += ' AND (nombre LIKE ? OR codigo LIKE ? OR categoria LIKE ?)';
    const like = '%' + q.trim() + '%';
    params.push(like, like, like);
  }
  sql += ' ORDER BY tipo, nombre';
  return db.prepare(sql).all(...params);
}

router.get('/stock', (req, res) => res.json(consultarStock(req.query.q)));

router.get('/export/stock.csv', (req, res) => {
  enviarCSV(res, 'stock.csv', [
    { key: 'codigo', label: 'Código' },
    { key: 'nombre', label: 'Nombre' },
    { key: 'tipo', label: 'Tipo' },
    { key: 'categoria', label: 'Marca' },
    { key: 'ubicacion', label: 'Ubicación' },
    { key: 'serie', label: 'N° Serie' },
    { key: 'stock', label: 'Stock' },
    { key: 'unidad', label: 'Unidad' },
    { key: 'stock_minimo', label: 'Stock mínimo' }
  ], consultarStock(req.query.q));
});

// ============================================================
//  3) MOVIMIENTOS POR PERÍODO
// ============================================================
router.get('/movimientos', (req, res) => {
  const { desde, hasta } = req.query;
  const r = rango('fecha', desde, hasta);

  const porTipo = db.prepare(
    `SELECT tipo, COUNT(*) AS movimientos, COALESCE(SUM(cantidad),0) AS unidades
       FROM movimientos WHERE 1=1 ${r.clause} GROUP BY tipo`
  ).all(...r.params);

  // Top items con más salidas (rotación) en el período.
  const rs = rango('m.fecha', desde, hasta);
  const topSalidas = db.prepare(
    `SELECT i.codigo, i.nombre, i.unidad, COUNT(*) AS veces, COALESCE(SUM(m.cantidad),0) AS unidades
       FROM movimientos m JOIN items i ON i.id = m.item_id
      WHERE m.tipo='salida' ${rs.clause}
      GROUP BY m.item_id ORDER BY unidades DESC, veces DESC LIMIT 10`
  ).all(...rs.params);

  res.json({ por_tipo: porTipo, top_salidas: topSalidas });
});

// Filas crudas de movimientos para descargar (mismo filtro que el historial).
function consultarMovimientos({ desde, hasta, tipo }) {
  let sql = `SELECT m.fecha, m.tipo, i.codigo, i.nombre AS item, m.cantidad, i.unidad,
                    t.nombre AS trabajador, u.nombre AS registrado_por, m.turno,
                    m.motivo, m.observacion
               FROM movimientos m
               JOIN items i ON i.id = m.item_id
               LEFT JOIN trabajadores t ON t.id = m.trabajador_id
               LEFT JOIN usuarios u ON u.id = m.usuario_id
              WHERE 1=1`;
  const params = [];
  if (tipo) { sql += ' AND m.tipo = ?'; params.push(tipo); }
  if (desde) { sql += ' AND m.fecha >= ?'; params.push(desde); }
  if (hasta) { sql += ' AND m.fecha <= ?'; params.push(hasta + ' 23:59:59'); }
  sql += ' ORDER BY m.fecha DESC, m.id DESC';
  return db.prepare(sql).all(...params);
}

router.get('/export/movimientos.csv', (req, res) => {
  enviarCSV(res, 'movimientos.csv', [
    { key: 'fecha', label: 'Fecha' },
    { key: 'tipo', label: 'Tipo' },
    { key: 'codigo', label: 'Código' },
    { key: 'item', label: 'Item' },
    { key: 'cantidad', label: 'Cantidad' },
    { key: 'unidad', label: 'Unidad' },
    { key: 'trabajador', label: 'Trabajador' },
    { key: 'registrado_por', label: 'Registró' },
    { key: 'turno', label: 'Turno' },
    { key: 'motivo', label: 'Motivo' },
    { key: 'observacion', label: 'Observación' }
  ], consultarMovimientos(req.query));
});

// ============================================================
//  4) POR TRABAJADOR
// ============================================================
function consultarTrabajadores({ desde, hasta }) {
  const r = rango('m.fecha', desde, hasta);
  // El conteo de retiros respeta el período; lo pendiente de devolver es siempre vigente.
  const sql =
    `SELECT t.id, t.nombre, t.identificador, t.area,
            (SELECT COUNT(*) FROM movimientos m
              WHERE m.trabajador_id = t.id AND m.tipo='salida' ${r.clause}) AS retiros,
            (SELECT COALESCE(SUM(m.cantidad),0) FROM movimientos m
              WHERE m.trabajador_id = t.id AND m.tipo='salida' ${r.clause}) AS unidades_retiradas,
            (SELECT COALESCE(SUM(m.cantidad - COALESCE(
                       (SELECT SUM(d.cantidad) FROM movimientos d
                         WHERE d.tipo='devolucion' AND d.prestamo_ref = m.id),0)),0)
               FROM movimientos m JOIN items i ON i.id = m.item_id
              WHERE m.trabajador_id = t.id AND m.tipo='salida' AND i.tipo='retornable') AS pendiente_devolver
       FROM trabajadores t WHERE t.activo = 1
      ORDER BY pendiente_devolver DESC, unidades_retiradas DESC, t.nombre`;
  // Los params de rango se usan en las dos primeras subconsultas.
  return db.prepare(sql).all(...r.params, ...r.params);
}

router.get('/trabajadores', (req, res) => res.json(consultarTrabajadores(req.query)));

router.get('/export/trabajadores.csv', (req, res) => {
  enviarCSV(res, 'trabajadores.csv', [
    { key: 'nombre', label: 'Trabajador' },
    { key: 'identificador', label: 'Identificador' },
    { key: 'area', label: 'Área' },
    { key: 'retiros', label: 'Retiros' },
    { key: 'unidades_retiradas', label: 'Unidades retiradas' },
    { key: 'pendiente_devolver', label: 'Pendiente devolver' }
  ], consultarTrabajadores(req.query));
});

// Detalle de un trabajador: lo que tiene pendiente + su historial reciente.
router.get('/trabajador/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM trabajadores WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Trabajador no encontrado' });

  const pendientes = db.prepare(
    `SELECT m.id, m.fecha, m.cantidad, i.codigo, i.nombre, i.unidad, i.serie,
            m.cantidad - COALESCE((SELECT SUM(d.cantidad) FROM movimientos d
                     WHERE d.tipo='devolucion' AND d.prestamo_ref = m.id),0) AS pendiente
       FROM movimientos m JOIN items i ON i.id = m.item_id
      WHERE m.trabajador_id = ? AND m.tipo='salida' AND i.tipo='retornable'
      ORDER BY m.fecha ASC`
  ).all(t.id).filter(p => p.pendiente > 0);

  const historial = db.prepare(
    `SELECT m.fecha, m.tipo, i.codigo, i.nombre, m.cantidad, i.unidad
       FROM movimientos m JOIN items i ON i.id = m.item_id
      WHERE m.trabajador_id = ? ORDER BY m.fecha DESC LIMIT 100`
  ).all(t.id);

  res.json({ trabajador: t, pendientes, historial });
});

// ============================================================
//  5) AUDITORÍA (solo admin)
// ============================================================
function consultarAuditoria({ desde, hasta, accion, q }) {
  let sql = `SELECT a.id, a.fecha, a.accion, a.detalle, a.usuario_id,
                    u.nombre AS usuario, u.username
               FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
              WHERE 1=1`;
  const params = [];
  if (accion) { sql += ' AND a.accion = ?'; params.push(accion); }
  if (q && q.trim()) { sql += ' AND a.detalle LIKE ?'; params.push('%' + q.trim() + '%'); }
  if (desde) { sql += ' AND a.fecha >= ?'; params.push(desde); }
  if (hasta) { sql += ' AND a.fecha <= ?'; params.push(hasta + ' 23:59:59'); }
  sql += ' ORDER BY a.fecha DESC, a.id DESC LIMIT 1000';
  return db.prepare(sql).all(...params);
}

router.get('/auditoria', requireRol('admin'), (req, res) => {
  const acciones = db.prepare(
    'SELECT DISTINCT accion FROM auditoria ORDER BY accion'
  ).all().map(r => r.accion);
  res.json({ acciones, registros: consultarAuditoria(req.query) });
});

router.get('/export/auditoria.csv', requireRol('admin'), (req, res) => {
  enviarCSV(res, 'auditoria.csv', [
    { key: 'fecha', label: 'Fecha' },
    { key: 'usuario', label: 'Usuario' },
    { key: 'accion', label: 'Acción' },
    { key: 'detalle', label: 'Detalle' }
  ], consultarAuditoria(req.query));
});

// ============================================================
//  6) REPORTE SEMANAL PARA JEFATURA
// ============================================================
function datosSemana({ desde, hasta }) {
  const rm = rango('fecha', desde, hasta);
  const movAgg = (tipo) => db.prepare(
    `SELECT COUNT(*) AS movimientos, COALESCE(SUM(cantidad),0) AS unidades
       FROM movimientos WHERE tipo = ? ${rm.clause}`
  ).get(tipo, ...rm.params);

  const bajoStock = db.prepare(
    `SELECT codigo, nombre, unidad, stock, stock_minimo
       FROM items WHERE activo = 1 AND stock_minimo > 0 AND stock <= stock_minimo
      ORDER BY (stock_minimo - stock) DESC, nombre`
  ).all();

  const ev = (accion) => db.prepare(
    `SELECT COALESCE(SUM(cantidad),0) AS u, COUNT(*) AS n FROM eventos_equipo WHERE accion = ? ${rm.clause}`
  ).get(accion, ...rm.params).u;
  const evBaja = (origen) => db.prepare(
    `SELECT COALESCE(SUM(cantidad),0) AS u FROM eventos_equipo WHERE accion='baja' AND origen = ? ${rm.clause}`
  ).get(origen, ...rm.params).u;

  // Solicitudes de trabajadores registradas en el período (lo que pidieron, sobre
  // todo lo que no había en bodega). Reemplaza al antiguo cálculo de "faltantes".
  const rs = rango('s.fecha', desde, hasta);
  const solicitudes = db.prepare(
    `SELECT s.fecha, s.solicitante, s.descripcion, s.cantidad, s.motivo, s.estado,
            i.codigo AS item_codigo
       FROM solicitudes s LEFT JOIN items i ON i.id = s.item_id
      WHERE 1=1 ${rs.clause}
      ORDER BY (s.estado='pendiente') DESC, s.fecha DESC`
  ).all(...rs.params);

  return {
    periodo: { desde, hasta },
    ingresos: movAgg('entrada'),
    salidas: movAgg('salida'),
    bajo_stock: bajoStock,
    reparaciones: {
      enviados: ev('enviar_reparacion'),
      danados_bodega: ev('danar_disponible'),
      reparados: ev('reparado'),
      baja_reparacion: evBaja('reparacion'),
      baja_disponible: evBaja('disponible')
    },
    solicitudes
  };
}

router.get('/semana', (req, res) => res.json(datosSemana(req.query)));

// ============================================================
//  HOJAS IMPRIMIBLES (listas para imprimir / guardar PDF)
// ============================================================
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function num(n) { return n == null ? '' : (Number.isInteger(n) ? n : Number(n).toFixed(2)); }
function fechaCorta(s) { return s ? String(s).replace('T', ' ').slice(0, 16) : ''; }

// Envuelve un cuerpo HTML en una hoja con cabecera, botón de imprimir y auto-print.
function paginaImprimible({ titulo, subtitulo, cuerpo }) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(titulo)}</title>
<style>
  *{box-sizing:border-box} body{font-family:system-ui,"Segoe UI",Roboto,sans-serif;color:#0f172a;margin:0;padding:1.5rem;background:#f1f5f9}
  .hoja{background:#fff;max-width:820px;margin:0 auto;padding:1.8rem 2rem;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.08)}
  .cab{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1e3a8a;padding-bottom:.7rem;margin-bottom:1rem}
  .cab .marca{font-weight:800;color:#1e3a8a;font-size:1.15rem}
  .cab .per{text-align:right;color:#64748b;font-size:.9rem}
  h3{color:#1e3a8a;font-size:1rem;margin:1.4rem 0 .5rem;border-bottom:1px solid #e2e8f0;padding-bottom:.3rem}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:.8rem}
  .kpi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:.8rem}
  .kpi .n{font-size:1.6rem;font-weight:800;color:#1e3a8a}
  .kpi .l{font-size:.78rem;color:#475569;margin-top:.2rem}
  .kpi .s{font-size:.72rem;color:#94a3b8}
  table{width:100%;border-collapse:collapse;margin-top:.3rem}
  th{background:#f8fafc;text-align:left;padding:.45rem .5rem;font-size:.72rem;text-transform:uppercase;color:#475569;border-bottom:1px solid #e2e8f0}
  td{padding:.45rem .5rem;border-bottom:1px solid #eef2f7;font-size:.88rem;vertical-align:top}
  .rojo{color:#dc2626;font-weight:700}.ok{color:#16a34a;font-size:.9rem}
  .badge{display:inline-block;padding:.1rem .5rem;border-radius:999px;font-size:.72rem;font-weight:700}
  .barra{max-width:820px;margin:0 auto 1rem;text-align:center}
  .barra button{background:#1d4ed8;color:#fff;border:none;padding:.6rem 1.2rem;border-radius:9px;font-weight:600;font-size:1rem;cursor:pointer}
  @media print{body{background:#fff;padding:0}.hoja{box-shadow:none;border-radius:0;max-width:100%}.barra{display:none}}
</style></head><body>
  <div class="barra"><button onclick="window.print()">🖨️ Imprimir / Guardar PDF</button></div>
  <div class="hoja">
    <div class="cab">
      <div class="marca">📦 Inventario de Bodega</div>
      <div class="per">${esc(titulo)}<br>${esc(subtitulo || '')}</div>
    </div>
    ${cuerpo}
    <p style="margin-top:2rem;text-align:center;color:#94a3b8;font-size:.72rem">Generado el ${new Date().toLocaleString('es-CL')}</p>
  </div>
  <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),400))</script>
</body></html>`;
}

// Construye una tabla HTML genérica. cols: [{label, render(fila) | key}]. vacio: texto si no hay filas.
function tablaImp(cols, filas, vacio) {
  if (!filas.length) return `<p class="ok">${vacio}</p>`;
  return `<table><thead><tr>${cols.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>`
    + filas.map(f => `<tr>${cols.map(c => `<td>${c.render ? c.render(f) : esc(f[c.key])}</td>`).join('')}</tr>`).join('')
    + '</tbody></table>';
}

const NOMBRE_TIPO = { entrada: 'Entradas', salida: 'Salidas', devolucion: 'Devoluciones', ajuste: 'Ajustes' };
function subtituloPeriodo({ desde, hasta }) {
  if (!desde && !hasta) return 'Todos los registros';
  return `${desde || '—'} a ${hasta || '—'}`;
}

// ---------- General (semana / jefatura) ----------
router.get('/semana/imprimir', (req, res) => {
  const d = datosSemana(req.query);
  const r = d.reparaciones;
  const bajasTotal = r.baja_reparacion + r.baja_disponible;
  const kpi = (lbl, val, sub) =>
    `<div class="kpi"><div class="n">${num(val)}</div><div class="l">${lbl}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;

  const tablaBajo = tablaImp([
    { label: 'Código', key: 'codigo' },
    { label: 'Item', key: 'nombre' },
    { label: 'Stock', render: i => `${num(i.stock)} ${esc(i.unidad)}` },
    { label: 'Mínimo', render: i => num(i.stock_minimo) },
    { label: 'Falta', render: i => `<span class="rojo">${num(Math.max(0, i.stock_minimo - i.stock))}</span>` }
  ], d.bajo_stock, '✔ Ningún item bajo el mínimo.');

  const tablaSol = tablaImp([
    { label: 'Fecha', render: s => fechaCorta(s.fecha) },
    { label: 'Quién pidió', key: 'solicitante' },
    { label: 'Qué pidió', render: s => esc(s.descripcion) + (s.cantidad != null ? ` (${num(s.cantidad)})` : '') },
    { label: 'Motivo', render: s => esc(s.motivo || '—') },
    { label: 'Estado', render: s => s.estado === 'pendiente' ? '<span class="rojo">Pendiente</span>' : 'Resuelta' }
  ], d.solicitudes, '✔ No se registraron solicitudes en el período.');

  const cuerpo = `
    <h3>Movimientos del período</h3>
    <div class="kpis">
      ${kpi('Ingresos de stock', d.ingresos.movimientos, num(d.ingresos.unidades) + ' unidades')}
      ${kpi('Salidas / entregas', d.salidas.movimientos, num(d.salidas.unidades) + ' unidades')}
      ${kpi('Equipos reparados', r.reparados, 'volvieron a servicio')}
      ${kpi('Equipos dados de baja', bajasTotal, num(r.baja_reparacion) + ' tras reparación')}
    </div>

    <h3>Reparaciones</h3>
    <div class="kpis">
      ${kpi('Enviados a reparación', r.enviados, '')}
      ${kpi('Dañados en bodega', r.danados_bodega, '')}
      ${kpi('Reparados', r.reparados, '')}
      ${kpi('De baja (irreparables)', r.baja_reparacion, 'fueron a reparación')}
    </div>

    <h3>Items bajo el stock mínimo (reponer)</h3>
    ${tablaBajo}

    <h3>Solicitudes de trabajadores (pedidos registrados)</h3>
    ${tablaSol}`;

  res.type('html').send(paginaImprimible({
    titulo: 'Reporte general', subtitulo: subtituloPeriodo(d.periodo), cuerpo
  }));
});

// ---------- Stock ----------
router.get('/stock/imprimir', (req, res) => {
  const filas = consultarStock(req.query.q);
  const cuerpo = `<h3>Existencias${req.query.q ? ` · filtro: “${esc(req.query.q)}”` : ''}</h3>` + tablaImp([
    { label: 'Código', key: 'codigo' },
    { label: 'Nombre', render: i => esc(i.nombre) + (i.serie ? `<br><span style="color:#94a3b8">S/N ${esc(i.serie)}</span>` : '') },
    { label: 'Tipo', render: i => i.tipo === 'retornable' ? 'Retornable' : 'Consumible' },
    { label: 'Ubicación', render: i => esc(i.ubicacion || '—') },
    { label: 'Stock', render: i => `${i.bajo ? '<span class="rojo">' : ''}${num(i.stock)} ${esc(i.unidad)}${i.bajo ? '</span>' : ''}` },
    { label: 'Mínimo', render: i => i.stock_minimo > 0 ? num(i.stock_minimo) : '—' }
  ], filas, 'Sin items.');
  res.type('html').send(paginaImprimible({ titulo: 'Reporte de stock', subtitulo: `${filas.length} item(s)`, cuerpo }));
});

// ---------- Movimientos ----------
router.get('/movimientos/imprimir', (req, res) => {
  const filas = consultarMovimientos(req.query);
  const cuerpo = `<h3>Movimientos del período (${filas.length})</h3>` + tablaImp([
    { label: 'Fecha', render: m => fechaCorta(m.fecha) },
    { label: 'Tipo', render: m => NOMBRE_TIPO[m.tipo] || esc(m.tipo) },
    { label: 'Item', render: m => `${esc(m.codigo)} · ${esc(m.item)}` },
    { label: 'Cant.', render: m => `${num(m.cantidad)} ${esc(m.unidad)}` },
    { label: 'Trabajador', render: m => esc(m.trabajador || '—') },
    { label: 'Registró', render: m => esc(m.registrado_por || '—') },
    { label: 'Área/Motivo', render: m => esc(m.motivo || '—') }
  ], filas, 'Sin movimientos en el período.');
  res.type('html').send(paginaImprimible({ titulo: 'Reporte de movimientos', subtitulo: subtituloPeriodo(req.query), cuerpo }));
});

// ---------- Por trabajador ----------
router.get('/trabajadores/imprimir', (req, res) => {
  const filas = consultarTrabajadores(req.query);
  const cuerpo = `<h3>Retiros y pendientes por trabajador</h3>` + tablaImp([
    { label: 'Trabajador', render: t => esc(t.nombre) + (t.identificador ? `<br><span style="color:#94a3b8">${esc(t.identificador)}</span>` : '') },
    { label: 'Área', render: t => esc(t.area || '—') },
    { label: 'Retiros', render: t => t.retiros },
    { label: 'Unidades', render: t => num(t.unidades_retiradas) },
    { label: 'Pendiente devolver', render: t => `${t.pendiente_devolver > 0 ? '<span class="rojo">' : ''}${num(t.pendiente_devolver)}${t.pendiente_devolver > 0 ? '</span>' : ''}` }
  ], filas, 'Sin trabajadores.');
  res.type('html').send(paginaImprimible({ titulo: 'Reporte por trabajador', subtitulo: subtituloPeriodo(req.query), cuerpo }));
});

// ---------- Bitácora / auditoría (solo admin) ----------
router.get('/auditoria/imprimir', requireRol('admin'), (req, res) => {
  const filas = consultarAuditoria(req.query);
  const cuerpo = `<h3>Bitácora de acciones (${filas.length})</h3>` + tablaImp([
    { label: 'Fecha', render: a => fechaCorta(a.fecha) },
    { label: 'Usuario', render: a => esc(a.usuario || '—') },
    { label: 'Acción', render: a => esc(a.accion) },
    { label: 'Detalle', render: a => esc(a.detalle || '') }
  ], filas, 'Sin registros para estos filtros.');
  res.type('html').send(paginaImprimible({ titulo: 'Bitácora', subtitulo: subtituloPeriodo(req.query), cuerpo }));
});

module.exports = router;
