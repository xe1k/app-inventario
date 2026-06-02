// Escáner de cámara reutilizable (QR y código de barras).
// Uso:  Escaner.abrir({ titulo, onCodigo })  -> abre un modal, lee un código
//       con la cámara y llama onCodigo(texto). Se cierra solo tras leer.
// Requiere: /vendor/html5-qrcode.min.js cargado antes que este archivo.
const Escaner = (function () {
  let lector = null;        // instancia de Html5Qrcode
  let camaras = [];         // cámaras disponibles
  let camActual = 0;        // índice de la cámara en uso
  let onCodigo = null;      // callback al leer un código
  let leyendo = false;      // evita callbacks dobles tras una lectura

  // Crea (una sola vez) el modal y lo deja en el DOM oculto.
  function asegurarModal() {
    if (document.getElementById('escanerModal')) return;
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.id = 'escanerModal';
    bg.innerHTML = `
      <div class="modal escaner-modal">
        <h3 id="escanerTitulo">Escanear código</h3>
        <p class="muted">Apunta la cámara al QR o código de barras del item.</p>
        <div id="escanerRegion" class="escaner-region"></div>
        <div class="msg" id="escanerMsg"></div>
        <div class="row" style="margin-top:1rem">
          <button type="button" class="btn-inline sec" id="escanerCambiar" style="flex:1">🔄 Cambiar cámara</button>
          <button type="button" class="btn-inline sec" id="escanerCerrar" style="flex:1">Cerrar</button>
        </div>
      </div>`;
    document.body.appendChild(bg);
    document.getElementById('escanerCerrar').addEventListener('click', cerrar);
    document.getElementById('escanerCambiar').addEventListener('click', cambiarCamara);
    bg.addEventListener('click', (e) => { if (e.target === bg) cerrar(); });
  }

  function msg(texto, tipo = 'error') {
    const el = document.getElementById('escanerMsg');
    el.textContent = texto;
    el.className = 'msg ' + (texto ? tipo : '');
  }

  async function abrir(opts = {}) {
    asegurarModal();
    onCodigo = opts.onCodigo || null;
    leyendo = false;
    msg('');
    document.getElementById('escanerTitulo').textContent = opts.titulo || 'Escanear código';
    document.getElementById('escanerModal').classList.add('open');

    if (typeof Html5Qrcode === 'undefined') {
      msg('No se pudo cargar el lector de cámara.');
      return;
    }
    lector = new Html5Qrcode('escanerRegion', { verbose: false });
    try {
      camaras = await Html5Qrcode.getCameras();
    } catch {
      msg('No se pudo acceder a la cámara. Revisa los permisos del navegador.');
      return;
    }
    if (!camaras.length) { msg('No se encontró ninguna cámara en este dispositivo.'); return; }
    // Preferir la cámara trasera (suele tener "back"/"rear"/"trasera" en el nombre).
    const trasera = camaras.findIndex(c => /back|rear|trasera|environment/i.test(c.label));
    camActual = trasera >= 0 ? trasera : 0;
    document.getElementById('escanerCambiar').style.display = camaras.length > 1 ? '' : 'none';
    await iniciar();
  }

  async function iniciar() {
    if (!lector || !camaras.length) return;
    const config = { fps: 10, qrbox: { width: 250, height: 250 } };
    try {
      await lector.start(camaras[camActual].id, config, onLectura, () => {});
    } catch {
      msg('No se pudo iniciar la cámara seleccionada.');
    }
  }

  function onLectura(texto) {
    if (leyendo) return;             // ya leímos un código en esta sesión
    leyendo = true;
    const cb = onCodigo;
    cerrar().then(() => { if (cb) cb(texto.trim()); });
  }

  async function cambiarCamara() {
    if (camaras.length < 2) return;
    msg('');
    camActual = (camActual + 1) % camaras.length;
    try { await detener(); } catch {}
    await iniciar();
  }

  async function detener() {
    if (!lector) return;
    try {
      if (lector.isScanning) await lector.stop();
      lector.clear();
    } catch {}
  }

  async function cerrar() {
    await detener();
    lector = null;
    const bg = document.getElementById('escanerModal');
    if (bg) bg.classList.remove('open');
  }

  return { abrir };
})();
