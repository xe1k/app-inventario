// Cierre de modales con la "X" y con la tecla ESC (NO al hacer clic fuera).
// Antes, soltar el mouse fuera del recuadro al seleccionar texto cerraba el modal;
// esto lo evita. Es un script autónomo (sin variables globales) para poder
// incluirlo en cualquier página sin chocar con sus propios helpers.
(function () {
  // ESC cierra el modal abierto (salvo el del escáner, que se administra solo
  // porque además debe apagar la cámara).
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.modal-bg.open').forEach(function (bg) {
      if (bg.id === 'escanerModal') return;
      bg.classList.remove('open');
    });
  });

  // Cualquier elemento con [data-cerrar-modal] cierra el modal que lo contiene.
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-cerrar-modal]');
    if (!btn) return;
    var bg = btn.closest('.modal-bg');
    if (bg) bg.classList.remove('open');
  });
})();
