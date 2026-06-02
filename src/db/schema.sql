-- ============================================================
--  Esquema de la base de datos - App Inventario de Bodega
--  Objetivo central: TRAZABILIDAD de cada movimiento para
--  poder responsabilizar y detectar robos.
-- ============================================================

-- Usuarios que OPERAN la app (inician sesión)
CREATE TABLE IF NOT EXISTS usuarios (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  nombre        TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_plain TEXT,            -- clave en texto, visible SOLO para el admin (a pedido)
  rol           TEXT NOT NULL CHECK (rol IN ('admin','bodeguero')),
  turno         TEXT CHECK (turno IN ('dia','noche')),   -- aplica a bodegueros
  activo        INTEGER NOT NULL DEFAULT 1,
  creado_en     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Trabajadores que RETIRAN material (no necesariamente usan la app)
CREATE TABLE IF NOT EXISTS trabajadores (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre        TEXT NOT NULL,
  identificador TEXT,            -- RUT, n° de ficha, etc.
  area          TEXT,
  cargo         TEXT,            -- cargo/puesto del trabajador
  activo        INTEGER NOT NULL DEFAULT 1,
  creado_en     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Catálogo de items. Dos naturalezas:
--   retornable  -> equipo/herramienta que debe volver (máquina de soldar, esmeril...)
--   consumible  -> se gasta (disco de corte, varilla, EPP...)
CREATE TABLE IF NOT EXISTS items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo        TEXT NOT NULL UNIQUE,    -- código QR / código de barras
  nombre        TEXT NOT NULL,
  tipo          TEXT NOT NULL CHECK (tipo IN ('retornable','consumible')),
  categoria     TEXT,
  unidad        TEXT NOT NULL DEFAULT 'unidad',
  ubicacion     TEXT,
  stock         REAL NOT NULL DEFAULT 0, -- existencia DISPONIBLE en bodega
  stock_reparacion REAL NOT NULL DEFAULT 0, -- unidades fuera de servicio (dañadas + en reparación)
  stock_en_reparacion REAL NOT NULL DEFAULT 0, -- subconjunto de las anteriores que ya están EN reparación
  stock_minimo  REAL NOT NULL DEFAULT 0, -- umbral para alerta de stock bajo
  serie         TEXT,                    -- n° de serie para activos identificables
  activo        INTEGER NOT NULL DEFAULT 1,
  creado_en     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Movimientos: el corazón del sistema. Cada fila es inmutable (no se edita).
--   entrada     -> ingresa stock a bodega
--   salida      -> sale stock (préstamo si es retornable, consumo si es consumible)
--   devolucion  -> retorna un retornable prestado (apunta a la salida original)
--   ajuste      -> corrección de inventario (queda registrado quién y por qué)
CREATE TABLE IF NOT EXISTS movimientos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id        INTEGER NOT NULL REFERENCES items(id),
  tipo           TEXT NOT NULL CHECK (tipo IN ('entrada','salida','devolucion','ajuste')),
  cantidad       REAL NOT NULL,
  usuario_id     INTEGER NOT NULL REFERENCES usuarios(id),     -- bodeguero que REGISTRÓ
  trabajador_id  INTEGER REFERENCES trabajadores(id),          -- a quién se ENTREGÓ
  turno          TEXT,
  motivo         TEXT,
  observacion    TEXT,
  estado         TEXT,                                         -- condición del equipo en una devolución
  entrega_id     TEXT,                                         -- agrupa varias salidas de una misma entrega
  prestamo_ref   INTEGER REFERENCES movimientos(id),           -- devolución -> salida origen
  fecha          TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Bitácora de auditoría: registro imborrable de acciones sensibles.
CREATE TABLE IF NOT EXISTS auditoria (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id  INTEGER,
  accion      TEXT NOT NULL,
  detalle     TEXT,
  fecha       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Arqueos: conteo físico de bodega al cerrar/entregar un turno.
--   El bodeguero cuenta y el sistema guarda lo contado vs. lo esperado.
--   El cierre NO ajusta el stock: deja el descuadre registrado como evidencia
--   (separación de responsabilidades; quien cuenta no "cuadra los libros").
CREATE TABLE IF NOT EXISTS arqueos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id),  -- quién hace el arqueo
  turno       TEXT,                                       -- turno del bodeguero
  estado      TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','cerrado')),
  observacion TEXT,
  abierto_en  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  cerrado_en  TEXT
);

-- Detalle del arqueo: una fila por item contado.
-- Las columnas de revisión (revisado_*) las usa el M7 para gestionar el descuadre:
-- el admin lo marca revisado (con nota) y, si corresponde, aplica un ajuste de stock.
CREATE TABLE IF NOT EXISTS arqueo_detalle (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  arqueo_id     INTEGER NOT NULL REFERENCES arqueos(id) ON DELETE CASCADE,
  item_id       INTEGER NOT NULL REFERENCES items(id),
  stock_sistema REAL NOT NULL,   -- stock esperado al momento de contar
  stock_contado REAL NOT NULL,   -- lo que se contó físicamente
  diferencia    REAL NOT NULL,   -- contado - sistema (negativo = faltante)
  contado_en    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  revisado      INTEGER NOT NULL DEFAULT 0,   -- 1 = el admin ya lo gestionó
  revisado_por  INTEGER REFERENCES usuarios(id),
  revisado_en   TEXT,
  revision_nota TEXT,
  ajuste_mov_id INTEGER REFERENCES movimientos(id),   -- ajuste aplicado, si hubo
  UNIQUE (arqueo_id, item_id)
);

-- Faltantes: pedidos que NO se pudieron satisfacer en una entrega (se pidió más
-- de lo disponible). Queda registrado para el reporte de jefatura.
CREATE TABLE IF NOT EXISTS faltantes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id       INTEGER NOT NULL REFERENCES items(id),
  trabajador_id INTEGER REFERENCES trabajadores(id),
  usuario_id    INTEGER REFERENCES usuarios(id),
  entrega_id    TEXT,
  solicitado    REAL NOT NULL,
  entregado     REAL NOT NULL,
  faltante      REAL NOT NULL,
  fecha         TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Eventos de estado de equipos: enviar a reparación, daño en bodega, reparado, baja.
-- Registro estructurado (además de la auditoría) para poder reportar por período.
CREATE TABLE IF NOT EXISTS eventos_equipo (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id     INTEGER NOT NULL REFERENCES items(id),
  accion      TEXT NOT NULL,   -- enviar_reparacion | danar_disponible | reparado | baja
  origen      TEXT,            -- para baja: 'reparacion' | 'disponible'
  cantidad    REAL NOT NULL,
  usuario_id  INTEGER REFERENCES usuarios(id),
  fecha       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Solicitudes de los trabajadores: pedidos que se registran cuando alguien
-- pide algo (sobre todo si NO había en bodega). Ej: "Juanito pidió guantes y no había".
-- Sirve para saber qué reponer y qué falta, sin afectar el stock.
CREATE TABLE IF NOT EXISTS solicitudes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  solicitante   TEXT NOT NULL,             -- quién pidió (texto libre)
  trabajador_id INTEGER REFERENCES trabajadores(id),  -- opcional, si está registrado
  item_id       INTEGER REFERENCES items(id),         -- opcional, si existe en catálogo
  descripcion   TEXT NOT NULL,             -- qué pidió (ej: "guantes de cabritilla talla L")
  cantidad      REAL,                      -- cuánto pidió (opcional)
  motivo        TEXT,                      -- por qué no se entregó (ej: sin stock)
  estado        TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','resuelta')),
  nota          TEXT,                      -- comentario / cómo se resolvió
  usuario_id    INTEGER REFERENCES usuarios(id),       -- quién la registró
  fecha         TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  resuelta_en   TEXT
);

CREATE INDEX IF NOT EXISTS idx_mov_item  ON movimientos(item_id);
CREATE INDEX IF NOT EXISTS idx_mov_fecha ON movimientos(fecha);
CREATE INDEX IF NOT EXISTS idx_mov_trab  ON movimientos(trabajador_id);
CREATE INDEX IF NOT EXISTS idx_arq_det   ON arqueo_detalle(arqueo_id);
