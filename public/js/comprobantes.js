let entregaActiva = null;

async function cargar() {
  const params = new URLSearchParams();
  const q = $('fQ').value.trim();
  const desde = $('fDesde').value;
  const hasta = $('fHasta').value;
  if (q)     params.set('q', q);
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);

  const lista = $('lista');
  lista.innerHTML = '<div class="muted">Cargando…</div>';

  const rows = await getJSON('/api/movimientos/entregas?' + params);

  if (!rows.length) {
    lista.innerHTML = '<div class="empty">Sin entregas para esos filtros.</div>';
    return;
  }

  let html = `<table>
    <thead>
      <tr>
        <th>N°</th><th>Fecha</th><th>Trabajador</th><th>Área</th>
        <th style="text-align:center">Items</th>
        <th style="text-align:center">Firma</th>
        <th></th>
      </tr>
    </thead><tbody>`;

  for (const r of rows) {
    const firmaTag = r.tiene_firma
      ? '<span style="color:var(--verde);font-weight:700" title="Foto subida">✔ Adjunta</span>'
      : '<span style="color:#94a3b8">— Sin foto</span>';

    const retBadge = r.retornables > 0
      ? `<span class="badge ret" style="font-size:.7rem">${r.retornables} ret.</span> ` : '';

    html += `<tr>
      <td><strong>#${esc(r.entrega_id)}</strong></td>
      <td><span class="muted">${esc(r.fecha)}</span></td>
      <td>${esc(r.trabajador || '—')}${r.cargo ? '<br><span class="muted">' + esc(r.cargo) + '</span>' : ''}</td>
      <td><span class="muted">${esc(r.area || '—')}</span></td>
      <td style="text-align:center">${retBadge}${r.total_items}</td>
      <td style="text-align:center">${firmaTag}</td>
      <td>
        <div class="acciones">
          <button class="btn-sm" style="background:#dbeafe;color:#1e3a8a"
            onclick="reimprimir('${esc(r.entrega_id)}')">🖨️ Reimprimir</button>
          <button class="btn-sm" style="background:#f0fdf4;color:var(--verde)"
            onclick="abrirFirma('${esc(r.entrega_id)}', '${esc(r.trabajador || '')}')">📷 Firma</button>
        </div>
      </td>
    </tr>`;
  }

  lista.innerHTML = html + '</tbody></table>';
}

function reimprimir(entregaId) {
  window.open('/api/movimientos/entrega/' + encodeURIComponent(entregaId) + '/comprobante', '_blank');
}

// ---------- Modal de firma ----------
function abrirFirma(entregaId, trabajador) {
  entregaActiva = entregaId;
  $('firmaSubtitulo').textContent = `Entrega #${entregaId} · ${trabajador || '—'}`;
  $('firmaMsg').className = 'msg';
  $('firmaArchivo').value = '';

  // Intentar mostrar la foto existente.
  const preview = $('firmaPreview');
  const img = document.createElement('img');
  img.src = '/api/movimientos/entrega/' + encodeURIComponent(entregaId) + '/firma?t=' + Date.now();
  img.style.cssText = 'max-width:100%;max-height:300px;border-radius:6px;border:1px solid #e2e8f0';
  img.onerror = () => { preview.innerHTML = '<p class="muted">Aún no hay foto adjunta para esta entrega.</p>'; };
  preview.innerHTML = '';
  preview.appendChild(img);

  $('modalFirma').classList.add('open');
}

function cerrarModal() {
  $('modalFirma').classList.remove('open');
  entregaActiva = null;
}

$('btnSubirFirma').addEventListener('click', async () => {
  if (!entregaActiva) return;
  const archivo = $('firmaArchivo').files[0];
  if (!archivo) { mostrarMsg('firmaMsg', 'Elige una imagen primero', 'error'); return; }

  const form = new FormData();
  form.append('firma', archivo);

  mostrarMsg('firmaMsg', 'Subiendo…', '');
  const r = await fetch('/api/movimientos/entrega/' + encodeURIComponent(entregaActiva) + '/firma', {
    method: 'POST', body: form
  });
  const data = await r.json();
  if (!r.ok) { mostrarMsg('firmaMsg', data.error || 'No se pudo subir', 'error'); return; }

  mostrarMsg('firmaMsg', '✔ Foto guardada correctamente', 'ok');
  // Actualizar preview con la nueva foto.
  abrirFirma(entregaActiva, $('firmaSubtitulo').textContent.split(' · ')[1]);
  // Refrescar tabla para actualizar el indicador de firma.
  cargar();
});

// Cerrar modal al hacer clic fuera.
$('modalFirma').addEventListener('click', (e) => { if (e.target === $('modalFirma')) cerrarModal(); });

$('btnBuscar').addEventListener('click', cargar);
$('fQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') cargar(); });

(async () => {
  await cargarUsuario();
  cargar();
})();
