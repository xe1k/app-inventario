// Registrar una entrega: varios items a un mismo trabajador, un solo comprobante.
let recargarItems;
let carrito = [];   // [{ item_id, codigo, nombre, tipo, unidad, cantidad, stock }]
let signaturePad = null;
let entregaIdFirma = null;
let urlComprobanteActual = null;

async function cargarTrabajadores(seleccionar) {
  const lista = await getJSON('/api/trabajadores');
  $('trabajador').innerHTML = '<option value="">— elige —</option>' +
    lista.map(t => `<option value="${t.id}">${esc(t.nombre)}${t.cargo ? ' · ' + esc(t.cargo) : ''}</option>`).join('');
  if (seleccionar) $('trabajador').value = seleccionar;
}

// Aviso según el tipo de item elegido.
$('item').addEventListener('change', () => {
  const opt = $('item').selectedOptions[0];
  if (!opt || !opt.value) { $('aviso').textContent = ''; return; }
  const tipo = opt.dataset.tipo;
  const stock = opt.dataset.stock;
  const ubicacion = opt.dataset.ubicacion;
  const areaTexto = ubicacion ? ` &nbsp;·&nbsp; 📍 <strong>${esc(ubicacion)}</strong>` : '';
  $('aviso').innerHTML = (tipo === 'retornable'
    ? `🔁 <strong>Retornable</strong>: quedará como préstamo abierto. Disponible: ${stock}`
    : `📦 <strong>Consumible</strong>: se descuenta del stock. Disponible: ${stock}`) + areaTexto;
});

// Alta rápida de trabajador sin salir de la pantalla.
$('btnNuevoTrab').addEventListener('click', async () => {
  const nombre = prompt('Nombre del trabajador:');
  if (!nombre || !nombre.trim()) return;
  const { ok, data } = await postJSON('/api/trabajadores', { nombre: nombre.trim() });
  if (!ok) { alert(data.error || 'No se pudo crear'); return; }
  await cargarTrabajadores(data.id);
});

// Escanear el código del item y dejarlo seleccionado en el <select>.
$('btnEscanear').addEventListener('click', () => {
  Escaner.abrir({
    titulo: 'Escanear item a entregar',
    onCodigo: async (codigo) => {
      const item = await itemPorCodigo(codigo);
      if (!item) return;
      $('buscar').value = item.codigo;
      await recargarItems();
      $('item').value = String(item.id);
      $('item').dispatchEvent(new Event('change'));
      $('cantidad').focus();
    }
  });
});

// ---------- Carrito ----------
$('btnAgregar').addEventListener('click', () => {
  const opt = $('item').selectedOptions[0];
  if (!opt || !opt.value) { mostrarMsg('msg', 'Elige un item para agregar', 'error'); return; }
  const cantidad = Number($('cantidad').value);
  if (!(cantidad > 0)) { mostrarMsg('msg', 'Indica una cantidad válida', 'error'); return; }

  const id = Number(opt.value);
  const stock = Number(opt.dataset.stock);
  const ya = carrito.find(c => c.item_id === id);
  const total = (ya ? ya.cantidad : 0) + cantidad;

  // No se puede entregar más de lo que hay en bodega.
  if (total > stock) {
    mostrarMsg('msg', `No hay stock suficiente: pediste ${formatNum(total)} pero solo hay ${formatNum(stock)} ${opt.dataset.unidad}. Si igual lo necesitan, regístralo en “Solicitudes”.`, 'error');
    return;
  }

  if (ya) {
    ya.cantidad = total;
  } else {
    carrito.push({
      item_id: id, codigo: opt.dataset.codigo, nombre: opt.dataset.nombre,
      tipo: opt.dataset.tipo, unidad: opt.dataset.unidad, ubicacion: opt.dataset.ubicacion || '',
      cantidad, stock
    });
  }
  $('msg').className = 'msg';
  $('cantidad').value = 1;
  $('buscar').value = '';
  recargarItems();
  $('item').value = '';
  $('aviso').textContent = '';
  renderCarrito();
});

function quitarItem(id) {
  carrito = carrito.filter(c => c.item_id !== id);
  renderCarrito();
}

