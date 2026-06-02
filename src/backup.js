// Respaldo de la base de datos de inventario.
//
//   - Manual:      npm run backup     (o doble clic en respaldar.bat)
//   - Automático:  el servidor crea un respaldo al iniciar, máximo uno por día.
//
// Usa la API .backup() de better-sqlite3, que hace una copia CONSISTENTE de la
// base aunque el servidor esté encendido (no es un simple copiar-pegar del archivo,
// que con WAL podría quedar incompleto). Las copias quedan en data/backups/.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const RETENER = 30;   // cuántos respaldos conservar (se borran los más antiguos)

const dataDir = path.join(__dirname, '..', 'data');
const dbFile = path.join(dataDir, 'inventario.db');
const backupDir = path.join(dataDir, 'backups');

// Sello de tiempo para el nombre: 2026-06-02_153012
function sello() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// ¿Ya existe un respaldo de hoy? (para el respaldo automático diario)
function huboBackupHoy() {
  if (!fs.existsSync(backupDir)) return false;
  const hoy = sello().slice(0, 10);   // YYYY-MM-DD
  return fs.readdirSync(backupDir).some(f => f.startsWith('inventario-' + hoy));
}

// Crea un respaldo fechado y aplica la retención. Devuelve la ruta creada.
async function hacerBackup() {
  if (!fs.existsSync(dbFile)) {
    console.error('No se encontró la base de datos en ' + dbFile);
    return null;
  }
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  const destino = path.join(backupDir, `inventario-${sello()}.db`);
  const db = new Database(dbFile, { readonly: true });
  try {
    await db.backup(destino);
  } finally {
    db.close();
  }

  // Retención: conservar solo los RETENER más recientes.
  const copias = fs.readdirSync(backupDir)
    .filter(f => /^inventario-.*\.db$/.test(f))
    .map(f => ({ f, t: fs.statSync(path.join(backupDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  let borrados = 0;
  for (const c of copias.slice(RETENER)) { fs.unlinkSync(path.join(backupDir, c.f)); borrados++; }

  const kb = Math.round(fs.statSync(destino).size / 1024);
  console.log(`✔ Respaldo creado: ${path.relative(path.join(__dirname, '..'), destino)} (${kb} KB)`);
  console.log(`  Se conservan los ${RETENER} respaldos más recientes${borrados ? ` (se borraron ${borrados} antiguos)` : ''}.`);
  return destino;
}

// Respaldo automático: solo si aún no hay uno de hoy. No interrumpe el arranque.
async function backupDiario() {
  try {
    if (huboBackupHoy()) return;
    await hacerBackup();
  } catch (e) {
    console.error('Aviso: no se pudo crear el respaldo automático:', e.message);
  }
}

module.exports = { hacerBackup, backupDiario };

// Ejecutado directamente (npm run backup): hace un respaldo y termina.
if (require.main === module) {
  hacerBackup().catch(e => { console.error('Error al respaldar:', e.message); process.exit(1); });
}
