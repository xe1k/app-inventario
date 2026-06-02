// Arqueo / cierre de turno: contar físicamente la bodega y dejar registrado
// el descuadre (lo contado vs. lo esperado). Cerrar NO ajusta el stock.
let arqueoId = null;     // arqueo abierto en curso

// Etiqueta visual de la diferencia (contado - sistema).
function difHtml(dif, unidad) {
  if (dif === 0) return '<span style="color:var(--verde);font-weight:700">✔ cuadra</span>';
  if (dif < 0) return `<span class="stock-bajo">faltan ${formatNum(-dif)} ${esc(unidad)}</span>`;
  return `<span style="color:var(--naranjo);font-weight:700">sobran ${formatNum(dif)} ${esc(unidad)}</span>`;
}

function resumenHtml(r) {
  return `<div class="card" style="margin-top:0">
    <strong>${r.contados}</strong> items contados ·
    <span class="${r.descuadrados > 0 ? 'stock-bajo' : ''}"><strong>${r.descuadrados}</strong> con descuadre</span>
    ${r.faltante > 0 ? ` · faltante total <strong class="stock-bajo">${formatNum(r.faltante)}</strong>` : ''}
    ${r.sobrante > 0 ? ` · sobrante total <strong style="color:var(--naranjo)">${formatNum(r.sobrante)}</strong>` : ''}
  </div>`;
}

// ---------- Vista inicial: sin arqueo abierto ----------
async function renderInicio() {
  arqueoId = null;
  const arqueos = await getJSON('/api/arqueos');
  let hist = '';
  if (arqueos.length) {
    hist = '<table><thead><tr><th>#</th><th>Bodeguero</th><th>Turno</th><th>Estado</th><th>Abierto</th><th>Descuadres</th><th></th></tr></thead><tbody>';
    for (const a of arqueos) {
      const estado = a.estado === 'abierto'
        ? '<span class="badge ret">Abierto</span>'
        : '<span class="badge con">Cerrado</span>';
      const desc = a.descuadrados > 0
        ? `<span class="stock-bajo">${a.descuadrados}</span> de ${a.contados}`
        : (a.contados ? `0 de ${a.contados}` : '—');
      hist += `<tr>
        <td><strong>#${a.id}</strong></td>
        <td>${esc(a.usuario)}</td>
        <td>${esc(a.turno || '—')}</td>
        <td>${estado}</td>
        <td><span class="muted">${esc(a.abierto_en)}</span></td>
        <td>${desc}</td>
        <td><button class="btn-sm" style="background:#e0f2fe" onclick="verDetalle(${a.id})">Ver</button></td>
      </tr>`;
    }
    hist += '</tbody></table>';
  } else {
    hist = '<div class="empty">Aún no se ha hecho ningún arqueo.</div>';
  }

  $('vista').innerHTML = `
    <div class="card" style="max-width:620px">
      <h2 class="section">Iniciar arqueo de turno</h2>
      <p class="muted">Cuenta físicamente la bodega antes de entregar el turno. El sistema compara lo
      contado con lo esperado y deja registrado el descuadre. <strong>Cerrar el arqueo no modifica el stock</strong>:
      queda como evidencia para revisión.</p>
      <button class="btn" id="btnIniciar" style="max-width:260px">🧮 Iniciar arqueo</button>
    </div>
    <h2 class="section" style="margin-top:1.5rem">Arqueos anteriores</h2>
    <div style="margin-top:.6rem">${hist}</div>`;
  $('btnIniciar').addEventListener('click', iniciar);
}

async function iniciar() {
  const { ok, data } = await postJSON('/api/arqueos', {});
  if (!ok) {
    // Ya había uno abierto: lo retomamos.
    if (data.id) { arqueoId = data.id; return renderConteo(); }
    alert(data.error || 'No se pudo iniciar el arqueo'); return;
  }
  arqueoId = data.id;
  renderConteo();
}

// ---------- Vista de conteo: arqueo abierto ----------
async function renderConteo() {
  const { arqueo, items, resumen } = await getJSON('/api/arqueos/' + arqueoId + '/hoja');
  arqueoId = arqueo.id;

  let filas = '';
  for (const it of items) {
    const contadoVal = it.stock_contado != null ? formatNum(it.stock_contado) : '';
    const difCell = it.stock_contado != null ? difHtml(it.diferencia, it.unidad) : '<span class="muted">sin contar</span>';
    const badge = it.tipo === 'retornable' ? '<span class="badge ret">Ret</span>' : '<span class="badge con">Con</span>';
    filas += `<tr data-item="${it.id}" data-unidad="${esc(it.unidad)}">
      <td><strong>${esc(it.codigo)}</strong> ${badge}<br><span class="muted">${esc(it.nombre)}${it.ubicacion ? ' · ' + esc(it.ubicacion) : ''}</span></td>
      <td style="text-align:right">${formatNum(it.stock_sistema)} ${esc(it.unidad)}</td>
      <td style="width:120px"><input type="number" step="any" min="0" class="conteo" value="${contadoVal}" placeholder="contar…"></td>
      <td class="dif">${difCell}</td>
    </tr>`;
  }

  $('vista').innerHTML = `
    <div class="toolbar" style="justify-content:space-between">
      <div><h2 class="section">Arqueo #${arqueo.id} en curso</h2>
        <span class="muted">Escribe lo que cuentas en cada item. Se guarda solo al salir del campo.</span></div>
      <button class="btn-inline danger" id="btnDescartar">Descartar</button>
    </div>
    <div id="resumen">${resumenHtml(resumen)}</div>
    <table style="margin-top:1rem"><thead><tr>
      <th>Item</th><th style="text-align:right">Sistema</th><th>Contado</th><th>Diferencia</th>
    </tr></thead><tbody id="filas">${filas}</tbody></table>
    <div class="card" style="max-width:620px">
      <label>Observación del cierre (opcional)</label>
      <textarea id="obs" rows="2" placeholder="Notas del turno, motivo de un descuadre…"></textarea>
      <div class="msg" id="msg"></div>
      <button class="btn" id="btnCerrar">✅ Cerrar arqueo</button>
    </div>`;

  $('filas').querySelectorAll('input.conteo').forEach(inp => inp.addEventListener('change', guardarConteo));
  $('btnCerrar').addEventListener('click', cerrar);
  $('btnDescartar').addEventListener('click', descartar);
}