function renderCarrito() {
  const cont = $('carrito');
  if (!carrito.length) {
    cont.innerHTML = '<div class="empty" style="padding:1rem">Aún no agregas items. Búscalo arriba y pulsa “Agregar a la lista”.</div>';
    return;
  }
  let html = '<table><thead><tr><th>Item</th><th>Cant.</th><th>Tipo</th><th></th></tr></thead><tbody>';
  for (const c of carrito) {
    const badge = c.tipo === 'retornable'
      ? '<span class="badge ret">Retornable</span>'
      : '<span class="badge con">Consumible</span>';
    const areaTag = c.ubicacion ? `<span class="muted"> · 📍 ${esc(c.ubicacion)}</span>` : '';
    html += `<tr>
      <td><strong>${esc(c.codigo)}</strong><br><span class="muted">${esc(c.nombre)}</span>${areaTag}</td>
      <td>${formatNum(c.cantidad)} ${esc(c.unidad)}</td>
      <td>${badge}</td>
      <td><button class="btn-sm" style="background:#fee2e2;color:var(--rojo)" onclick="quitarItem(${c.item_id})">Quitar</button></td>
    </tr>`;
  }
  cont.innerHTML = html + '</tbody></table>';
}

// ---------- Registrar la entrega completa ----------
$('btnRegistrar').addEventListener('click', async () => {
  const trabajador_id = Number($('trabajador').value);
  if (!trabajador_id) { mostrarMsg('msg', 'Indica a quién se entrega', 'error'); return; }
  if (!carrito.length) { mostrarMsg('msg', 'Agrega al menos un item a la lista', 'error'); return; }

  $('postAccion').innerHTML = '';
  const body = {
    trabajador_id,
    area: $('area').value.trim(),
    observacion: $('observacion').value.trim(),
    items: carrito.map(c => ({ item_id: c.item_id, cantidad: c.cantidad }))
  };
  const { ok, data } = await postJSON('/api/movimientos/salida-multiple', body);
  if (!ok) { mostrarMsg('msg', data.error || 'No se pudo registrar', 'error'); return; }

  let txt = `✔ Entrega N° ${data.entrega_id} registrada: ${data.total_items} item(s).`;
  if (data.hay_retornables) txt += ' Incluye retornables (préstamo abierto).';
  mostrarMsg('msg', txt, 'ok');

  // Capturar nombre del trabajador antes de limpiar el select.
  const trabajadorNombre = ($('trabajador').selectedOptions[0]?.text || '').split(' · ')[0];

  // Limpiar para la próxima entrega.
  carrito = [];
  renderCarrito();
  $('area').value = '';
  $('observacion').value = '';
  $('trabajador').value = '';
  recargarItems();

  abrirFirmaOverlay(data.entrega_id, trabajadorNombre);
});

// ── Firma digital ──
function abrirFirmaOverlay(entregaId, trabajadorNombre) {
  entregaIdFirma = entregaId;
  urlComprobanteActual = '/api/movimientos/entrega/' + entregaId + '/comprobante';
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
  $('postAccion').innerHTML = `<button type="button" class="btn-inline" id="btnComprobante">🖨️ Ver comprobante</button>`;
  $('btnComprobante').addEventListener('click', () => window.open(urlComprobanteActual, '_blank'));
}

$('btnLimpiarFirma').addEventListener('click', () => {
  if (signaturePad) signaturePad.clear();
  $('firmaCanvasHint').style.display = '';
  $('firmaSalidaMsg').className = 'msg';
  $('btnConfirmarFirma').disabled = true;
});

$('btnOmitirFirma').addEventListener('click', cerrarFirmaOverlay);

$('btnConfirmarFirma').addEventListener('click', async () => {
  if (!signaturePad || signaturePad.isEmpty()) {
    mostrarMsg('firmaSalidaMsg', 'El trabajador aún no ha firmado', 'error');
    return;
  }
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
  mostrarMsg('msg', `✔ Firma guardada. Entrega #${entregaIdFirma} lista.`, 'ok');
});

(async () => {
  await cargarUsuario();
  recargarItems = montarSelectorItems($('buscar'), $('item'));
  cargarTrabajadores();
  renderCarrito();
})();
