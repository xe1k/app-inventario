// Documentos por semana: espacio para subir y consultar archivos (Word/PDF)
// organizados en carpetas (Semana 1, Semana 2, …). Reemplaza al antiguo arqueo
// en el panel. Los archivos viven en disco bajo data/documentos/<carpeta>/,
// fáciles de respaldar; no se guardan en la base de datos.
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { requireRol } = require('../middleware/auth');

const router = express.Router();

// Número de semana ISO-8601 de hoy (1–53). Sirve para que las carpetas
// nuevas arranquen en la semana del calendario en curso (p. ej. Semana 23).
function semanaISO(fecha = new Date()) {
  const d = new Date(Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));   // jueves de esa semana
  const inicioAnio = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - inicioAnio) / 86400000 + 1) / 7);
}

// Carpeta raíz donde se guardan todos los documentos.
const BASE = path.join(__dirname, '..', '..', 'data', 'documentos');
if (!fs.existsSync(BASE)) fs.mkdirSync(BASE, { recursive: true });

// Extensiones permitidas (Word y PDF).
const EXT_OK = new Set(['.pdf', '.doc', '.docx']);

// --- Helpers de seguridad de rutas ---
// Devuelve la ruta absoluta de una carpeta SOLO si es hija directa de BASE
// (evita "../" y rutas fuera del espacio de documentos). null si no es válida.
function rutaCarpeta(nombre) {
  if (!nombre || typeof nombre !== 'string') return null;
  const limpio = path.basename(nombre);                 // descarta cualquier separador
  if (limpio !== nombre || limpio === '.' || limpio === '..') return null;
  const abs = path.join(BASE, limpio);
  if (path.dirname(abs) !== BASE) return null;
  return abs;
}

// Igual para un archivo dentro de una carpeta ya validada.
function rutaArchivo(carpetaAbs, nombre) {
  if (!nombre || typeof nombre !== 'string') return null;
  const limpio = path.basename(nombre);
  if (limpio !== nombre) return null;
  const abs = path.join(carpetaAbs, limpio);
  if (path.dirname(abs) !== carpetaAbs) return null;
  return abs;
}

function auditar(req, accion, detalle) {
  try {
    const db = require('../db');
    db.prepare('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?,?,?)')
      .run(req.session.usuario.id, accion, detalle);
  } catch { /* la auditoría no debe romper la subida */ }
}

// Si ya existe un archivo con ese nombre, agrega " (2)", " (3)"… antes de la extensión.
function nombreLibre(carpetaAbs, original) {
  const ext = path.extname(original);
  const base = path.basename(original, ext);
  let candidato = original;
  let n = 2;
  while (fs.existsSync(path.join(carpetaAbs, candidato))) {
    candidato = `${base} (${n})${ext}`;
    n++;
  }
  return candidato;
}

// --- Subida con multer (en disco, dentro de la carpeta indicada) ---
const storage = multer.diskStorage({
  destination(req, file, cb) {
    const carpetaAbs = rutaCarpeta(req.params.carpeta);
    if (!carpetaAbs || !fs.existsSync(carpetaAbs)) {
      return cb(new Error('Carpeta no encontrada'));
    }
    req._carpetaAbs = carpetaAbs;
    cb(null, carpetaAbs);
  },
  filename(req, file, cb) {
    // multer entrega el nombre en latin1; lo pasamos a UTF-8 para acentos/ñ.
    const original = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, nombreLibre(req._carpetaAbs, original));
  }
});

const subir = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },   // 25 MB por archivo
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (EXT_OK.has(ext)) return cb(null, true);
    cb(new Error('Solo se permiten archivos Word (.doc, .docx) o PDF (.pdf)'));
  }
});

// Lista los archivos de una carpeta con tamaño y fecha de modificación.
function listarArchivos(carpetaAbs) {
  return fs.readdirSync(carpetaAbs, { withFileTypes: true })
    .filter(d => d.isFile())
    .map(d => {
      const st = fs.statSync(path.join(carpetaAbs, d.name));
      return { nombre: d.name, tamano: st.size, modificado: st.mtime.toISOString() };
    })
    .sort((a, b) => b.modificado.localeCompare(a.modificado));
}

// ---------- CARPETAS ----------
// GET /api/documentos  -> lista de carpetas con su conteo de archivos
router.get('/', (req, res) => {
  const carpetas = fs.readdirSync(BASE, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const abs = path.join(BASE, d.name);
      return {
        nombre: d.name,
        archivos: listarArchivos(abs).length,
        creada: fs.statSync(abs).birthtime.toISOString()
      };
    })
    // ordena "Semana 2" antes que "Semana 10" numéricamente cuando aplica
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
  res.json(carpetas);
});

