// Registrar entrada (ingreso de stock).
let recargarItems;

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    item_id: Number($('item').value),
    cantidad: Number($('cantidad').value),
    motivo: $('motivo').value.trim(),
    observacion: $('observacion').value.trim()
  };
  if (!body.item_id) { mostrarMsg('msg', 'Elige un item', 'error'); return; }

  const { ok, data } = await postJSON('/api/movimientos/entrada', body);
  if (!ok) { mostrarMsg('msg', data.error || 'No se pudo registrar', 'error'); return; }

  mostrarMsg('msg', `✔ Entrada registrada. Stock actual: ${formatNum(data.stock)}`, 'ok');
  $('form').reset();
  recargarItems();
});

(async () => {
  await cargarUsuario();
  recargarItems = montarSelectorItems($('buscar'), $('item'));
})();
