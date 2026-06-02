# App Inventario de Bodega

Aplicación web para el control y **trazabilidad** de equipos e insumos de bodega.
Objetivo principal: registrar quién mueve qué, cuándo y para quién, para reducir robos.

## Cómo ejecutarla

```bash
npm install          # solo la primera vez
npm run init-db      # solo la primera vez (crea la base y el usuario admin)
npm start            # arranca el servidor
```

Luego abrir en el navegador:
- En el PC de bodega: `https://localhost:3000`
- Desde un celular en el mismo Wi-Fi: `https://IP-DEL-PC:3000` (la IP se muestra al iniciar)

> **Nota sobre HTTPS:** la app se sirve por HTTPS porque el escaneo con cámara solo
> funciona en "contexto seguro". Usa un certificado local autofirmado (se crea solo en
> `data/cert.pem` la primera vez), así que el navegador mostrará un aviso de seguridad:
> entra en **Avanzado → Continuar de todos modos** una sola vez por dispositivo.
> Si cambia la IP del PC, borra `data/cert.pem` y `data/key.pem` para regenerarlo.

**Usuario inicial:** `admin` / `admin123` — cambiar la clave después del primer ingreso.

## Stack
- Node.js + Express (servidor y API REST)
- SQLite vía better-sqlite3 (datos en `data/inventario.db`)
- Frontend HTML + JS responsivo (sin compilación), escaneo QR con la cámara
- Sesión por cookie (express-session)

## Tipos de item
- **Retornable**: equipo que debe volver (máquina de soldar, esmeril, manómetro…). Se presta y se controla la devolución.
- **Consumible**: se gasta (disco de corte, varilla, EPP…). Solo se controla stock.

## Avance por módulos
- [x] **Módulo 1 — Base**: servidor, base de datos, login y panel.
- [x] **Módulo 2 — Catálogo de items**: alta/edición/baja, código automático (RET-/CON-), búsqueda, filtro por tipo y stock bajo, QR imprimible.
- [x] **Módulo 3 — Movimientos**: entrada, salida/préstamo, devolución, ajuste (admin), préstamos abiertos e historial con filtros. Stock movido solo por movimientos, en transacciones. Cada salida genera un **comprobante de entrega imprimible** (con datos del retiro y espacios de firma).
- [x] **Módulo 4 — Trabajadores** (adelantado): registro de quién retira, con alta rápida desde la pantalla de salida.
- [x] **Módulo 5 — Escaneo con cámara**: escáner reutilizable (QR y código de barras) integrado en Salida, Devolución y Catálogo. Lee el código del item y lo selecciona/busca automáticamente.
- [x] **Módulo 6 — Documentos por semana**: espacio para subir y consultar informes en Word (.doc/.docx) y PDF, organizados en carpetas por semana (Semana 1, Semana 2…). Las carpetas se crean automáticamente con el número siguiente; los archivos se guardan en disco en `data/documentos/<carpeta>/` (fácil de respaldar). _(Reemplaza al antiguo arqueo de turno; su backend (`arqueos.js`) sigue presente por si se retoma.)_
- [x] **Módulo 7 — Alertas de descuadre**: tablero que reúne las señales de riesgo — descuadres de arqueo pendientes, préstamos antiguos sin devolver (umbral de días configurable) y stock bajo el mínimo. El admin puede **revisar** cada descuadre (deja constancia de quién y la nota) y, si corresponde, **aplicar el ajuste** de stock desde ahí (movimiento 'ajuste' trazable).
- [x] **Módulo 8 — Reportes y auditoría**: panel de gestión para el jefe, en pestañas — **Resumen** (KPIs: stock por tipo, préstamos sin devolver, stock bajo, movimientos del día/semana/mes), **Stock** (existencias con buscador), **Movimientos** por período (resumen por tipo + items con más rotación), **Por trabajador** (cuánto retiró y qué tiene pendiente, con detalle individual) y **Auditoría** (bitácora de quién hizo qué y cuándo; solo admin). Cada reporte se descarga en **CSV (Excel)**.
