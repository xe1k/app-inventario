// Middlewares de autorización por sesión.

// Exige sesión iniciada. Para llamadas a la API responde 401 en JSON;
// para navegación normal redirige al login.
function requireLogin(req, res, next) {
  if (req.session && req.session.usuario) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  return res.redirect('/login.html');
}

// Exige un rol específico (ej. 'admin').
function requireRol(rol) {
  return (req, res, next) => {
    if (req.session && req.session.usuario && req.session.usuario.rol === rol) {
      return next();
    }
    return res.status(403).json({ error: 'No autorizado para esta acción' });
  };
}

module.exports = { requireLogin, requireRol };
