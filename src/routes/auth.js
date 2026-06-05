// Rutas de autenticación: login, logout y datos del usuario en sesión.
const express = require('express');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const db = require('../db');

const FIRMAS_USUARIOS_DIR = path.join(__dirname, '..', '..', 'data', 'firmas-usuarios');
if (!fs.existsSync(FIRMAS_USUARIOS_DIR)) fs.mkdirSync(FIRMAS_USUARIOS_DIR, { recursive: true });

const router = express.Router();

// POST /api/auth/login  { username, password }
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Faltan usuario o clave' });
  }

  const u = db.prepare('SELECT * FROM usuarios WHERE username = ? AND activo = 1').get(username);
  if (!u || !bcrypt.compareSync(password, u.password_hash)) {
    return res.status(401).json({ error: 'Usuario o clave incorrectos' });
  }

  // Guardar en sesión solo lo necesario (nunca el hash).
  req.session.usuario = { id: u.id, username: u.username, nombre: u.nombre, rol: u.rol, turno: u.turno };

  db.prepare('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?,?,?)')
    .run(u.id, 'login', `Inició sesión: ${u.username}`);

  res.json({ usuario: req.session.usuario });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const u = req.session && req.session.usuario;
  if (u) {
    db.prepare('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?,?,?)')
      .run(u.id, 'logout', `Cerró sesión: ${u.username}`);
  }
  req.session.destroy(() => res.json({ ok: true }));
});

// GET /api/auth/me  -> usuario actual (o 401)
router.get('/me', (req, res) => {
  if (req.session && req.session.usuario) return res.json({ usuario: req.session.usuario });
  res.status(401).json({ error: 'No autenticado' });
});

// GET /api/auth/mi-firma  -> devuelve la firma guardada del usuario en sesión
router.get('/mi-firma', (req, res) => {
  if (!req.session || !req.session.usuario) return res.status(401).json({ error: 'No autenticado' });
  const uid = req.session.usuario.id;
  const archivo = fs.readdirSync(FIRMAS_USUARIOS_DIR).find(f => f.startsWith(`usuario-${uid}.`));
  if (!archivo) return res.status(404).json({ error: 'Sin firma' });
  res.sendFile(path.join(FIRMAS_USUARIOS_DIR, archivo));
});

// POST /api/auth/mi-firma  -> guarda la firma del usuario en sesión (base64 PNG)
router.post('/mi-firma', (req, res) => {
  if (!req.session || !req.session.usuario) return res.status(401).json({ error: 'No autenticado' });
  const uid = req.session.usuario.id;
  const { firma } = req.body;
  if (!firma || !firma.startsWith('data:image/png;base64,')) {
    return res.status(400).json({ error: 'Firma inválida' });
  }
  fs.readdirSync(FIRMAS_USUARIOS_DIR).filter(f => f.startsWith(`usuario-${uid}.`))
    .forEach(f => fs.unlinkSync(path.join(FIRMAS_USUARIOS_DIR, f)));
  const buf = Buffer.from(firma.replace(/^data:image\/png;base64,/, ''), 'base64');
  fs.writeFileSync(path.join(FIRMAS_USUARIOS_DIR, `usuario-${uid}.png`), buf);
  res.json({ ok: true });
});

// DELETE /api/auth/mi-firma  -> elimina la firma guardada del usuario en sesión
router.delete('/mi-firma', (req, res) => {
  if (!req.session || !req.session.usuario) return res.status(401).json({ error: 'No autenticado' });
  const uid = req.session.usuario.id;
  fs.readdirSync(FIRMAS_USUARIOS_DIR).filter(f => f.startsWith(`usuario-${uid}.`))
    .forEach(f => fs.unlinkSync(path.join(FIRMAS_USUARIOS_DIR, f)));
  res.json({ ok: true });
});

module.exports = router;
