# ORA · Organización de Reportes para Análisis

Reportes y seguimiento listos. Más tiempo para decidir.

Portal gerencial local de ventas, cuentas por cobrar e inventario. La empresa Distribuidora Andina, sus tres sucursales y todos los movimientos son sintéticos. La identidad sigue la propuesta Foco de la ficha del producto.

## Inicio

Desde esta carpeta, con Python 3.10 o posterior y un navegador moderno, ejecuta en PowerShell:

```powershell
python app.py demo
python app.py demo
python app.py serve
```

Abre **http://127.0.0.1:8765**. El servidor escucha en la interfaz local. Para detenerlo pulsa Ctrl+C. El primer arranque también carga la muestra si falta la base. Puedes cambiar el puerto con `python app.py serve --port 8766`. Para verificar la carga y los totales en una base temporal, ejecuta `python -m unittest -v` desde esta carpeta.

La carga incluye enero a octubre de 2026, con 1 empresa, 3 sucursales, 8 clientes, 5 productos, 300 documentos, 600 líneas y 250 aplicaciones. Repetirla actualiza la hora de sincronización. Recarga el navegador para leer la última instantánea. Python y SQLite están en la biblioteca estándar. El navegador carga HTML, CSS y módulos JavaScript locales.

## Recorrido de aceptación

1. Abre **Ventas** en octubre de 2026, USD, todas las sucursales y todos los productos. Las 26 facturas contabilizadas suman 8.168,10 sin impuestos. Una nota de crédito resta 112,10 y deja una facturación neta de **8.056,00**.
2. Abre la tarjeta de facturación neta. El detalle contiene 27 documentos. Despliega un número para ver identificador de origen, líneas e impuestos. Cierra con × o Escape. Las barras del comparativo abren los documentos del tramo y mes elegidos.
3. Filtra por sucursal o producto. Las tarjetas, el comparativo, el reparto y las filas comparten los filtros. La aportación de un producto incluye únicamente sus líneas. Cambiar a EUR presenta otro conjunto de documentos.
4. Abre **Cuentas por cobrar** con octubre, USD y todas las sucursales. El saldo pendiente al 31/10 es **21.955,37**, el vencido **15.599,15** y el saldo por vencer **6.356,22**. Abre el tramo de 1–30 días, después un cliente y una factura para ver sus aplicaciones hasta el corte. Cambia el mes para consultar un cierre anterior.

## Criterios contables del piloto

- **Ventas.** Se selecciona el mes natural de emisión y se compara con el mes natural anterior, usando la misma moneda, sucursal y producto. Solo se consideran documentos contabilizados (`posted`). Borradores y anulados se conservan en la base. La facturación neta suma los importes de línea después de descuentos y antes de impuestos, con signo negativo para las notas de crédito. La variación porcentual requiere una base anterior positiva. El historial empieza en enero de 2026.
- **Impuestos y moneda.** El modelo conserva neto e impuesto de origen por línea en centésimas enteras. La muestra calcula un impuesto ilustrativo del 16 % redondeado por línea. En producción se importarán los importes contabilizados por el ERP. Los filtros separan USD y EUR. Incorporar monedas con distinta precisión exige registrar su escala.
- **Cartera.** Al último día natural del mes se incluyen documentos contabilizados emitidos hasta ese día, incluso en meses anteriores. El saldo es neto más impuesto menos aplicaciones con fecha efectiva hasta el corte, con el signo del documento. Una aplicación reduce el importe abierto de una factura o de una nota de crédito. El ejemplo usa notas ya liquidadas, pagos completos y pagos parciales. Un crédito abierto reduce la cartera del cliente. El filtro por producto se aplica solo a ventas porque las aplicaciones son por documento.
- **Vencimiento.** Vence si la fecha de vencimiento es estrictamente anterior al corte y existe saldo. Vencer el propio día del corte cuenta como por vencer. Se clasifica por días naturales en por vencer, 1–30, 31–60, 61–90 y más de 90. La demo tiene un vencimiento por documento, sin anticipos independientes ni cuotas. Para empresas con cuotas hay que incorporar vencimientos y aplicaciones por partida antes de conciliar.
- **Historia.** La muestra tiene estados fijos. Para reconstruir cierres reales con anulaciones posteriores se requerirá el historial de estados o una instantánea certificada al cierre. La fecha de emisión y la contable pueden diferir en el ERP y deben alinearse al elegir el informe de referencia.

