let signaturePad = null;
let entregaIdFirma = null;

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
      ? '<span style="color:var(--verde);font-weight:700" title="Firma guardada">✔ Firmada</span>'
      : '<span style="color:#94a3b8">— Sin firma</span>';

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
            onclick="abrirFirma('${esc(r.entrega_id)}', '${esc(r.trabajador || '')}')">✍️ Firma</button>
        </div>
      </td>
    </tr>`;
  }

  lista.innerHTML = html + '</tbody></table>';
}

function reimprimir(entregaId) {
  window.open('/api/movimientos/entrega/' + encodeURIComponent(entregaId) + '/comprobante', '_blank');
}

// ── Overlay de firma digital ──
function abrirFirma(entregaId, trabajadorNombre) {
  entregaIdFirma = entregaId;
  $('firmaOverlaySubtitulo').textContent = `Entrega #${entregaId} · ${trabajadorNombre}`;
  $('firmaSalidaMsg').className = 'msg';
  $('firmaCanvasHint').style.display = '';
  $('btnConfirmarFirma').disabled = true;
  $('firmaOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';

  requestAnimationFrame(() => {
    const canvas = $('firmaCanvas');
    const wrap = $('firmaCanvasWrap');
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = wrap.clientWidth * ratio;
    canvas.height = wrap.clientHeight * ratio;
    canvas.getContext('2d').scale(ratio, ratio);
    if (signaturePad) signaturePad.off();
    signaturePad = new SignaturePad(canvas, {
      backgroundColor: 'rgb(255,255,255)',
      penColor: 'rgb(15,23,42)',
      minWidth: 1,
      maxWidth: 3
    });
    signaturePad.addEventListener('beginStroke', () => {
      $('firmaCanvasHint').style.display = 'none';
      $('btnConfirmarFirma').disabled = false;
    });
  });
}

function cerrarFirmaOverlay() {
  $('firmaOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

$('btnLimpiarFirma').addEventListener('click', () => {
  if (signaturePad) signaturePad.clear();
  $('firmaCanvasHint').style.display = '';
  $('firmaSalidaMsg').className = 'msg';
  $('btnConfirmarFirma').disabled = true;
});

$('btnOmitirFirma').addEventListener('click', cerrarFirmaOverlay);

$('btnConfirmarFirma').addEventListener('click', async () => {
  $('btnConfirmarFirma').disabled = true;
  mostrarMsg('firmaSalidaMsg', 'Guardando firma…', 'ok');
  const r = await fetch('/api/movimientos/entrega/' + encodeURIComponent(entregaIdFirma) + '/firma-digital', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firma: signaturePad.toDataURL('image/png') })
  });
  $('btnConfirmarFirma').disabled = false;
  const data = await r.json();
  if (!r.ok) { mostrarMsg('firmaSalidaMsg', data.error || 'No se pudo guardar la firma', 'error'); return; }
  cerrarFirmaOverlay();
  cargar();
});

$('btnBuscar').addEventListener('click', cargar);
$('fQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') cargar(); });

(async () => {
  await cargarUsuario();
  cargar();
})();
