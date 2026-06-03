// Lógica del panel principal.
async function cargarUsuario() {
  try {
    const r = await fetch('/api/auth/me');
    if (!r.ok) { window.location.href = '/login.html'; return null; }
    const { usuario } = await r.json();
    const turno = usuario.turno ? ` · turno ${usuario.turno}` : '';
    document.getElementById('userInfo').textContent = `${usuario.nombre} (${usuario.rol}${turno})`;
    return usuario;
  } catch {
    window.location.href = '/login.html';
    return null;
  }
}

// Oculta del panel los accesos marcados como solo-admin si el usuario no lo es.
function ajustarAccesos(usuario) {
  if (usuario && usuario.rol === 'admin') return;
  document.querySelectorAll('.tile[data-admin]').forEach(t => t.remove());
}

// Indicadores clave del panel: lee el resumen y pinta tarjetas.
// Las de riesgo (préstamos sin devolver, stock crítico) van en rojo y llevan a Alertas.
function fmt(n) { return Number.isInteger(n) ? n : Number(n).toFixed(2); }

async function cargarIndicadores() {
  const cont = document.getElementById('kpis');
  if (!cont) return;
  try {
    const r = await fetch('/api/reportes/resumen');
    if (!r.ok) { cont.style.display = 'none'; return; }
    const d = await r.json();

    // Aviso destacado si hay equipos fuera de servicio (dañados / en reparación).
    const aviso = document.getElementById('avisoFuera');
    if (aviso && d.fuera_servicio && d.fuera_servicio.unidades > 0) {
      const u = fmt(d.fuera_servicio.unidades);
      aviso.innerHTML = `🛠️ <strong>${u}</strong> ${u == 1 ? 'equipo' : 'unidades'} fuera de servicio (dañado / en reparación). Toca para revisar →`;
      aviso.style.display = 'block';
    }

    const kpi = ({ num, lbl, sub, alerta, href }) => {
      const cls = 'kpi' + (alerta ? ' alerta' : '');
      const inner =
        `<div class="num">${num}</div><div class="lbl">${lbl}</div>` +
        (sub ? `<div class="sub">${sub}</div>` : '');
      return href
        ? `<a class="${cls}" href="${href}">${inner}</a>`
        : `<div class="${cls}">${inner}</div>`;
    };

    // Solo los dos indicadores de riesgo, en grande.
    cont.classList.add('kpis-grandes');
    cont.innerHTML = [
      kpi({
        num: d.prestamos_pendientes.lineas,
        lbl: 'Préstamos sin devolver',
        sub: `${fmt(d.prestamos_pendientes.unidades)} unidades fuera de bodega`,
        alerta: d.prestamos_pendientes.lineas > 0,
        href: '/prestamos.html'
      }),
      kpi({
        num: d.stock_bajo,
        lbl: 'Stock crítico',
        sub: 'items bajo el mínimo',
        alerta: d.stock_bajo > 0,
        href: '/items.html'
      })
    ].join('');
  } catch {
    cont.style.display = 'none';
  }
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

// Mapa de módulos ya implementados -> su página.
const RUTAS = {
  items: '/items.html',
  entrada: '/entrada.html',
  salida: '/salida.html',
  prestamos: '/prestamos.html',
  devoluciones: '/devoluciones.html',
  solicitudes: '/solicitudes.html',
  documentos: '/documentos.html',
  trabajadores: '/trabajadores.html',
  historial: '/historial.html',
  reportes: '/reportes.html',
  bitacora: '/bitacora.html',
  usuarios: '/usuarios.html',
  comprobantes: '/comprobantes.html'
};

document.querySelectorAll('.tile').forEach(t => {
  t.addEventListener('click', () => {
    const m = t.dataset.modulo;
    if (RUTAS[m]) window.location.href = RUTAS[m];
    else alert('Módulo "' + m + '": disponible en el siguiente paso.');
  });
});

(async () => {
  const usuario = await cargarUsuario();
  ajustarAccesos(usuario);
})();
cargarIndicadores();