## Modelo y contrato de integración

En `model.py`, `Connector.snapshot()` devuelve una instantánea completa y consistente de **una empresa y una fuente**. `TABLES` fija los nombres y el orden de los campos de cada tupla. La aplicación de referencia es `Demo.snapshot()` en `demo.py`. El extractor lee el origen y la escritura ocurre en la base local de ORA.

| Entidad | Identificación y contenido |
| --- | --- |
| company | ID estable del origen, nombre, código de fuente |
| customer / product | ID de origen y nombre visible |
| document | ID y número visible, invoice/credit, posted/draft/cancelled, emisión, vencimiento, cliente, sucursal opcional y moneda |
| line | ID de línea, documento, producto opcional, cantidad e importes positivos de neto e impuesto |
| settlement | ID de aplicación, documento, fecha efectiva, importe positivo en la moneda del documento |

El conector debe completar la paginación, normalizar fechas ISO y descartar cargas parciales antes de devolver el conjunto. Usar un ID estable por aplicación si un cobro liquida varias facturas. Las líneas sin producto y los documentos sin sucursal conservan su importe en categorías propias. Los estados normalizados se acuerdan contra los estados de la versión concreta. La demo trabaja con cantidades enteras.

Cada empresa dispone de un archivo SQLite independiente, vinculado al ID de empresa y fuente. El servidor selecciona el archivo en su configuración. El navegador carece de selector de base, ruta o empresa. `ORA_DATA_DIR` puede apuntar a un directorio local alternativo. Una transacción reemplaza la instantánea completa y registra la hora de éxito al confirmar. Las claves primarias y foráneas comprueban identidades y relaciones. Si falla una inserción, SQLite conserva los datos y la hora anteriores. Los lectores ven una única versión consistente. Los tableros usan la respuesta de `/api/demo`, generada desde el modelo persistido, y las métricas de `web/metrics.js`.

Cada proceso sirve una empresa en la interfaz local. Por defecto hay un perfil local. El piloto admite una lista de usuarios configurada fuera del repositorio. Para acceso remoto con datos reales se requiere un despliegue protegido con TLS y gestión de identidades. Para consolidación futura, los IDs se identificarán también por empresa y fuente. Los planes comerciales orientan esa evolución. El servidor activa los módulos según el plan local.

## Validación con Odoo

