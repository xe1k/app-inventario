// Documentos por semana: carpetas (Semana 1, 2, 3…) con archivos Word/PDF.
// Vista 1: lista de carpetas. Vista 2: archivos dentro de una carpeta (subir/descargar/borrar).
let carpetaActual = null;   // null = vista de carpetas
let esAdmin = false;        // el jefe (admin) gestiona; el bodeguero solo sube

function fmtTamano(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}
function fmtFecha(iso) {
  const d = new Date(iso);
  return d.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
// Icono según extensión.
function icono(nombre) {
  const ext = (nombre.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return '📕';
  if (ext === 'doc' || ext === 'docx') return '📘';
  return '📄';
}

// ---------- Vista de carpetas ----------
async function renderCarpetas() {
  carpetaActual = null;
  const carpetas = await getJSON('/api/documentos');

  let lista = '';
  if (carpetas.length) {
    lista = '<div class="grid">';
    for (const c of carpetas) {
      // Solo el jefe (admin) ve los botones de renombrar y borrar carpeta.
      const acciones = esAdmin ? `
        <button class="btn-sm" title="Renombrar carpeta"
          style="position:absolute;top:.4rem;left:.4rem;background:#e0f2fe;color:var(--azul-osc)"
          onclick="event.stopPropagation();renombrarCarpeta('${esc(c.nombre)}')">✏️</button>
        <button class="btn-sm" title="Borrar carpeta"
          style="position:absolute;top:.4rem;right:.4rem;background:#fee2e2;color:var(--rojo)"
          onclick="event.stopPropagation();borrarCarpeta('${esc(c.nombre)}')">✕</button>` : '';
      lista += `<div class="tile" style="position:relative" onclick="abrirCarpeta('${esc(c.nombre)}')">
        ${acciones}
        <div class="ico">📁</div>
        <div class="lbl">${esc(c.nombre)}</div>
        <div class="muted">${c.archivos} archivo${c.archivos === 1 ? '' : 's'}</div>
      </div>`;
    }
    lista += '</div>';
  } else {
    lista = `<div class="empty">Aún no hay carpetas.${esAdmin ? ' Crea la primera semana.' : ' Pídele al jefe que cree la semana.'}</div>`;
  }

  // El bodeguero no crea carpetas (solo sube archivos); el botón es solo para el jefe.
  const btnNueva = esAdmin ? '<button class="btn-inline" id="btnNueva">＋ Nueva semana</button>' : '';
  $('vista').innerHTML = `
    <div class="toolbar" style="justify-content:space-between">
      <div><h2 class="section">Carpetas por semana</h2>
        <span class="muted">Sube informes en Word o PDF, organizados por semana.</span></div>
      ${btnNueva}
    </div>
    ${lista}`;
  if (esAdmin) $('btnNueva').addEventListener('click', nuevaSemana);
}

async function renombrarCarpeta(nombre) {
  const nuevo = prompt('Nuevo nombre para la carpeta:', nombre);
  if (nuevo === null) return;                      // canceló
  if (!nuevo.trim() || nuevo.trim() === nombre) return;
  const { ok, data } = await postJSON('/api/documentos/' + encodeURIComponent(nombre), { nombre: nuevo.trim() }, 'PUT');
  if (!ok) { alert(data.error || 'No se pudo renombrar'); return; }
  renderCarpetas();
}

async function nuevaSemana() {
  const { ok, data } = await postJSON('/api/documentos', {});
  if (!ok) { alert(data.error || 'No se pudo crear la carpeta'); return; }
  abrirCarpeta(data.nombre);
}

async function borrarCarpeta(nombre) {
  if (!confirm(`¿Borrar "${nombre}" y todos sus archivos? Esta acción no se puede deshacer.`)) return;
  const r = await fetch('/api/documentos/' + encodeURIComponent(nombre), { method: 'DELETE' });
  if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'No se pudo borrar'); return; }
  renderCarpetas();
}

// ---------- Vista de archivos dentro de una carpeta ----------
async function abrirCarpeta(nombre) {
  carpetaActual = nombre;
  await renderArchivos();
}

async function renderArchivos() {
  const nombre = carpetaActual;
  const url = '/api/documentos/' + encodeURIComponent(nombre) + '/archivos';
  const archivos = await getJSON(url);

  let tabla = '';
  if (archivos.length) {
    tabla = '<table style="margin-top:1rem"><thead><tr><th>Archivo</th><th>Tamaño</th><th>Subido</th><th></th></tr></thead><tbody>';
    for (const a of archivos) {
      const dl = url + '/' + encodeURIComponent(a.nombre);
      tabla += `<tr>
        <td>${icono(a.nombre)} <strong>${esc(a.nombre)}</strong></td>
        <td>${fmtTamano(a.tamano)}</td>
        <td><span class="muted">${fmtFecha(a.modificado)}</span></td>
        <td><div class="acciones">
          <a class="btn-sm" style="background:#e0f2fe;text-decoration:none;color:var(--azul-osc)" href="${dl}">Descargar</a>
          ${esAdmin ? `<button class="btn-sm" style="background:#fee2e2;color:var(--rojo)" onclick="borrarArchivo('${esc(a.nombre)}')">Borrar</button>` : ''}
        </div></td>
      </tr>`;
    }
    tabla += '</tbody></table>';
  } else {
    tabla = '<div class="empty">Esta carpeta está vacía. Sube el primer archivo.</div>';
  }

  $('vista').innerHTML = `
    <div class="toolbar" style="justify-content:space-between">
      <div><button class="btn-inline sec" onclick="renderCarpetas()">← Carpetas</button></div>
      <h2 class="section" style="flex:1;text-align:center">📁 ${esc(nombre)}</h2>
    </div>
    <div class="card" style="max-width:620px">
      <label>Subir archivos (Word o PDF)</label>
      <input type="file" id="fileInput" accept=".pdf,.doc,.docx" multiple>
      <div class="msg" id="msg"></div>
      <button class="btn" id="btnSubir">⬆️ Subir</button>
    </div>
    ${tabla}`;

  $('btnSubir').addEventListener('click', subirArchivos);
}

async function subirArchivos() {
  const input = $('fileInput');
  if (!input.files.length) { mostrarMsg('msg', 'Elige al menos un archivo.', 'error'); return; }

  const fd = new FormData();
  for (const f of input.files) fd.append('archivos', f);

  const btn = $('btnSubir');
  btn.disabled = true; btn.textContent = 'Subiendo…';
  try {
    const r = await fetch('/api/documentos/' + encodeURIComponent(carpetaActual) + '/archivos', {
      method: 'POST', body: fd
    });
    const data = await r.json();
    if (!r.ok) { mostrarMsg('msg', data.error || 'No se pudo subir', 'error'); return; }
    mostrarMsg('msg', `Subido${data.subidos.length === 1 ? '' : 's'}: ${data.subidos.length} archivo(s).`, 'ok');
    await renderArchivos();
  } catch {
    mostrarMsg('msg', 'Error de conexión al subir.', 'error');
  } finally {
    btn.disabled = false; btn.textContent = '⬆️ Subir';
  }
}

async function borrarArchivo(nombre) {
  if (!confirm(`¿Borrar "${nombre}"?`)) return;
  const r = await fetch('/api/documentos/' + encodeURIComponent(carpetaActual) + '/archivos/' + encodeURIComponent(nombre), { method: 'DELETE' });
  if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'No se pudo borrar'); return; }
  renderArchivos();
}

// ---------- Arranque ----------
(async () => {
  const usuario = await cargarUsuario();
  esAdmin = !!usuario && usuario.rol === 'admin';
  renderCarpetas();
})();
