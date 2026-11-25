---
name: ora-ui
description: Reglas fijas de interfaz para ORA (portal de reportes gerenciales sobre el ERP). Úsala antes de crear o modificar cualquier vista, tarjeta, gráfica, tabla, filtro o estado en web/ (Ventas, Cuentas por cobrar, Cuentas por pagar, Clientes, Inventario, Ora) para que todas las pantallas sigan el mismo sistema y nada se improvise.
---

# ORA · reglas de interfaz

ORA es un portal de reportes para dueños y gerentes de distribuidoras (Venezuela/LatAm) que leen su ERP en el teléfono y en el escritorio. Cada pantalla responde una pregunta de negocio y cada cifra se puede rastrear hasta sus documentos. Estas reglas son obligatorias; si una vista no puede cumplirlas, dilo en vez de improvisar.

Complementan, no reemplazan, a las skills `interface-design` (oficio visual) y `dashboard-designer` (KPIs y estructura) instaladas en este proyecto.

## 1. Regla de los 5 segundos (estructura de toda vista)

Orden fijo de arriba hacia abajo:

1. **Frase de Ora** (`.ora-says`): una línea en lenguaje de negocio con el hallazgo principal, calculada de los datos (sin IA).
2. **3 a 4 tarjetas KPI** (`kpi()` en `web/portal.js`): la primera es la principal (`primary`, filete dorado). Cada KPI muestra su comparación contra el período anterior cuando el dato existe; si no existe, la subetiqueta dice el contexto (corte, cantidad de documentos), nunca se inventa.
3. **1 o 2 gráficas o listas de barras** (`panel()` + `chart()` / `horizontal()`), con título que es una pregunta o un hallazgo, no solo el nombre de la métrica.
4. **Una tabla** al final (`breakdown()` o tabla con filas clicables `tr[data-a]`) que abre los documentos de respaldo.

Toda cifra abre sus documentos (`drill()`, `openRows()`); toda vista exporta a Excel y PDF (`viewReport` + `exportMenu`).

## 2. Cifras

- `font-variant-numeric: tabular-nums` en todas las cifras: montos, porcentajes, cantidades, fechas en tablas. Ya está en `body`; no lo desactives.
- Montos con `money()` (formato es-VE: `USD 8.056,00`); porcentajes con `pct()`; fechas con `day()`. Nunca formatees a mano.
- Cifras alineadas a la derecha en tablas (`class="num"`).
- Montos grandes: la tarjeta se ajusta sola (`fitNumbers`); no recortes con elipsis.

## 3. Paleta semántica estricta

Solo estos tokens (definidos en `web/style.css`, bloque "Identidad ORA"); nunca hex sueltos en componentes:

| Token | Uso único |
|---|---|
| `--paper`, `--white`, `--tint`, `--line` | Fondo, tarjetas, rellenos suaves, líneas |
| `--ink`, `--muted` | Texto principal y secundario |
| `--fill` / `--plum` | Marca: acciones, selección, enlaces (azul marino) |
| `--gold` | Firma de marca: filete de la tarjeta principal, sección activa, pestaña activa |
| `--good` | Meta cumplida, crecimiento, al día |
| `--caution` | Atención: stock bajo, por vencer pronto |
| `--bad` | Problema: cartera vencida, pérdida, error |
| `--data`, `--data-prev` | Serie actual y período anterior en gráficas |

El verde, ámbar y rojo nunca se usan como decoración ni para marca. El color nunca es la única señal: acompáñalo de texto ("vencido", "más que", "menos que").

## 4. Tipografía y forma

- Geist (local en `web/fonts/geist.woff2`) para todo. Jerarquía por peso y color antes que por tamaño.
- Esquinas pequeñas (`--radius: 4px`), líneas finas, sin sombras grandes ni degradados decorativos.
- Sin emojis ni flechas de texto como íconos: usar `icon()` (trazos SVG).

## 5. Estados obligatorios

- **Cargando:** esqueletos (`skeleton()` en `web/portal.js`) con la misma forma que la vista final (tarjetas, gráfica, tabla). Nunca una pantalla en blanco ni un spinner solo.
- **Vacío:** texto claro de qué no hay y, si hay filtros activos, botón "Quitar filtros" (`.empty` lo recibe automáticamente).
- **Error:** mensaje en lenguaje de negocio con acción ("Reintentar"), nunca el error técnico solo.
- **Datos viejos:** indicador de sincronización en ámbar.

## 6. Filtros globales

Una sola barra arriba en todas las vistas (`.filters`): rangos rápidos (Hoy, 7 días, Este mes, Mes anterior), período, moneda y, según la vista, sucursal o almacén; el resto detrás de "Filtros (n)". No crear filtros propios dentro de una vista si la barra global puede hacerlo.

## 7. Teléfono

Una columna; barra inferior con etiquetas cortas; tablas con scroll horizontal propio o columnas secundarias ocultas; nada de scroll horizontal de la página. Revisar a 375 px.

## 8. Antes de entregar

Capturar escritorio (1440) y teléfono (375) con datos demo, en claro y oscuro, y comprobar: jerarquía en 5 segundos, cifras alineadas, estados vacíos y de carga, exportes sin errores en consola.
