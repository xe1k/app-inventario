let signaturePad = null;

async function cargarEstado() {
  const cont = $('estadoFirma');
  const r = await fetch('/api/auth/mi-firma');
  if (r.ok) {
    const url = '/api/auth/mi-firma?t=' + Date.now();
    cont.innerHTML = `
      <p class="muted" style="margin-bottom:.6rem">Firma guardada:</p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:.8rem;display:inline-block">
        <img src="${url}" style="max-width:280px;max-height:100px;display:block">
      </div>`;
    $('btnEliminar').style.display = '';
  } else {
    cont.innerHTML = '<p class="muted">Aún no tienes una firma guardada.</p>';
    $('btnEliminar').style.display = 'none';
  }
}

// ── Overlay ──
function abrirOverlay() {
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

function cerrarOverlay() {
  $('firmaOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

$('btnCapturar').addEventListener('click', abrirOverlay);

$('btnLimpiarFirma').addEventListener('click', () => {
  if (signaturePad) signaturePad.clear();
  $('firmaCanvasHint').style.display = '';
  $('firmaSalidaMsg').className = 'msg';
  $('btnConfirmarFirma').disabled = true;
});

$('btnOmitirFirma').addEventListener('click', cerrarOverlay);

$('btnConfirmarFirma').addEventListener('click', async () => {
  $('btnConfirmarFirma').disabled = true;
  mostrarMsg('firmaSalidaMsg', 'Guardando…', 'ok');
  const r = await fetch('/api/auth/mi-firma', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firma: signaturePad.toDataURL('image/png') })
  });
  $('btnConfirmarFirma').disabled = false;
  const data = await r.json();
  if (!r.ok) { mostrarMsg('firmaSalidaMsg', data.error || 'No se pudo guardar', 'error'); return; }
  cerrarOverlay();
  cargarEstado();
});

$('btnEliminar').addEventListener('click', async () => {
  if (!confirm('¿Eliminar tu firma guardada?')) return;
  await fetch('/api/auth/mi-firma', { method: 'DELETE' });
  cargarEstado();
});

(async () => {
  await cargarUsuario();
  cargarEstado();
})();
