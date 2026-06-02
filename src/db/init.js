// Inicializa el esquema y crea el usuario administrador por defecto.
// Ejecutar con: npm run init-db
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./index');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Migraciones: agregar columnas nuevas a tablas que ya existían (CREATE TABLE
// IF NOT EXISTS no las añade). Solo agrega la columna si aún no está.
function agregarColumna(tabla, columna, definicion) {
  const cols = db.prepare(`PRAGMA table_info(${tabla})`).all();
  if (!cols.some(c => c.name === columna)) {
    db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
    console.log(`Migración: ${tabla}.${columna} agregada.`);
  }
}
// M7: campos de revisión del descuadre.
agregarColumna('arqueo_detalle', 'revisado', 'INTEGER NOT NULL DEFAULT 0');
agregarColumna('arqueo_detalle', 'revisado_por', 'INTEGER REFERENCES usuarios(id)');
agregarColumna('arqueo_detalle', 'revisado_en', 'TEXT');
agregarColumna('arqueo_detalle', 'revision_nota', 'TEXT');
agregarColumna('arqueo_detalle', 'ajuste_mov_id', 'INTEGER REFERENCES movimientos(id)');

// Cambios posteriores:
agregarColumna('usuarios', 'password_plain', 'TEXT');   // clave visible para el admin
agregarColumna('trabajadores', 'cargo', 'TEXT');        // cargo/puesto del trabajador
agregarColumna('movimientos', 'estado', 'TEXT');        // estado del equipo en la devolución
agregarColumna('items', 'stock_reparacion', 'REAL NOT NULL DEFAULT 0');  // unidades fuera de servicio (dañadas + en reparación)
agregarColumna('items', 'stock_en_reparacion', 'REAL NOT NULL DEFAULT 0');  // subconjunto que ya está EN reparación
agregarColumna('movimientos', 'entrega_id', 'TEXT');    // agrupa varias salidas de una misma entrega

// Crear admin por defecto solo si no existe ningún usuario.
const total = db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n;
if (total === 0) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare(
    `INSERT INTO usuarios (username, nombre, password_hash, rol) VALUES (?,?,?,?)`
  ).run('admin', 'Administrador', hash, 'admin');
  console.log('Usuario administrador creado -> usuario: admin  /  clave: admin123');
  console.log('IMPORTANTE: cambia esta clave después del primer ingreso.');
} else {
  console.log('La base ya tenía usuarios, no se creó el admin por defecto.');
}

console.log('Base de datos lista.');
db.close();