// POST /api/documentos  -> crea automáticamente la siguiente "Semana N".
// Arranca en la semana ISO en curso (p. ej. 23) y de ahí va incrementando.
// Solo el jefe (admin) gestiona carpetas.
router.post('/', requireRol('admin'), (req, res) => {
  const existentes = fs.readdirSync(BASE, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
  // Base: la mayor "Semana N" existente, o la semana del calendario menos 1
  // (para que la primera carpeta sea la semana actual).
  let max = semanaISO() - 1;
  for (const nombre of existentes) {
    const m = nombre.match(/^Semana\s+(\d+)$/i);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const nombre = `Semana ${max + 1}`;
  const abs = path.join(BASE, nombre);
  fs.mkdirSync(abs);
  auditar(req, 'documento_carpeta_crear', `Creó carpeta ${nombre}`);
  res.status(201).json({ nombre, archivos: 0 });
});

// PUT /api/documentos/:carpeta  -> renombra la carpeta. Solo el jefe (admin).
// body: { nombre }
router.put('/:carpeta', requireRol('admin'), (req, res) => {
  const abs = rutaCarpeta(req.params.carpeta);
  if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: 'Carpeta no encontrada' });
  const nuevo = (req.body && req.body.nombre || '').trim();
  if (!nuevo) return res.status(400).json({ error: 'El nombre no puede estar vacío' });
  const destino = rutaCarpeta(nuevo);
  if (!destino) return res.status(400).json({ error: 'Nombre de carpeta no válido (sin / \\ ni ..)' });
  if (path.basename(destino) === path.basename(abs)) return res.json({ ok: true, nombre: nuevo });
  if (fs.existsSync(destino)) return res.status(409).json({ error: 'Ya existe una carpeta con ese nombre' });
  fs.renameSync(abs, destino);
  auditar(req, 'documento_carpeta_renombrar', `Renombró ${req.params.carpeta} -> ${nuevo}`);
  res.json({ ok: true, nombre: nuevo });
});

// DELETE /api/documentos/:carpeta  -> borra la carpeta y su contenido. Solo el jefe (admin).
router.delete('/:carpeta', requireRol('admin'), (req, res) => {
  const abs = rutaCarpeta(req.params.carpeta);
  if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: 'Carpeta no encontrada' });
  fs.rmSync(abs, { recursive: true, force: true });
  auditar(req, 'documento_carpeta_borrar', `Borró carpeta ${req.params.carpeta}`);
  res.json({ ok: true });
});

// ---------- ARCHIVOS ----------
// GET /api/documentos/:carpeta/archivos  -> lista de archivos de la carpeta
router.get('/:carpeta/archivos', (req, res) => {
  const abs = rutaCarpeta(req.params.carpeta);
  if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: 'Carpeta no encontrada' });
  res.json(listarArchivos(abs));
});

// POST /api/documentos/:carpeta/archivos  -> sube uno o varios archivos
router.post('/:carpeta/archivos', (req, res) => {
  subir.array('archivos', 20)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.files || !req.files.length) return res.status(400).json({ error: 'No se recibió ningún archivo' });
    auditar(req, 'documento_subir',
      `Subió ${req.files.length} archivo(s) a ${req.params.carpeta}`);
    res.status(201).json({ ok: true, subidos: req.files.map(f => f.filename) });
  });
});

// GET /api/documentos/:carpeta/archivos/:archivo  -> descarga
router.get('/:carpeta/archivos/:archivo', (req, res) => {
  const carpetaAbs = rutaCarpeta(req.params.carpeta);
  if (!carpetaAbs) return res.status(404).json({ error: 'Carpeta no encontrada' });
  const abs = rutaArchivo(carpetaAbs, req.params.archivo);
  if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: 'Archivo no encontrado' });
  res.download(abs, req.params.archivo);
});

// DELETE /api/documentos/:carpeta/archivos/:archivo  -> borra un archivo. Solo el jefe (admin).
router.delete('/:carpeta/archivos/:archivo', requireRol('admin'), (req, res) => {
  const carpetaAbs = rutaCarpeta(req.params.carpeta);
  if (!carpetaAbs) return res.status(404).json({ error: 'Carpeta no encontrada' });
  const abs = rutaArchivo(carpetaAbs, req.params.archivo);
  if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: 'Archivo no encontrado' });
  fs.unlinkSync(abs);
  auditar(req, 'documento_borrar', `Borró ${req.params.archivo} de ${req.params.carpeta}`);
  res.json({ ok: true });
});

module.exports = router;
