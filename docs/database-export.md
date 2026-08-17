# Exportación de bases de datos

Volcado configurable de la estructura y/o los datos de una base a `sql`, `csv`, `json` o `ndjson`.
Es la única forma de sacar algo del gateway sin entrar al servidor por SSH.

Contrato del backend: `api-reference-v10.md` (no está copiado en `docs/`; este documento describe
el **flujo del frontend**). Cobertura endpoint → pantalla en
[`api-coverage.md`](api-coverage.md#exportación-de-bases-de-datos).

## Por qué existe (y por qué el cliente no sabe ninguna regla)

Antes de este módulo, llevarse un esquema para versionarlo o recargar una tabla en otro servidor
exigía `mysqldump`/`pg_dump` a mano — fuera del gateway, sin auditoría, sin confirmación y sin
límites. Puesto adentro, además gana tres cosas que un dump a mano no da: **consistencia de punto
único en el tiempo** sobre los datos, **determinismo byte a byte** (con `sanitize.script_comments:
false`, dos volcados del mismo esquema son idénticos, así que se pueden commitear y diffear) y un
**manifiesto** que permite auditar qué salió sin abrir el archivo.

Lo que hace a este módulo distinto de todos los demás del gateway es que **el formulario no conoce
ninguna regla de negocio**. Los controles, sus valores válidos, sus defaults, qué combinaciones están
prohibidas y por qué, y los límites numéricos salen de **un solo endpoint**,
`GET .../export-capabilities`. Si en algún componente aparece un `if (format === 'csv')`, algo se
hizo mal: la matriz ya dice qué apaga `csv`.

## Dónde vive cada cosa

| Pieza | Archivo |
|---|---|
| Contratos Zod | `lib/contracts/database-exports.ts` |
| Capa API (12 endpoints) | `features/database-exports/api/database-exports.api.ts` |
| Queries | `features/database-exports/hooks/use-database-exports.ts` |
| Mutaciones | `features/database-exports/hooks/use-database-export-actions.ts` |
| **Evaluador de la matriz + lógica pura** | `features/database-exports/logic.ts` (+ `logic.test.ts`) |
| Códigos, motivos y CTAs de recuperación | `features/database-exports/messages.ts` |
| Estado del asistente | `features/database-exports/wizard/use-database-export-wizard.ts` |
| Pasos (vistas tontas) | `features/database-exports/wizard/steps/` |
| Bandas de aviso | `features/database-exports/components/Callout.tsx` |
| Página y ruta | `features/database-exports/pages/DatabaseExportWizardPage.tsx` · `/database-exports` |

Se entra desde la acción **"Exportar"** de cada fila de `ServerDatabasesPanel`
(`/servers/:serverId?tab=databases`) y desde la pestaña "Resumen" de `ServerDatabaseDetailPage`.
No tiene entrada de sidebar, y no por simetría con `collation-conversions`: el formulario entero se
deriva de las capacidades de una base concreta, así que una pantalla sin `?serverId=&database=` no
tendría ni un control que pintar.

## El flujo, en una pasada

```
GET  .../export-capabilities           → de aquí sale TODO el formulario
POST .../database-exports              → crea el plan (al salir del paso 1)
GET  /database-exports/{id}/objects    → árbol del catálogo
POST /database-exports/{id}/resolve-selection   → cierre de dependencias (sin congelar)
POST /database-exports/{id}/preview  dry_run_only:true   → panel vivo, en cada cambio
POST /database-exports/{id}/preview                      → CONGELA + emite confirm_token
POST /database-exports/{id}/execute    → encola
GET  /database-exports/{id}            → polling cada 2,5 s
GET  /database-exports/{id}/manifest   → checksum, tamaño, objetos
GET  /database-exports/{id}/download   → el archivo (UN SOLO USO)
```

**El plan se crea al salir del paso 1, no al final.** El catálogo de objetos cuelga del job
(`/database-exports/{id}/objects`), así que sin plan no hay paso 2. Da igual que el usuario cambie el
formato después: el `preview` reemplaza el spec del plan.

## Las seis trampas del contrato, y cómo se resuelven acá

### 1. Son dos conjuntos, no una lista con una casilla "incluir datos"

`selection` es qué objetos llevan su **DDL**; `data`, de qué **tablas** salen las filas. Con la
restricción `data ⊆ selection`. El árbol tiene por eso **dos columnas de casillas** por fila, y la
de datos solo existe en las tablas (una vista no tiene filas) y se deshabilita si la de estructura
está apagada.

La excepción: si `scope_ddl` **y** `entity_ddl` están ambos en `NONE`, la exportación es **"solo
datos"** y la restricción no aplica — es el caso de recargar una tabla que ya existe en el destino, y
la única forma en que `csv`/`json`/`ndjson` pueden existir. En ese modo la columna de estructura
desaparece entera (`wizard.dataOnly`).

Cuando el usuario marca datos de una tabla cuya estructura quedó fuera, `findDataWithoutStructure` lo
detecta en el cliente y se ofrecen las **dos salidas** que el contrato sugiere, en vez de esperar el
422: agregar esas tablas a la estructura, o pasar a "solo datos".

### 2. `scope_ddl`/`entity_ddl` son un enumerado de cuatro valores, no dos casillas

`NONE` | `CREATE` | `DROP_CREATE` | `CREATE_IF_NOT_EXISTS`. El backend usa un enumerado precisamente
para que el estado *"eliminar sin crear"* **no sea representable**; dos casillas en la UI lo volverían
a representar y el usuario podría pedirlo. Y `DROP_CREATE` y `CREATE_IF_NOT_EXISTS` **no son
opuestos**: la primera dice «que quede exactamente esto, destruyendo lo que haya», la segunda «que
exista, sin tocar lo que ya está».

Cuál de esos valores es destructivo **no está escrito en el frontend**: sale de
`capabilities.options["structure.scope_ddl"].destructive`. Y `DROP_CREATE` exige teclear el nombre
real de la base en `confirm_scope_drop` — un campo que aparece solo cuando la matriz lo marca como
requerido, y nunca preseleccionado.

### 3. La matriz de compatibilidad se evalúa, no se copia

`evaluateExportMatrix` (en `logic.ts`, ~40 líneas, sin conocer ninguna opción) devuelve tres cosas:

- **`constraints`** por ruta de opción → deshabilita controles (`forcedNeutral`), entradas concretas
  del select (`forbiddenValues`) y marca campos obligatorios (`required`), mostrando los `reason` del
  backend **tal cual, sin reescribirlos**.
- **`violations`** → impide el envío.
- **`advisories`** → las reglas con `blocking: false`: se muestran, no deshabilitan nada.

Tres detalles que hacen falta para que funcione:

- La clave `engine` de `when` se compara contra `capabilities.engine`, **no** contra el spec: la
  matriz viaja entera, con las reglas de otros motores, y filtrarlas es trabajo del cliente.
- `"structure.*"` se expande contra las **claves reales de `capabilities.options`**, no contra una
  lista escrita a mano: así el comodín sigue cubriendo el grupo entero si el backend agrega una
  opción.
- El grupo de opciones propio de un formato (hoy `csv.`) se detecta porque **su nombre coincide con
  el de un formato declarado**. Es una regla, no un hardcode: si mañana existen opciones `parquet.*`,
  aparecen solas.

Y la pieza menos obvia, `normalizeSpecForConstraints`: elegir `csv` **apaga de verdad** los valores
prohibidos en vez de dejarlos vivos detrás de un control deshabilitado. Un valor vivo se envía igual
y el 422 llega de todas formas.

> Como el servidor evalúa exactamente lo mismo, un 422 `export.incompatible_option` que llegue de
> todos modos es un **bug de nuestro evaluador**, no un error del usuario. `logExportFailure` lo
> registra en consola diciéndolo con esas palabras.

### 4. La consistencia es asimétrica por motor

| Motor | Datos | Estructura |
|---|---|---|
| PostgreSQL | consistente | **consistente** |
| MySQL / MariaDB | consistente | **NO consistente** |

En MySQL/MariaDB el snapshot de InnoDB es MVCC de filas: el diccionario de datos no participa, y
congelarlo exigiría bloquear las escrituras del servidor entero (la misma limitación que
`mysqldump --single-transaction`).

El backend lo avisa en `preview.warnings`. **Se muestran todos los warnings, no el primero**
(`WarningList`): ahí viven a la vez ese aviso, las tablas sin clave primaria, el `.zip` implícito y
los filtros `where` definidos para tablas que no están en la selección de datos. Ocultar ese aviso
sería el peor bug de esta pantalla.

Si el job termina con `structure_drift_detected: true`, el esquema cambió **durante** la corrida:
banda ámbar junto a la descarga. No invalida el artefacto —los datos siguen siendo consistentes— pero
el operador tiene que enterarse.

### 5. `complete: false` no significa "parcial" por sí solo

`GET /manifest` responde también sobre un job que todavía no terminó, y ahí `complete` es `false`
simplemente porque aún no hay nada completo. La regla correcta —y la razón de que
`isPartialArtifact` exista como función en vez de leerse a mano— es:

> **artefacto parcial ⇔ el `status` es terminal Y `complete === false`**

Leerlo a secas pintaría una banda roja de "artefacto parcial" sobre una exportación que va
perfectamente. La otra fuente es la cabecera `X-Export-Complete` de la descarga, que tiene **tres**
estados: ausente es *desconocido*, no *parcial*.

### 6. El artefacto es de un solo uso, y hay dos vencimientos distintos

- El del **PLAN**: 24 h (`limits.plan_ttl_hours`), afecta a `preview`/`execute`.
- El del **ARTEFACTO**: 30 min desde que el job termina (`limits.artifact_ttl_minutes`), afecta a
  `download`/`content`.

La descarga borra el archivo al completarse: un segundo intento es `410
export.artifact_consumed`. Por eso **antes del clic** se dice que solo se puede bajar una vez, cuánto
TTL queda (`useCountdown` sobre `manifest.expires_at`, no un temporizador local: el TTL empieza a
correr en el servidor) y que cada descarga queda auditada. El botón se deshabilita mientras la
petición está en vuelo: el rate limit es 3/min y dos clics ya gastan dos.

## Decisión propia: el preview autoritativo va encadenado a la ejecución

El contrato ofrece dos previews: el `dry_run_only: true`, que valida y reporta sin congelar nada, y
el autoritativo, que congela la selección y emite el `confirm_token`. El asistente usa el primero
para el panel vivo de consecuencias en cada cambio del formulario, y **encadena el segundo con
`execute`** al pulsar "Exportar", igual que la [consola SQL](sql-console.md) encadena su preview:
así el token viaja recién emitido y el `409 export.fingerprint_changed` se vuelve raro.

La contrapartida es real y está resuelta: ese preview puede devolver algo **distinto** de lo que el
usuario acababa de leer (el catálogo cambió entre medias), y ejecutar entonces sería hacerle confirmar
una exportación que nunca vio. Se comparan las dos huellas (`previewSignature`: avisos, objetos en
orden con sus banderas, tablas con datos y viabilidad de la entrega en línea) y, si difieren, la
ejecución **se para**: `pendingReview` queda puesto, el paso muestra el preview nuevo y hace falta un
segundo clic explícito. El admin confirmó una exportación concreta, no un cheque en blanco.

No entra `estimated_bytes` en la huella: es una estimación gruesa que puede moverse sola entre dos
lecturas del catálogo, y hacer que eso pare una exportación sería ruido, no seguridad.

## El riesgo que la interfaz tiene que mostrar: no hay enmascarado

El módulo **no tiene enmascarado ni anonimización de datos**: lo que sale, sale en claro. No es un
descuido, es un alcance decidido y registrado. Los controles compensatorios son la confirmación de
doble factor, el TTL corto, la descarga de un solo uso y —sobre todo— **la auditoría de cada
descarga**.

Consecuencias concretas en el código:

- `PlainDataNotice` es una banda **permanente**, no un tooltip, en el paso de confirmación y junto al
  botón de descarga. Un tooltip se descubre por accidente; esto tiene que leerse antes de decidir.
- **Nunca se renderiza el contenido del artefacto en pantalla "para revisar".** La única vía de
  lectura es `/content`, que también audita, tiene tope y consume el artefacto. `preview.sample` es
  hoy siempre `null` y el contrato pide expresamente no construir una vista previa del contenido.
- El modo "solo estructura" (`data.mode: 'none'`) es el **default** del formulario: es el caso
  seguro, y quien necesita datos sabe que los necesita.

## El kill switch no cubre los 12 endpoints, sino 8

`EXPORT_ENABLED=False` responde `409 export.disabled` en capacidades, crear plan, catálogo, resolver
selección, preview, ejecutar, descargar y contenido. Quedan **fuera a propósito** los cuatro de
observación y freno: leer el job, los ítems, el manifiesto y **cancelar**.

El motivo: si se apaga el módulo mientras hay un job corriendo, el operador tiene que poder verlo y
detenerlo — bloquear la cancelación sería lo contrario de lo que el kill switch persigue. Consecuencia
práctica en el código: **`MonitorStep` no se desmonta al recibir un `export.disabled` en otra
llamada**, y `OriginStep` presenta ese código como un `EmptyState` explicativo, nunca como un
`ErrorState`: es una decisión de configuración, no un fallo.

## Diagnóstico

`detail.public_context.code` es estable y **se ve también en producción**, a diferencia de
`detail.context`. Es lo que hace que `classifyExportError` decida el CTA de recuperación por código y
no reconociendo fragmentos del mensaje con expresiones regulares, como tuvo que hacer
`database-clones`. El `code` se extrae en `lib/api/errors.ts` (`ApiError.code`), junto con el contexto
tipado del módulo (`ApiError.exportContext`).

De todo fallo se guarda el **`X-Request-ID`** (`logExportFailure`): es la única forma de que el
backend correlacione un job fallido con su traza, porque el campo `error` del job es deliberadamente
acotado y nunca trae el mensaje del motor.

`warnAboutUnhandledErrorCodes` compara `capabilities.error_codes` con lo que `messages.ts` traduce y
avisa en consola de los que falten. El contrato expone esa lista justamente para eso: que el mapa de
mensajes falle de forma ruidosa —en el log, no en la cara del usuario— cuando el backend agrega uno.

## Pendiente del lado del backend

Nada de esto se ha ejercitado contra una instancia real. Los puntos concretos a confirmar están en
[`api-coverage.md`](api-coverage.md#pendiente-de-verificar-contra-el-backend-real); los tres que
más pueden mover el contrato son la forma de `excluded_by_dependency` (el documento solo la muestra
como array vacío), si `advisory` comparte forma con `edges`, y si `when` de la matriz puede traer
booleanos además de texto.