Se consultaron las referencias oficiales de [Odoo 18 · API externa](https://www.odoo.com/documentation/18.0/developer/reference/external_api.html) y [Odoo 19 · JSON-2](https://www.odoo.com/documentation/19.0/developer/reference/external_api.html). La 18 documenta XML-RPC y la 19 introduce JSON-2 con clave de API. La documentación indica que el acceso externo en planes comerciales está disponible en Custom. La disponibilidad efectiva se verificará para el alojamiento y versión exactos de la instancia.

Para elegir el mecanismo, facilitar versión y edición exactas, Odoo Online/Odoo.sh/servidor propio, plan, URL HTTPS, nombre de base, ID de compañía, módulos y personalizaciones relevantes. Confirmar qué campos representan sucursal, moneda, fecha contable, cuotas y conciliaciones. Usar una cuenta técnica limitada a lectura con acceso únicamente a la empresa aprobada. Provisionar el secreto fuera del repositorio mediante un gestor de secretos o una variable de entorno del proceso. La primera entrega no consume credenciales.

Tras confirmar la documentación de esa versión, validar con una lectura mínima de la compañía. Mapear clientes, productos, facturas de cliente, rectificativas, líneas de factura y aplicaciones fechadas; en Odoo examinar res.partner, product.product, account.move, account.move.line y las conciliaciones parciales según los campos disponibles. El saldo residual actual por sí solo es insuficiente para cierres históricos. Verificar reglas de acceso del usuario y campos personalizados antes de implementar la extracción completa.

## Validación con Profit Plus

El mismo contrato admite un lector de una exportación consistente de Profit Plus. Se requiere versión y edición, módulos instalados, diccionario de datos o especificación de exportaciones, codificación, formatos de fecha y moneda, identificadores estables y relaciones. Solicitar muestras anonimizadas de clientes, artículos, sucursales, facturas con sus renglones, devoluciones, anulaciones, cuotas, cobros, aplicaciones parciales y reversos. Acordar si se utilizarán archivos o vistas autorizadas de solo lectura. Identificar cuándo un extracto está completo y obtener los reportes de control del mismo cierre.

## Conciliación de una instalación real

1. Elegir un período cerrado y guardar las exportaciones del ERP con empresa, sucursal, moneda, zona horaria, criterio de fecha y estados utilizados. Registrar versión y momento de extracción.
2. Conciliar ventas por tipo y número de documento, neto e impuesto por línea. Comprobar rectificativas, descuentos, anulaciones y redondeo. Repetir por sucursal y producto cuando existan.
3. Comparar el auxiliar de clientes y el informe de antigüedad al mismo corte. Verificar saldo de apertura, movimientos, aplicaciones posteriores, vencimientos y créditos abiertos. Identificar diferencias por cliente, documento y partida.
4. Aceptar el período al cuadrar los importes en unidades mínimas de cada moneda y explicar cualquier diferencia de criterio. Conservar filtros, reportes, IDs discrepantes y resolución. Repetir la sincronización y confirmar las mismas cifras y conteos.

**Estado de validación.** Los tres tableros y la carga repetida se probaron con datos sintéticos. Las conexiones reales y la conciliación de Odoo y Profit Plus quedan pendientes de acceso y reportes verificables.

## Inventario y acceso del piloto

La demo usa **Intermedio** de forma predeterminada. El servidor resuelve el plan y filtra el modelo que entrega al navegador. Básico habilita Ventas. Intermedio y Avanzado habilitan también Cuentas por cobrar e Inventario. Para probar un plan desde PowerShell, establece `$env:ORA_PLAN = "basico"`, `"intermedio"` o `"avanzado"` antes de iniciar el proceso. La base local sigue aislada por empresa. En la primera ejecución sobre la demo de la entrega anterior, ORA vuelve a generar su muestra sintética ampliada.

El contrato del conector incorpora cuatro colecciones opcionales que se entregan juntas. `warehouse` identifica el almacén. `article` vincula el ID de producto con SKU, categoría y unidad base. `stock_cut` identifica un corte por empresa, producto, almacén y mes, con apertura, cierre físico y mínimo opcional. `stock_move` identifica cada movimiento ejecutado, el corte al que pertenece, fecha efectiva, tipo, unidades firmadas y referencia de origen. El conector debe normalizar todas las cantidades de un artículo a su unidad base y entregar el historial completo de movimientos del mes. La muestra usa unidades enteras de cada presentación.

- **Existencias** toma el cierre físico reportado. Un corte sin apertura conserva las existencias conocidas. En la demo, las existencias de dos almacenes tienen cortes desde enero hasta octubre de 2026. Las facturas y los despachos pertenecen a conjuntos sintéticos independientes.
- **Promedio** parte de la apertura, aplica los movimientos de cada fecha y suma el saldo al final de cada día natural, incluidos días sin movimientos. Divide por los días del mes. Exige apertura conocida, cierre conciliado y promedio positivo.
- **Rotación** divide despachos de venta menos devoluciones de clientes entre el promedio. Recepciones, ajustes y transferencias cambian el saldo diario. Una transferencia tiene dos movimientos con la misma referencia, uno de salida y otro de entrada. Ninguno aporta unidades al numerador.
- **Estados** se pueden acumular. Agotado significa cierre ≤ 0. Stock bajo requiere un mínimo y cierre inferior a él. Sin salidas significa cero despachos brutos de venta. Baja rotación significa menos de 0,5 vueltas en el mes. Alta rotación empieza en 1 vuelta. Entre ambos umbrales la rotación es ordinaria. Son criterios iniciales del piloto. Los contadores usan combinaciones producto-almacén.
- **Ranking** consolida por producto en los almacenes seleccionados, dividiendo la suma de salidas netas entre la suma de promedios. Omite productos con historia incompleta en algún almacén seleccionado o denominador conjunto no positivo. La tabla conserva las referencias con datos insuficientes.

En octubre, filtra **Principal · Caracas → Café e infusiones**. El café AND-101 cierra con 55 unidades frente a un mínimo de 65. Los despachos suman 110 y las devoluciones 3. La rotación es 107 / 108,81 ≈ 0,98 vueltas. Abre **Movimientos** para revisar las fechas y las cinco variaciones. El aceite figura agotado, el arroz tiene baja rotación, la harina carece de salidas por venta y el azúcar de Valencia carece de apertura.

## Apariencia y consulta de documentos

Al pie de la barra lateral, en **Perfil de demo → Apariencia** elige Foco, Bosque o Atlántico, personaliza el acento o restablece Foco. La preferencia se guarda en este navegador por origen y clave de perfil. `initAppearance(profile)` admite un identificador de perfil cuando exista autenticación. El acento se oscurece si hace falta para alcanzar contraste mínimo 4,5 a 1 sobre las superficies de lectura y con texto blanco. Source Sans 3 y su licencia están en `web/fonts`. La fuente se sirve localmente.

En Cobranza, abre **Más de 90 días** para ver los documentos con ese vencimiento. El conteo y la suma siguen visibles al desplazar el detalle. Escape y el botón de cierre devuelven el foco al control de origen. En Ventas, enfoca cualquiera de las dos barras de un tramo para leer ambos importes y la diferencia. El panel lateral se activa desde 960 píxeles de ancho.

## Inventario con Odoo y Profit Plus

La documentación oficial de Odoo 19 describe fecha, referencia, producto, ubicaciones, cantidad, unidad y estado en el historial, y existencias por ubicación a una fecha en el reporte de ubicaciones. Son referencias para diseñar la prueba. [Historial de movimientos](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/warehouses_storage/reporting/moves_history.html) · [Reporte de ubicaciones](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/warehouses_storage/reporting/locations.html).

**Pendiente de instalación real.** Confirmar versión, alojamiento, compañía y acceso autorizado de lectura. Verificar campos y permisos efectivos para movimientos ejecutados, devoluciones enlazadas a ventas, ajustes, ubicaciones internas y de tránsito, reglas de mínimo y conversión de unidades. Acordar la zona horaria y la asignación de ubicaciones a almacenes. Comparar apertura y cierre físico a fecha, conteos y unidades por tipo de movimiento para un producto de cada almacén en un mes cerrado. Reconciliar el promedio con los cierres diarios y los numeradores con los despachos y devoluciones efectivos. Registrar diferencias antes de aprobar el mapeo. Profit Plus podrá entregar las mismas cuatro colecciones tras verificar exportaciones y fechas equivalentes. La validación actual usa únicamente la demo.

## Ventas por vendedor y Clientes

La muestra añade tres vendedores y documentos sin asignación. El conector puede entregar las tablas opcionales `seller(id,name)`, `assignment(document,seller)` y `location(customer,zone,latitude,longitude,precision)`. Se conservan las claves de origen y el aislamiento por empresa. La carga de una muestra anterior se actualiza al iniciar el servidor. El ranking y el filtro aparecen cuando existen asignaciones. El conteo del ranking incluye facturas contabilizadas y el importe incluye el efecto de notas de crédito. La participación se calcula sobre la facturación neta filtrada. El detalle abre los documentos y permite expandir las contribuciones por cliente y por producto.

En octubre de 2026, USD, todas las sucursales y productos, el ranking muestra **2.811,60**, **2.366,60**, **1.622,90** y **1.254,90** sin asignar. El total es **8.056,00**. El código oficial de Odoo 19 define `account.move.invoice_user_id` como una relación Many2one con `res.users` para el vendedor del documento. Es un candidato para la integración de lectura. Confirmar en la instancia concreta la versión, la visibilidad del campo, los permisos de compañía y las asignaciones de facturas y rectificativas antes de importar. [Código de Odoo 19](https://github.com/odoo/odoo/blob/19.0/addons/account/models/account_move.py).

Clientes está disponible en Intermedio y Avanzado. El Básico concentra ventas y facturación en sus pestañas Resumen y Documentos. Las cifras y los documentos de cartera requieren acceso al módulo de cuentas por cobrar. Con filtros de sucursal o vendedor se muestran clientes asociados a documentos contabilizados de esa moneda hasta el cierre. La ficha suma las ventas del mes y reconstruye el saldo al corte. El listado permite acceder a los documentos sin utilizar el mapa.

La demo contiene siete clientes con ubicación sintética y uno sin ubicación. Caracas y Valencia tienen puntos de demostración. Maracay agrupa dos clientes en un único centro de ciudad incluso al acercar el mapa. En Clientes, selecciona Caracas en el mapa para ver tres fichas o usa el filtro Zona. Seleccionar una ficha centra el mapa si hay coordenadas. Mostrar todos elimina la selección del mapa y conserva los filtros.

El mapa abre con la extensión completa de Venezuela y utiliza la copia local versionada del GeoJSON simplificado geoBoundaries VEN ADM1 (25 entidades). Ciudades agrupa por zona declarada y coloca cada marcador en el centro de sus ubicaciones disponibles. Estados asigna cada cliente al polígono que contiene su coordenada; la asignación de un registro con precisión de ciudad usa su centro aproximado. Cada cliente cuenta una sola vez. Los límites estatales son neutros en la vista de ciudades. La escala usa los rangos 0, 1, 2, 3–4 y 5+, con mayor luminosidad para conteos positivos más altos. Seleccionar un marcador o estado encuadra la zona y actualiza el listado. Venezuela restaura el encuadre nacional con los filtros activos. Sin ubicación queda disponible en la lista general. El portal funciona sin geocodificación externa. [Procedencia, revisión, licencia y huella de la copia](web/cartography/ATTRIBUTION.md).

Los filtros se recorren con Tab. Enter abre la lista, las flechas recorren las opciones y Escape cierra sin aplicar cambios. Producto admite búsqueda por texto. En Documentos de respaldo, el total y los encabezados permanecen visibles durante el desplazamiento. En móvil, emisión y vencimiento aparecen bajo el cliente para dejar sitio al importe.

### Directorio y ficha de cliente

Clientes abre con un directorio de tarjetas. Distribución geográfica conserva los filtros y permite abrir las fichas de la zona seleccionada. El botón de información del mapa despliega la atribución y la licencia.

El perfil opcional contiene código, identificación fiscal, contacto, correo y dirección. El producto principal se ordena por venta neta del período con los filtros activos. La línea de crédito se registra por cliente y moneda, en centésimas. En la muestra el límite es fijo durante todo el historial. Consumo al corte = saldo pendiente positivo de toda la empresa en esa moneda; disponible = límite menos consumo, con piso en cero. Los planes con cartera muestran estos indicadores. Un límite de cero indica que el cliente no tiene crédito autorizado; la ausencia del registro indica dato desconocido. Contactos y límites de la demo son sintéticos.

## Probar el piloto Básico

Desde esta carpeta en PowerShell, ejecuta:

```powershell
$env:ORA_PLAN = "basico"
$env:ORA_BRANCH = "Caracas"
python app.py serve --port 8766
```

Abre http://127.0.0.1:8766. La cabecera identifica Caracas y el selector de sucursal queda oculto. El servidor entrega documentos, líneas, clientes, vendedores y productos de la sucursal habilitada. En la API de Básico se omiten aplicaciones de cobro, límites de crédito e inventario. El plan y la sucursal se fijan en el servidor; las peticiones del navegador no los seleccionan.

**Usuarios.** Sin configuración de cuentas se utiliza un solo perfil de demostración local. Para un piloto con usuarios identificados, inyecta `ORA_USERS_JSON` desde un gestor de secretos antes de iniciar Python. Es un objeto JSON que relaciona los nombres de acceso con sus contraseñas. El servidor valida la identidad mediante HTTP Basic en cada petición y rechaza al iniciar una lista con más de tres usuarios en Básico. Todos los usuarios del proceso comparten la empresa, el plan y la sucursal autorizados. Mantener los secretos fuera del proyecto y usar TLS en el punto de entrada si se habilita acceso remoto. Los datos y descargas de empresas distintas deben servirse desde procesos y directorios de empresa independientes.

**Ventas y Documentos.** Elige octubre de 2026, USD y Café molido. En Caracas el resultado es USD 795,00 en tres facturas. Abre Facturación neta o selecciona un tramo. En Documentos, busca FAC-26-10024 o Bodega El Sol. Los filtros Desde/Hasta acotan el mes seleccionado. Todos los importes de venta del reporte son netos de impuesto. La factura completa FAC-26-10024 suma USD 413,54 con impuestos y aporta USD 255,00 netos por el café. En el mes en curso se usa la fecha de Caracas y se compara desde el primer día hasta el mismo día del mes anterior, con límite en el último día disponible de ese mes. La muestra de ventas termina en octubre de 2026.

**Exportar.** Abre Exportar en Resumen, Documentos, un respaldo o un estado de cuenta. Ambos formatos se generan localmente en el navegador desde las mismas filas y centésimas del reporte autorizado. El Excel lleva resumen, detalle numérico y autofiltros. El estado añade documentos abiertos. El PDF identifica la empresa, la muestra sintética, el período y los filtros, y pagina las tablas. Las bibliotecas incluidas para las descargas son ExcelJS 4.4.0, jsPDF 4.2.1 y jsPDF-AutoTable 5.0.2; sus licencias se encuentran en web/vendor.

## Estados de cuenta

En una segunda terminal ejecuta `$env:ORA_PLAN = "intermedio"` y `python app.py serve --port 8765`. Abre http://127.0.0.1:8765 y elige **Cuentas por cobrar → Estados de cuenta → Abastos El Parque**, octubre de 2026, USD, todas las sucursales. El selector de cliente admite búsqueda. La apertura corresponde al cierre del día anterior. La fecha de emisión registra el cargo bruto de la factura o el abono bruto de la nota. Cada aplicación entra exclusivamente por su fecha efectiva. La liquidación de una nota de crédito lleva signo positivo para cerrar el crédito abierto; la muestra la registra como un movimiento independiente. Un movimiento muestra su referencia y abre el documento y las aplicaciones conocidas hasta esa fecha.

Al 31/10, saldo inicial 1.949,80 + facturas 846,80 − pagos 870,86 − notas de crédito 130,04 + liquidaciones de crédito 130,04 = **USD 1.925,74**. Los abiertos suman el mismo saldo, con **USD 1.321,26** vencidos. A09030 aplica USD 122,20 parcialmente el 20/10. FAC-26-10030 conserva USD 604,48 al corte; su aplicación A10030 por USD 302,24 entra el 19/11. Exportar desde el estado genera un archivo de un único cliente y moneda.

El conector puede entregar una sola fila `history_coverage(id,start_date,through_date,zero_opening,applications_complete)`. Debe acreditar un inicio conocido sin saldo previo y todas las aplicaciones desde el inicio hasta la fecha certificada. El lote se confirma con los movimientos en la misma transacción. La demo acredita del 01/01 al 31/10. La falta de apertura acreditada o de aplicaciones completas hace que el estado y sus exportaciones se identifiquen como provisionales. Para clientes con saldo anterior distinto de cero se necesita incorporar partidas de apertura verificadas antes de certificar el histórico.

**Odoo pendiente.** El modelo de Odoo 19 documentado en su código conserva vínculos a partidas de débito y crédito, importes por moneda y fecha efectiva de la conciliación parcial. Comprobar la versión instalada, permisos, personalizaciones y conservación de conciliaciones deshechas, abonos a cuenta y reversiones. Extraer en solo lectura facturas, notas, líneas y conciliaciones históricas, verificar saldos de apertura y asignación a sucursal, y conciliar un período cerrado por documento y cliente. No hay una instalación real validada en este piloto. [Modelo de conciliación parcial de Odoo 19](https://github.com/odoo/odoo/blob/19.0/addons/account/models/account_partial_reconcile.py).

Pruebas de almacenamiento y permisos: `python -m unittest -v`. Pruebas del cálculo temporal y de cartera con Node 24: `node test_reports.mjs`.

## Recorridos y exportaciones

La primera visita ofrece un recorrido general. En el menú de usuario al pie de la barra lateral, **Recorrido guiado** permite repetirlo o elegir una sección. Básico incluye Ventas y Documentos. Intermedio y Avanzado incorporan Cobranza, Estados de cuenta, Clientes, Inventario y Reposición. Escape pausa el recorrido y retoma el paso al volver. Omitir y Finalizar cierran el recorrido. ORA conserva el progreso en ese navegador para la combinación de empresa, usuario y plan.

El generador común de Excel y PDF captura el tema efectivo al pulsar la descarga. El logo Foco y «Generado con ORA» identifican la empresa y el reporte. En Excel, el resumen incorpora el logo y las hojas de datos tienen autofiltro y columnas numéricas. El PDF repite la firma, la empresa, el origen y la paginación, además de los encabezados de las tablas que continúan. Para comparar paletas, exporta el estado de Abastos El Parque en octubre, cambia el acento desde Apariencia y repite la descarga. En el PDF, el primer cuadro muestra saldo final y vencido, seguido del desglose y las partidas del cliente.

## Reposición

En Intermedio o Avanzado abre **Inventario → Reposición** y elige octubre de 2026. Cada fila representa un producto en un almacén y en su unidad de inventario. Selecciona el producto para abrir los datos del cálculo. El grupo de prioridades y el detalle se pueden exportar con los mismos filtros. Básico carece de los datos de inventario en la respuesta de la API y el servidor restringe el módulo de reposición. Las sugerencias se calculan en el navegador y quedan para revisión humana.

El consumo diario es la suma de salidas por venta menos devoluciones dividida entre los días con stock de uno, dos o tres meses cerrados consecutivos. El conector certifica la disponibilidad por día, producto y almacén en `stock_day(cut,posted,availability)`. Un día completo o parcial con stock cuenta una vez, incluso con cero ventas. Un día totalmente agotado se excluye. En la demo se reconstruyen estos estados con el físico inicial y todos los movimientos de la jornada. Con 10, 8 y 0 unidades en tres días con stock y dos días agotados, el consumo es 18 / 3 = 6 unidades por día. Si falta una observación, el historial de ventas o todo el período estuvo agotado, la demanda queda sin calcular. El consumo mínimo es cero. Transferencias, ajustes y compras quedan fuera de la demanda. El disponible corresponde al físico del corte menos las reservas pendientes. La posición suma al disponible el pendiente de recibir confirmado con llegada posterior al corte y hasta el último día del plazo, inclusive. Una recepción ya contabilizada forma parte del físico. Una recepción cancelada, en borrador o posterior al plazo no incrementa la posición.

El punto de reposición es consumo diario × plazo de entrega + seguridad. Cuando la posición cae por debajo de ese punto, ORA propone alcanzar el punto más **siete días adicionales de consumo**, redondeando la compra hacia arriba en unidades enteras. Los siete días representan una revisión semanal. El plazo y la seguridad provienen de la política del producto y almacén. Los ajustes introducidos en pantalla sustituyen esos valores para la consulta actual. La fecha estimada para pedir supone consumo constante y las recepciones consideradas al corte. La cobertura usa solo el disponible físico y se expresa en días si hay consumo.

| Prioridad | Criterio |
| --- | --- |
| Prioritario | Se necesita comprar y la cobertura física alcanza como máximo el plazo de entrega. |
| Revisar pronto | Hay una compra sugerida con margen físico, o hay demanda y la posición sigue por debajo del objetivo o la cobertura física llega como máximo al plazo. |
| Sin urgencia | La política y el historial permiten calcular una sugerencia de cero y hay margen suficiente. |
| Datos insuficientes | Falta el historial completo de ventas, el plazo, la seguridad, las reservas o la cobertura de recepciones confirmadas. La cantidad queda sin calcular. |

En octubre, el aceite de Caracas tiene cero disponible y requiere 42 unidades (35 salidas en 25 días con stock). El aceite de Valencia también está agotado, con 90 unidades confirmadas para el 1 de noviembre. Su sugerencia es cero y queda marcado para seguimiento de la recepción. El azúcar de Valencia carece de historial suficiente y el arroz de Valencia tiene pendiente el plazo. El maíz tiene demanda cero acreditada.

Para incorporar otra fuente, el conector entrega una política por corte en `stock_policy` y las líneas pendientes en `inbound`. Los identificadores de línea deben ser únicos en la instantánea de empresa, incluso si se conservan varios cortes de la misma recepción. Ambos conjuntos, el físico, las reservas y los movimientos se sincronizan juntos. Antes de habilitar sugerencias de Odoo, validar por almacén la unidad de medida, el corte histórico de reservas, los plazos del proveedor, la fecha prevista y el pendiente real de recepciones parciales. La prueba disponible usa exclusivamente la empresa sintética. Las reglas se pueden probar con `node test_restock.mjs`.

### Configuración pendiente para la instancia Odoo

Registrar la URL HTTPS, la base de datos, la versión, el alojamiento, la compañía, la zona horaria, las sucursales, los almacenes y la unidad de cada producto. Crear un usuario técnico con permisos de lectura sobre los modelos acordados y reglas de registro limitadas a esa compañía. Entregar la clave al futuro conector mediante un gestor de secretos. La demo local funciona sin clave y lee el modelo sintético.

En Odoo 19 con JSON-2, revisar el catálogo de la instancia en `/doc` y la disponibilidad del acceso externo. La clave se envía como Bearer y la base mediante `X-Odoo-Database` cuando corresponda. Limitar las llamadas a métodos de consulta como `search_read` y validar una lectura de la compañía con esa misma identidad. Para Odoo 18 consultar el mecanismo XML-RPC documentado para esa versión. [API oficial de Odoo 19](https://www.odoo.com/documentation/19.0/developer/reference/external_api.html) · [API oficial de Odoo 18](https://www.odoo.com/documentation/18.0/developer/reference/external_api.html).

Para conciliar un mes cerrado, cotejar con el ERP empresa, fechas contables, sucursal y moneda. Comparar las ventas sin impuestos por factura y nota de crédito. Para el estado de cuenta, comprobar apertura, movimientos aplicados hasta el corte, abiertos y vencidos por cliente. Para Reposición, conciliar el físico y las reservas por almacén, ventas netas de devoluciones, días con disponibilidad parcial o agotamiento y cantidades pendientes por línea de recepción. Una foto de existencias actuales por sí sola no certifica el historial diario.

### Probar el mismo commit en un VPS Linux

Con Python 3.10 o posterior, desde una sesión SSH del VPS, clona el repositorio y cambia al SHA del PR que deseas probar. Elige un directorio de datos exclusivo para la demo.

```sh
git clone https://github.com/dsar-svg/ORA-Sitem.git ora-piloto
cd ora-piloto
git checkout --detach <SHA-del-PR>
export ORA_PLAN=intermedio
export ORA_DATA_DIR="$HOME/.local/share/ora-demo"
python3 app.py demo
python3 app.py serve --port 8765
```

Sustituye el marcador de SHA antes de ejecutar el comando. El servicio escucha en la interfaz local. Desde tu equipo abre un túnel con `ssh -L 8765:127.0.0.1:8765 usuario@servidor` y visita el puerto 8765 de localhost. Para servir la aplicación a varios usuarios configura las cuentas indicadas en «Probar el piloto Básico» y un proxy HTTPS.
## Acceso al piloto con la cuenta de Odoo

Para una instalación Odoo 17, ORA puede validar el correo y la contraseña local mediante HTTPS en `/web/session/authenticate`. Define las variables en el proceso o crea el archivo privado `.env.odoo` junto a `app.py`. Sustituye los ejemplos por los datos de la instalación.

```dotenv
ODOO_URL=https://empresa.odoo.com
ODOO_DB=nombre-de-base
ORA_ERP_USERS=persona@empresa.example
```

El servidor admite `NEXT_PUBLIC_ODOO_URL` como alias de la URL. La lista de correos asigna las plazas del plan y admite varios correos separados por comas. Si hay varias empresas en la base, `ODOO_COMPANY_ID` fija el identificador permitido. Si se omite, se comprueba el acceso a la compañía principal del usuario. Reinicia ORA cuando cambies la configuración. En el piloto local ejecuta `python app.py serve --port 8770` y abre `http://127.0.0.1:8770/login`.

El formulario envía la contraseña al servidor de ORA, que la usa únicamente para validar el acceso en la instancia configurada. El servidor comprueba base, identidad, usuario interno y compañía. Una vez confirmado el usuario, ORA crea su propia sesión en memoria, con duración máxima de una hora. Puedes cerrarla desde el menú de usuario. Para servir el portal fuera de localhost usa un proxy HTTPS y define `ORA_PUBLIC_ORIGIN` con el origen HTTPS del portal para activar la cookie segura.

La prueba admite contraseñas locales de Odoo. Para cuentas con inicio federado o segundo factor, queda pendiente integrar el flujo correspondiente. ORA exige una identidad completamente autenticada. El modo Odoo actual sirve los reportes sintéticos. Antes de publicar reportes reales hay que vincular la empresa y los permisos sobre registros a la fuente sincronizada. La clave de API destinada a sincronización se provisionará por separado. [Controlador de sesión de Odoo 17](https://github.com/odoo/odoo/blob/17.0/addons/web/controllers/session.py).
