// Servidor principal de la App de Inventario.
// Sirve la interfaz web (carpeta public) y la API REST.
const path = require('path');
const https = require('https');
const http = require('http');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');

const { obtenerCert, ipsLocales } = require('./cert');
const { backupDiario } = require('./backup');
const { requireLogin } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const itemsRoutes = require('./routes/items');
const trabajadoresRoutes = require('./routes/trabajadores');
const movimientosRoutes = require('./routes/movimientos');
const arqueosRoutes = require('./routes/arqueos');
const documentosRoutes = require('./routes/documentos');
const reportesRoutes = require('./routes/reportes');
const usuariosRoutes = require('./routes/usuarios');
const solicitudesRoutes = require('./routes/solicitudes');

const app = express();
const PORT = process.env.PORT || 3000;        // HTTPS (acceso normal)
const HTTP_PORT = Number(PORT) + 1;           // HTTP que solo redirige a HTTPS

app.use(express.json());
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'cambia-esta-clave-secreta-en-produccion',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 12 } // 12 horas (cubre un turno)
}));

// --- API ---
app.use('/api/auth', authRoutes);
app.use('/api/items', requireLogin, itemsRoutes);
app.use('/api/trabajadores', requireLogin, trabajadoresRoutes);
app.use('/api/movimientos', requireLogin, movimientosRoutes);
app.use('/api/arqueos', requireLogin, arqueosRoutes);
app.use('/api/documentos', requireLogin, documentosRoutes);
app.use('/api/reportes', requireLogin, reportesRoutes);
app.use('/api/usuarios', requireLogin, usuariosRoutes);
app.use('/api/solicitudes', requireLogin, solicitudesRoutes);

// La página de login y sus recursos son públicos; el resto exige sesión.
app.use((req, res, next) => {
  const publicos = ['/login.html', '/css/styles.css', '/js/login.js'];
  if (publicos.includes(req.path) || req.path.startsWith('/api/auth')) return next();
  return requireLogin(req, res, next);
});

// --- Interfaz web (estáticos) ---
app.use(express.static(path.join(__dirname, '..', 'public')));

// Raíz -> dashboard
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

// Servir por HTTPS: la cámara (escaneo) solo funciona en contexto seguro,
// y los celulares lo exigen al entrar por la red local.
(async () => {
  const { key, cert } = await obtenerCert();
  https.createServer({ key, cert }, app).listen(PORT, () => {
    console.log('\n  App Inventario corriendo (HTTPS):');
    console.log(`   - En este PC:        https://localhost:${PORT}`);
    for (const ip of ipsLocales()) {
      console.log(`   - Desde el celular:  https://${ip}:${PORT}`);
    }
    console.log('\n  Nota: al ser un certificado local, el navegador mostrará un aviso');
    console.log('  de seguridad la primera vez. Acepta "Continuar / Avanzado" para entrar.\n');
    // Respaldo automático de la base (máximo uno por día). No bloquea el arranque.
    backupDiario();
  });

  // HTTP en el puerto siguiente: solo redirige a HTTPS (por si entran sin https://).
  http.createServer((req, res) => {
    const host = (req.headers.host || `localhost:${HTTP_PORT}`).replace(/:\d+$/, `:${PORT}`);
    res.writeHead(301, { Location: `https://${host}${req.url}` });
    res.end();
  }).listen(HTTP_PORT);
})();