async function guardarConteo(e) {
  const tr = e.target.closest('tr');
  const itemId = tr.dataset.item;
  const unidad = tr.dataset.unidad;
  const val = e.target.value.trim();

  if (val === '') {
    // Campo vaciado: quitar el conteo de este item.
    const r = await fetch('/api/arqueos/' + arqueoId + '/contar/' + itemId, { method: 'DELETE' });
    const data = await r.json();
    tr.querySelector('.dif').innerHTML = '<span class="muted">sin contar</span>';
    if (data.resumen) $('resumen').innerHTML = resumenHtml(data.resumen);
    return;
  }
  const { ok, data } = await postJSON('/api/arqueos/' + arqueoId + '/contar', {
    item_id: Number(itemId), stock_contado: Number(val)
  });
  if (!ok) { alert(data.error || 'No se pudo guardar el conteo'); return; }
  tr.querySelector('.dif').innerHTML = difHtml(data.detalle.diferencia, unidad);
  $('resumen').innerHTML = resumenHtml(data.resumen);
}

async function cerrar() {
  if (!confirm('¿Cerrar el arqueo? Quedará registrado y no podrás seguir contando en él.')) return;
  const { ok, data } = await postJSON('/api/arqueos/' + arqueoId + '/cerrar', { observacion: $('obs').value.trim() });
  if (!ok) { mostrarMsg('msg', data.error || 'No se pudo cerrar', 'error'); return; }
  const r = data.resumen;
  alert(`Arqueo #${arqueoId} cerrado.\n${r.contados} items contados, ${r.descuadrados} con descuadre.` +
    (r.faltante > 0 ? `\nFaltante total: ${formatNum(r.faltante)}` : '') +
    (r.sobrante > 0 ? `\nSobrante total: ${formatNum(r.sobrante)}` : ''));
  renderInicio();
}

async function descartar() {
  if (!confirm('¿Descartar este arqueo sin cerrarlo? Se borrarán los conteos ingresados.')) return;
  await fetch('/api/arqueos/' + arqueoId, { method: 'DELETE' });
  renderInicio();
}

// ---------- Ver detalle de un arqueo (modal) ----------
async function verDetalle(id) {
  const { arqueo, detalle, resumen } = await getJSON('/api/arqueos/' + id);
  $('detTitulo').textContent = `Arqueo #${arqueo.id} · ${arqueo.estado}`;
  let cuerpo = `<p class="muted">Bodeguero: ${esc(arqueo.usuario || '—')}${arqueo.turno ? ' · turno ' + esc(arqueo.turno) : ''}<br>
    Abierto: ${esc(arqueo.abierto_en)}${arqueo.cerrado_en ? ' · Cerrado: ' + esc(arqueo.cerrado_en) : ''}</p>`;
  cuerpo += resumenHtml(resumen);
  if (arqueo.observacion) cuerpo += `<p class="muted" style="margin:.5rem 0">📝 ${esc(arqueo.observacion)}</p>`;

  if (detalle.length) {
    cuerpo += '<table style="margin-top:.6rem"><thead><tr><th>Item</th><th>Sistema</th><th>Contado</th><th>Dif.</th></tr></thead><tbody>';
    for (const d of detalle) {
      cuerpo += `<tr>
        <td><strong>${esc(d.codigo)}</strong><br><span class="muted">${esc(d.nombre)}</span></td>
        <td>${formatNum(d.stock_sistema)}</td>
        <td>${formatNum(d.stock_contado)}</td>
        <td>${difHtml(d.diferencia, d.unidad)}</td>
      </tr>`;
    }
    cuerpo += '</tbody></table>';
  } else {
    cuerpo += '<div class="empty">Sin items contados.</div>';
  }
  $('detCuerpo').innerHTML = cuerpo;
  $('modalDetalle').classList.add('open');
}

$('btnCerrarDet').addEventListener('click', () => $('modalDetalle').classList.remove('open'));
$('modalDetalle').addEventListener('click', (e) => { if (e.target === $('modalDetalle')) $('modalDetalle').classList.remove('open'); });

// ---------- Arranque ----------
(async () => {
  await cargarUsuario();
  const { arqueo } = await getJSON('/api/arqueos/abierto');
  if (arqueo) { arqueoId = arqueo.id; renderConteo(); }
  else renderInicio();
})();
