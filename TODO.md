# TODO — database-api-gateway-frontend

> **Espejo detallado de las tareas de ClickUp.** Este archivo es la fuente de verdad del
> **detalle**; ClickUp es la fuente de verdad del **estado** y de **quién** está trabajando.
> El protocolo completo está en la skill `clickup-task-flow-frontend`. No se trabaja nada sin
> pasar por ahí.

## Tarea principal en ClickUp

| Campo | Valor |
| --- | --- |
| **Task ID** | `86e2xzf9d` |
| **URL** | https://app.clickup.com/t/86e2xzf9d |
| **Espacio** | Cero208 (`90172691192`) |
| **Carpeta** | Desarrollo (`901710687203`) |
| **Lista** | Database Gateway (`901716272178`) |
| **Workspace** | `9017559023` |

**Tablero compartido con el backend, a propósito.** El ciclo
`update required → in progress (fe) → complete (fe)` ocurre sobre **la misma subtarea** que el
backend dejó lista. Por eso la entrada natural de trabajo acá es el estado `update required`, no
`to do`: los ítems en `to do` son backlog del backend y no se tocan desde este repo.

---

## 🔵 Handoff pendientes — esperando frontend

Tareas en `update required`: el backend terminó y **falta esta SPA**. Antes de implementar
cualquiera, leé el **último** comentario de la tarea: si es `HANDOFF INVALIDADO`, el backend está
cambiando el contrato ahora mismo y no hay que tocarla.

| # | Ítem | Resumen del handoff | Subtarea |
| --- | --- | --- | --- |
| T-260822-lz-clon-solo-datos-collation | Wizard de clonado: intención `data_only`, charset/collation y owner | El clon acepta `copy_intent: data_only`, selección declarativa por tipo/patrón con cierre por FK, charset/collation del destino validado, y owner de PostgreSQL. El **spec ahora se manda en el preview**, que lo congela. **Sin breaking changes** para la SPA actual (los contratos Zod no usan `.strict()`), pero hay **tres cambios de comportamiento** que el wizard tiene que absorber. Ver detalle abajo. | [86e2xzzyh](https://app.clickup.com/t/86e2xzzyh) |

### Detalle — T-260822-lz-clon-solo-datos-collation

**Endpoints cambiados**

- `POST /api/v1/database-clones/{id}/preview` — acá va el spec ahora, no en `create`:
  `copy_intent`, `structure`, `data`, `target_charset`, `target_owner_user_id`. Solo se aplica lo
  que viene en el cuerpo (un campo ausente deja el valor que el plan ya tenía). Devuelve los
  valores **efectivos** resueltos, `notices: [{code, message, severity, detail}]` y
  `blocking_issues`.
- `GET /api/v1/database-clones/{id}/objects` — acepta `?include_data_stats=true`; con eso cada
  objeto trae `row_estimate`, `row_estimate_known` y `has_primary_key`.
- `POST /api/v1/database-clones` — sin cambios obligatorios; `include_data` y `selection` siguen
  aceptándose como atajo legacy.

**Tres cambios de comportamiento a absorber**

1. `confirm_token` **puede llegar vacío** cuando hay `blocking_issues`: el plan se ve pero no se
   confirma. Hoy el wizard mandaría ese token vacío al `execute`.
2. Los **mensajes** de error cambiaron. `wizard/messages.ts` los matchea con expresiones regulares
   sobre la prosa (`/expiró/i`, `/cuarentena/i`); ahora hay **códigos estables `clone.*`** en
   `public_context.code`.
3. Todos los errores del módulo pasaron de `context` (dev-only) a **`public_context`**.

**Dos bloqueantes ya localizados en este repo**

- `WizardNav.tsx:41` bloquea el avance con selección de estructura vacía — que en solo-datos **es
  el modo**.
- La rehidratación de `use-database-clone-wizard.ts:366-412` devuelve un job `data_only` como
  `structure_and_data`. Es el fallo exacto que la feature arregla, y se recorre justo después de
  un `failed`.

**Qué hay que hacer**

1. Ofrecer las tres intenciones nombradas en `PlanStep` y derivar los ejes, con `data.on_existing`
   en `SelectionStep` (no antes de ver qué tablas tienen PK).
2. Arreglar los dos bloqueantes de arriba.
3. Migrar `messages.ts` de prosa a los códigos `clone.*`, y dar peso visual real a
   `blocking_issues` y a los notices peligrosos (hoy los warnings salen en gris `text-xs`).

**Contrato:** `backend/docs/features/database-clone.md` § Opciones del plan, § Guard de
compatibilidad del destino — commit `de73439`. Vocabulario cerrado de códigos y de `reason` en
`app/services/db_admin/clone_spec.py`.

**Límites del backend que vamos a sentir** (anotados por el backend como
`T-260822-lz-clon-contrato-frontend`): `CloneSummaryOut` **no expone el spec**, y `preview` da
`409` en cuanto el job deja de estar `pending` — así que después de un fallo no hay forma de
reconstruir cuál era el plan, justo cuando se usa «Replanear». Y `severity` solo tiene
`info|warning`, así que la lista de códigos peligrosos queda del lado del cliente.

**Nota:** el handoff menciona un plan de UI completo ya escrito, **fuera del repo**, y al agente
`frontend-planning`, que **este repositorio no tiene**. Hay que pedir ese plan antes de arrancar.

---

## 🟡 En curso

| # | Ítem | Ejecutor | Rol | Desde | Subtarea |
| --- | --- | --- | --- | --- | --- |
| T-260824-lz-collation-lote-y-version | Wizard de conversión de collation **en lote por blueprint**, panel de deriva y CTA de versión de contabilidad | LeoZubiri@outlook.com | frontend | 2026-08-25 | [86e2ywnrg](https://app.clickup.com/t/86e2ywnrg) |

### Detalle — T-260824-lz-collation-lote-y-version

**Contrato: `docs/api-reference-v17.md` del repo de backend — NO v14.** El handoff original
apuntaba a v14; un comentario posterior lo corrige. El número se reasignó al bajar cambios del
remoto porque v14, v15 y v16 ya estaban tomados. Si alguien empezó a leer v14 para esta tarea, ese
no es el documento.

**Seis endpoints nuevos** (todos bajo `/database-models/{id}`):

- `POST /collation-conversions` — planifica el lote: un job por BD activa, ya previsualizado, + `batch_token`
- `POST /collation-conversions/{batch_id}/execute` — confirma y encola
- `GET  /collation-conversions/{batch_id}` — polling del lote
- `POST /collation-conversions/{batch_id}/cancel` — frena lo que no arrancó
- `POST /collation-conversions/{batch_id}/blueprint-version` — versión de contabilidad
- `GET  /collation-drift` — deriva, sin conexiones al motor

**Cambiado:** `GET /collation-conversions/{id}` gana `batch_id`, `batch_seq`, `tables_total`,
`objects_total` — los cuatro **nullable**. **Sin breaking changes**: todo es aditivo y los
contratos Zod no usan `.strict()`.

**Dos trampas de contrato, antes de escribir un solo schema**

1. Cada campo nullable va `.nullable()`, **no** `.optional()`. `ApiResponse` filtra los `None`
   solo del envelope; los anidados salen como `null` explícito y Zod `.optional()` los rechaza. Es
   la causa raíz de `T-260822-lz-contratos-nullish`. Y el `safeParse` corre sobre el envelope
   entero: **una divergencia de un campo cuesta la respuesta completa**.
2. v17 supersede la afirmación del §3.0 de v8 de que este módulo no usa `public_context`. Los
   rechazos nuevos traen `public_context.code`. El parser no se toca: `errors.ts` ya lo extrae
   genéricamente. El §5 del contrato trae los **14 códigos con su texto en español ya redactado**
   — el mapa de mensajes sale de ahí, no se inventa copy.

**Lo que la UI tiene que decir, y son decisiones de producto, no de estilo**

- **`runs_serially`**: los jobs corren **en serie** (1 worker por default) y un lote de 12 tarda
  horas. Sin decirlo, el monitor parece colgado. `batch.counts` da el agregado y `batch_seq`
  permite mostrar "la 4 de 12".
- La confirmación pide **tres cosas juntas**: slug del blueprint, `database_ids` echado de vuelta,
  y el nombre re-tipeado de cada BD de entorno protegido (`requires_confirmation` viene en el 422).
- En deriva, **`unknown` NO es `ok`**: pintarlos igual afirmaría que todo está bien sobre bases de
  las que no se sabe nada. `source_note` va **textual** — es una caché, no el motor.
- El CTA de versión lleva `note` visible: la versión **se stampea y NO se aplica**.

**Limpieza que habilita el backend:** se puede borrar el `savedTotals` de
`use-collation-conversion-wizard.ts` — los totales ahora vienen del servidor y sobreviven la
recarga.

**No olvidar:** las filas nuevas de `docs/api-coverage.md` (ese archivo vive en este repo).

---


---

## 🔴 Pendientes — trabajo propio del frontend

Trabajo nacido en esta SPA que no viene de ningún handoff: fix visual, refactor de componente,
deuda de UI, regresión de accesibilidad. Se crean como `T-<YYMMDD>-<iniciales>-<slug>` colgando de
la tarea paraguas, y arrancan en `to do`. **Nunca** con el siguiente `P-XX` libre.

También van acá las tareas que quedaron **bloqueadas por backend** (`on hold` con un comentario
`BLOQUEADO POR BACKEND`), marcadas como tales.

| # | Ítem | Detalle | Estado | Subtarea |
| --- | --- | --- | --- | --- |
| T-260827-lz-placeholder-version-guard | `keepPreviousData` en `useModelMigration` **con** el guard de versión | Es la única query de la pantalla sin `keepPreviousData` (la convención del repo: 12 hooks lo tienen). **Las dos mitades van juntas:** hay tres escrituras que usan `data.version` —PATCH, DELETE y los enlaces de capturas— y con placeholder activo un clic en la ventana de carga actúa sobre la versión ANTERIOR, en un motor real. Hace falta `const stale = data.version !== version`, cerrar las acciones mientras `stale`, y un early return en `handleSubmitEdit`. Opcional en el mismo terreno: prefetch de la versión vecina al hover de las flechas (con retardo; el detalle puede rondar 1 MB). | 🔴 `to do` · high | [86e30jejc](https://app.clickup.com/t/86e30jejc) |
| T-260827-lz-prism-details-eager | El `<details>` de SQL traducido monta Prism eagerly | El coste de cambiar de versión no es la red: son **cinco** `CodeBlock` tokenizando con Prism en el render, tres de ellos dentro del `<details ... open>` de `ModelMigrationDetailPanel.tsx:476`. Con `up_sql` de hasta 256 KB, el peor caso es ~1 MB tokenizado en el hilo principal por clic. Quitar el `open` **no basta**: `<details>` cerrado sigue montando sus hijos en React, hay que montar `MigrationSqlView` condicionalmente. | 🔴 `to do` · normal | [86e30jep5](https://app.clickup.com/t/86e30jep5) |
| T-260827-lz-panel-colapsa-al-cambiar-version | El `return` temprano del panel colapsa el detalle y clampa el scroll | `ModelMigrationDetailPanel.tsx:182-192` devuelve un card de una línea mientras carga: miles de píxeles pasan a ~64 y vuelven, y si había scroll la página salta al principio. Arreglo: mantener la altura del `CodeBlock` y pintar el spinner dentro del card. Se descubrió al verificar la ficha — el card nuevo no salta, pero el salto seguía un card más abajo. | 🔴 `to do` · normal | [86e30jeqz](https://app.clickup.com/t/86e30jeqz) |
| T-260827-lz-badge-title-no-accesible | Barrido: el `title` de `Badge` no es texto accesible | `Badge.tsx:29` lo pone en un `<span>` no interactivo: no es nombre accesible, no se enfoca, y en táctil no existe. Auditar los `Badge` con `title` de toda la app y mover a `Callout` lo que decida algo. Ídem el patrón `<span title>` envolviendo un botón `disabled`. Ya resuelto en `VersionFactsCard` y `MigrationBadges`; esto es aplicarlo al resto. | 🔴 `to do` · low | [86e30jeww](https://app.clickup.com/t/86e30jeww) |
| T-260827-lz-pedir-applied-database-count | **Petición al backend:** `applied_database_count` en `ModelMigrationSummary` | Para poder decir «aplicada en 7 de 12» en vez de «pendiente en 4 de 12». El frontend NO puede derivarlo: `model_version >= version` no distingue aplicada de declarada (`stamp` con `force`, `adopt`, el alta declarando versión, versiones intermedias creadas después), y `pending_versions` sale del mismo escalar. El backend ya lo calcula en `_still_applied_cached`, dentro de `_policy_flags`, para cada fila del listado — y descarta el resultado. **NO está en `on hold`**: nada quedó trabado, la ficha se entregó sin el campo. | 🔴 `to do` · normal | [86e30jf6f](https://app.clickup.com/t/86e30jf6f) |

---

## 🟢 Realizadas

| # | Ítem | Qué se hizo | Qué quedó SIN verificar | Subtarea |
| --- | --- | --- | --- | --- |
| T-260828-ojoshuac-borrar-version-intermedia | Borrar una versión **intermedia** de un blueprint (v18) | Se puede eliminar **cualquier** versión, no solo la punta: `MigrationDeletePlanDialog` pide el `delete-plan` (veredicto **en vivo**, abre conexión a cada BD), muestra los `warnings[]` del contrato **sin resumir**, el renumerado y **una fila por escritura remota** antes de pedir nada, y confirma con `confirm_token` + reescritura de la versión. Los siete 409 se clasifican por `public_context.code`; el 422/410 dice que **el parque cambió**, no que el operador se equivocó. `deletable` se separó de `sql_frozen`, que ya no se mueven juntos. Dos hallazgos con alcance más allá de la feature, ya en `docs/maintenance.md`: `data: null` llega como **clave ausente** (`_exclude_none` + `data` requerido en `envelope()`) y un `z.enum` estricto sobre un vocabulario renombrable **tumba la respuesta entera**. | **Los tests no se ejecutaron** (política del repo): 27 casos escritos en 4 archivos, ninguno corrido. `typecheck`, `lint` (0 errores) y `build` sí pasan. **Nada probado contra el backend real**: los contratos de `delete-plan` y del `DELETE` se escribieron a mano desde el documento, así que una diferencia de forma fallará en runtime. La forma de `partial_applications[]` está **deducida**, no observada — el contrato solo compromete que cada entrada enlaza a `reconcile-partial`. Sin verificar ningún render en navegador, ni el 410 real por caducidad, ni el camino `data` ausente contra un gateway pre-v18. | [86e310tk5](https://app.clickup.com/t/86e310tk5) |
| T-260827-lz-ficha-version-blueprint | Ficha de la versión seleccionada en la pestaña «Versiones» del blueprint | Se eliminó `VersionsTable` **reponiendo lo que se llevaba**: vocabulario único de insignias en `migration-badges.ts` (el desplegable gana `sin rollback`, `no portable`, `SQL congelado` y `SQL editado`), nueva `VersionAlertsBar` con las listas filtradas y su consecuencia, y `VersionFactsCard` bajo el selector, que absorbe el «card delgado» del panel de detalle (−112 líneas). Adopción **sin derivar**: «pendiente en N de M» + los booleanos de `block_reason`. Entran tres arreglos que la ficha volvía peligrosos: invalidar `databases` al crear/borrar versión, invalidar `migrations` tras `apply-all`, y `confirmWord` en el borrado. | **Los tests no se ejecutaron** (política del repo): 48 casos escritos/actualizados en 7 archivos, ninguno corrido. `typecheck`, `eslint` y `build` sí pasan. **Nada probado contra el backend real** — en particular `pending_versions` para BDs sin `model_version`, y el 404 del detalle que dispara la banda «esta versión ya no existe». Sin verificar en `< md` ni con lector de pantalla real. | [86e30hemx](https://app.clickup.com/t/86e30hemx) |
| T-260822-oc-projects-agrupar-blueprints | Módulo Proyectos: dos pestañas en la vista de blueprints | Feature `src/features/projects/` completa (9 endpoints de la v16). `/database-models` pasa a tener dos pestañas —«Proyectos» por defecto y «Blueprints» con el catálogo completo— y el detalle del proyecto vive en `/projects/:projectId`. Vista inversa dentro de la pantalla del blueprint. | **Los tests no se ejecutaron** (política del repo): 6 casos escritos en `use-projects.test.tsx` + ampliación de `errors.test.ts`, ninguno corrido. **Nada probado contra el backend real**: los contratos Zod se escribieron a mano desde la v16, así que una diferencia de forma fallará en runtime. Sin comprobar que `description` viaje como `null` explícito dentro de `data`. | [86e2y0zq9](https://app.clickup.com/t/86e2y0zq9) |
| T-260824-ojoshuac-editar-version-aplicada | Editar el SQL de una versión ya aplicada (doble factor) | El 409 `sql_frozen` se clasifica por código y ofrece dos salidas si trae `override_available`. La segunda abre el flujo de dos pasos (`edit-preview` → confirmación) con la lista de BDs divergentes, cuenta atrás del token e insignia `sql_diverged`. Corregido el copy que negaba que `down_sql` fuera editable. **Reapertura del mismo día:** auditoría contra el checklist de la §7 que cerró tres huecos — `incomplete_progress` para nombrar la BD del 409 parcial, los efectos colaterales de la §4.bis en el paso 1, y el aviso del reseteo de `reviewed` al editar el rollback de una versión que captura. | **Los tests no se ejecutaron**; además **no se escribieron tests de componente del flujo de dos pasos** — es lo que más falta. **Nada probado contra el backend real**: no se ha visto una respuesta real de `edit-preview`. Sin verificar el camino `requires_confirmation: false` ni el 410 real por caducidad. La forma de `incomplete_progress` se leyó del código del backend (`incomplete_progress_for_migration`), no de una respuesta real. | [86e2z0gmj](https://app.clickup.com/t/86e2z0gmj) |

### Detalle — T-260827-lz-ficha-version-blueprint

Trabajo propio del frontend. Pantalla: `/database-models/:modelId/migrations`, pestaña
«Versiones» (`src/features/database-models/pages/BlueprintMigrationsPage.tsx`).

**Los dos problemas que resuelve.** (1) Las insignias de una versión viven en **tres** sitios con
vocabularios ya divergidos: el `renderItem` del `Combobox` en `VersionNavigator` (7 insignias, sin
`no portable`, `SQL congelado`, `SQL editado` ni `sin rollback`), la fila de `VersionsTable` (8) y el
«card delgado» del `ModelMigrationDetailPanel` (5). (2) No hay ficha de la versión seleccionada:
`updated_at` no se muestra en **ninguna** pantalla de la app, aunque es el dato que le da sentido a
la insignia `⚠ SQL editado tras aplicarse`.

**Qué se hace.** Se elimina `VersionsTable` **reponiendo lo que se lleva**: el Combobox gana las
insignias que le faltaban y aparece una `VersionAlertsBar` con chips contadores («2 sin revisar»,
«3 sin rollback») que despliegan la lista de esas versiones — es el destino al que apuntan los dos
textos que hoy mandan «a la tabla de versiones» (`ApplyMigrationsDialog` y, la fuente real del
mensaje, `capture.ts`). Bajo el selector va `VersionFactsCard`, que **absorbe el card delgado**.
Vocabulario único en `MigrationBadges`.

**La decisión que más importa: NO se cuenta «aplicada en N de M BDs».** La regla
`model_version >= version` no distingue *aplicada* de *declarada*. `pending_versions` **no** es una
señal independiente: el backend la calcula del mismo escalar
(`database_model_controller.py:210-217`). Y hay cinco caminos que escriben `model_version` sin
ejecutar una sentencia — alta declarando versión, `adopt`, `stamp` (con `force`), versiones
intermedias creadas después (nada exige que la versión sea > max) y punta borrada y recreada —, así
que una BD registrada y **vacía** contaría como aplicada. El backend define «aplicada» como
conjunción de fila de historial `status=applied` **y** alcance de versión
(`model_migration_controller.py:307-321`) y **decidió no publicar los insumos**, por escrito
(`:400-407`): «se devuelve la DECISIÓN, no sus insumos… si no, tendríamos la misma política escrita
a los dos lados del contrato».

Por eso la ficha se queda con lo que el backend sí afirma: **«pendiente en N BDs»**
(`pending_versions.includes(version)`, lectura directa) y los dos booleanos por versión del
summary — `block_reason === applied` («vigente en alguna BD») y `block_reason === partial`. **No**
se usa `has_partial_application`: es por BD, no por versión, y atribuiría a la versión seleccionada
un parcial de otra.

**Bloqueo al backend, en paralelo:** pedir `applied_database_count` (o `applied_database_ids`) en
`ModelMigrationSummary`, calculado con `_still_applied_cached` — que **ya corre** dentro de
`_policy_flags` para cada fila del listado y cuyo resultado se descarta. Coste marginal ≈ 0.

**Tres arreglos que entran porque la ficha los vuelve peligrosos.**

1. `useCreateModelMigration` y `useDeleteModelMigration` invalidan solo `migrations(modelId)`; la
   clave de las BDs es `[database-models, id, databases]` — tercer elemento distinto, sin
   prefijo común. Pero el backend calcula `pending_versions` desde el catálogo de versiones, así que
   crear o borrar una versión mueve el pendiente de **todas** las BDs. Hoy no se nota porque el
   número no se muestra. → `invalidateDatabaseViews`, que ya está importado en ese archivo.
2. `useApplyAllMigrations` no invalida `migrations(modelId)`, y el apply cambia `deletable` /
   `block_reason` / `sql_frozen`: sin eso **la ficha ofrece «Eliminar» habilitado sobre una versión
   recién aplicada**.
3. El `ConfirmDialog` del borrado no pasa `confirmWord`, aunque lo soporta. El scroll por todo el
   SQL *era* la fricción; al subir el botón hay que reponerla.

Y dos guardas de la propia ficha: las **mutaciones van cerradas si el detalle no está `success`**
(la versión puede haber desaparecido y quedaría una ficha entera con acciones activas sobre una
versión fantasma), y **ninguna fila aparece o desaparece según la carga** — en un card de hechos la
ausencia se lee como un hecho, así que «editada» existe siempre, con esqueleto de alto fijo y
«sin ediciones» explícito.

**Detalle físico que condiciona el layout:** el menú del `Combobox` es `absolute`, `max-h-60`
(240 px) y `z-30`, y se cierra al seleccionar. Nada destructivo puede vivir en esa franja: el botón
de borrar va al **pie** de la ficha, `danger-soft`, con el número de versión en el texto y el motivo
del bloqueo como texto visible (no como `title` de un `<span>`, que no funciona con teclado ni en
táctil).

**Aviso de catálogo recortado:** `PAGINATION.maxSize` es **50**. Con 51+ versiones,
`latestVersionOf(sorted)` puede no ser la punta real, así que «más reciente» y la pista `not_tip`
mentirían al lado del botón de borrar. Cuando `total > sorted.length` se avisa y `latestVersion` va
como `null`.

**Fuera de alcance — tareas nuevas `T-…` a abrir:** (a) `placeholderData: keepPreviousData` en
`useModelMigration` **junto con** el guard `data.version !== version` en PATCH, DELETE y los enlaces
de capturas — sin el guard, un clic en la ventana de placeholder actúa sobre la versión anterior en
un motor real, así que no se entrega lo uno sin lo otro; (b) el `<details ... open>` que monta
`MigrationSqlView` eagerly y paga 3 de las 5 tokenizaciones de Prism en cada cambio de versión, con
`up_sql` de hasta 256 KB por bloque; (c) el `return` temprano del panel, que colapsa miles de
píxeles a ~64 y clampa el scroll al principio; (d) el `title` de `Badge` como texto no accesible,
transversal a toda la app.

**No olvidar:** `docs/api-coverage.md` (filas de `GET .../databases` y de `BlueprintMigrationsPage`,
más las de aprobar baseline y del `DELETE`, cuya superficie cambia de componente) y
`docs/data-flow.md`.

### Detalle — T-260822-oc-projects-agrupar-blueprints

**Qué se pidió.** La vista de blueprints pasa a tener **dos pestañas**: «Proyectos» (lo primero
que se ve; de ahí se entra a los blueprints asignados) y «Blueprints» (el catálogo **completo**,
tengan proyecto o no). Cada pestaña con sus acciones propias.

**Qué es un proyecto.** Nombre + descripción + una lista de blueprints, en relación **N:M**. No
tiene servidor, ni credenciales, ni versión, ni entorno. **No toca ningún motor de BD**: es
organización pura. Un blueprint puede estar en varios proyectos, en uno, o en ninguno.

**Los 9 endpoints** (ninguno nuevo — nunca se habían documentado para frontend):

- `GET /api/v1/projects` — paginado, con `blueprint_count` ya calculado (una sola query por página)
- `POST /api/v1/projects` → 201
- `GET /api/v1/projects/{id}`
- `PATCH /api/v1/projects/{id}` — parcial de verdad
- `DELETE /api/v1/projects/{id}` — **no borra blueprints**
- `GET /api/v1/projects/{id}/blueprints` — **sin paginar**
- `POST /api/v1/projects/{id}/blueprints` — idempotente y todo-o-nada
- `DELETE /api/v1/projects/{id}/blueprints/{model_id}`
- `GET /api/v1/database-models/{model_id}/projects` — vista inversa, **sin paginar**

**La regla dura que la UI tiene que comunicar.** Borrar un proyecto **NO borra blueprints**: borra
la entidad y sus vínculos. Está implementada en tres capas del backend, con tests en los dos
sentidos. Consecuencia de diseño: el `DELETE` **no** es destructivo y **no** pide confirmación por
nombre — un `confirm()` simple alcanza. Tratarlo con el ceremonial de re-tipear el nombre le
enseña al operador que todo es peligroso y desgasta la fricción donde sí hace falta.

**La trampa más importante del módulo.** `POST /projects` con `model_ids` inválidos devuelve
**422 `project.blueprints_not_found`** pero **el proyecto YA quedó creado**, vacío. Reintentar el
alta da **409 `project.name_taken`**. Recomendación del contrato: mandar el alta **sin**
`model_ids` y vincular en una segunda llamada.

**Dos pares de códigos que NO son intercambiables:**

- `project.name_taken` (409) vs `project.link_conflict` (409) — el primero se arregla cambiando un
  dato que el usuario escribió; el segundo, **repitiendo la misma llamada**. Ofrecer «reintentar»
  en el primero manda al usuario a un bucle.
- `project.blueprint_not_linked` (404) vs `project.blueprint_not_found` (404) — el primero es la
  **relación**, el segundo el **recurso**.

**Otras reglas.** `already_linked` es **éxito**, no advertencia (es lo que hace la vinculación
reintentable). `description: null` **vacía** la descripción; `""` guarda cadena vacía. No poner
paginador en los dos endpoints que no la aceptan. Clasificar siempre por
`detail.public_context.code`, **nunca** por `detail.context` (solo llega en `development`).

**Contrato:** `docs/api-reference-v16.md` (checklist de SPA en §5).
**Plan de UI:** `docs/frontend/plan-proyectos.md` — 6 vistas, wireframes, estados, copy propuesto,
matriz de errores → CTA y 6 preguntas abiertas en §8.

### Detalle — T-260824-ojoshuac-editar-version-aplicada

**Qué se pidió.** Poder **editar el SQL de una versión de blueprint que ya está aplicada** en una
o más BDs. Hoy eso da 409 `model_migration.sql_frozen` sin salida. El freeze sigue siendo el
default; lo que se agrega es la **única vía para atravesarlo**.

**Endpoints:**

- `POST /api/v1/database-models/{id}/migrations/{version}/edit-preview` — **NUEVO**. Body: los
  mismos campos de SQL que va a llevar el PATCH. Devuelve `requires_confirmation`,
  `blocking_databases[]` (leído **del motor**), `confirm_token`, `expires_at`,
  `resulting_checksum`. Rate limit 20/min.
- `PATCH .../migrations/{version}` — dos campos **opcionales** nuevos: `confirm_version` y
  `confirm_token`. **Van los dos o no va ninguno.**
- Listado y detalle de versiones — campo nuevo `sql_diverged` (bool).

**Doble factor, no un switch.** La segunda salida del 409 es un **flujo de dos pasos**
(preview → confirmar) que muestra `blocking_databases[]` **antes** de pedir la confirmación. Un
botón «Forzar» de un click convierte en trámite algo irreversible.

**⚠️ `down_sql` NO está congelado** (v15 §4.bis). El freeze mira **solo** `up_sql` y los overrides
por motor. `down_sql` se puede editar **siempre**, incluso con `sql_frozen: true` y sin ningún
factor de confirmación. No es un descuido: confirmar el rollback después de aplicar es un flujo
soportado. **Si la UI deshabilita el formulario entero cuando `sql_frozen` es true, cierra la
única salida de ese otro 409 y deja la versión sin forma de revertirse nunca.**

**El malentendido más probable de toda la feature.** Editar `up_sql` **no re-ejecuta nada**. Las
BDs listadas en `blocking_databases[]` **conservan físicamente** lo que ya se les aplicó y siguen
necesitando corrección **por otra vía** (para collation, el módulo de conversión — tarea
`86e2ywnrg`). La pantalla de confirmación tiene que decirlo explícitamente.

**Token.** Reenviar en el PATCH **el mismo SQL** que se mandó al preview; si el usuario lo retoca,
volver a pedir preview (si no, 422). El **410** (vencido) y el **422 sin code** (el token no
corresponde al SQL/versión) no llevan `code` — salen del servicio de tokens, compartido. Se
clasifican por **status**, y en los dos casos el CTA es el mismo: **volver a pedir el preview**.
**Nunca re-previsualizar en silencio:** el usuario tiene que volver a ver a quién deja divergente.

**`sql_diverged`** se muestra como **insignia informativa**. **NO** deshabilitar acciones por ella:
no restringe nada.

**Corrección a la v14.** Ese documento decía «No hay force» y «No ofrecer ‘Forzar’: ninguno de los
dos 409 tiene escape». Sigue siendo cierto para `model_migration.still_applied` (el DELETE), pero
**ya no** para `model_migration.sql_frozen` (el PATCH): ese 409 ahora trae
`public_context.override_available: true`.

**Contrato:** `docs/api-reference-v15.md` — commit `89380ce` (checklist de SPA en §7).
**Plan de UI:** `docs/frontend/plan-editar-version-aplicada.md` — 6 vistas, wireframes, estados,
copy literal de los 11 mensajes delicados, ciclo de vida del `confirm_token`, tabla «Qué revisar si
ya se implementó según v14» y 7 preguntas abiertas en §8.

**Sigue sin resolverse (dicho por el backend).** No hay endpoint público de auditoría, así que la
UI **no puede** explicar qué bases divergieron históricamente ni cuándo — solo lo que vio en el
preview de esa sesión. Es lo que convertiría `sql_diverged` de insignia en explicación. Si hace
falta, hay que abrir tarea.

**Fuera de alcance de esta tanda:** `86e2yx2pq` (desbloquear versión no aplicada), por decisión
del usuario. Describe **el mismo 409**: aporta `blocking_databases[]` con su vocabulario de
`reason` y el CTA fino entre fix-forward y revertir.

**La columna "Qué quedó SIN verificar" no es opcional.** En este repo los tests **no se ejecutan
por rutina** (ver «Tests: escribirlos sí, ejecutarlos no» en `CLAUDE.md`), así que es normal que
algo quede sin probar. Lo que no es aceptable es que no esté dicho. Si escribiste tests y no los
corriste, se anota así, con todas las letras.

---

### Detalle — T-260828-ojoshuac-borrar-version-intermedia

**Contrato: «API Reference v18 — Eliminar una versión intermedia de un blueprint»** del repo de
backend. Continúa la v14 (que fijó el criterio «aplicada hoy») y **convive** con la v15: el freeze
de la *edición* no cambia, solo el del *borrado*.

**No hubo tarea de handoff del backend para este contrato.** Por eso esta se abre acá con ID
`T-…` en vez de reclamar una en `update required`, y queda **vinculada a
[86e2yx2pq](https://app.clickup.com/t/86e2yx2pq)** (v14), cuya mitad de borrado v18 reescribe.

**El límite que ataca:** solo se podía borrar la **punta**. Una versión intermedia que ya no
describía nada útil no tenía forma de salir del blueprint.

**Qué hace el borrado ahora**

1. La versión desaparece. Las posteriores **bajan un escalón** (`0016`→`0015`); las anteriores no
   se tocan.
2. A las BDs que están **adelante** se les mueve el puntero a la etiqueta nueva de **la misma**
   migración. Una BD en `0020` queda en `0019`: **no retrocede de esquema, sigue un renombre**.
3. **No se ejecuta ningún SQL. No es un rollback.** Las BDs que ya aplicaron esa versión conservan
   **FÍSICAMENTE** sus objetos y el borrado **no los revierte** — la cadena simplemente deja de
   describirlos. Es el primero de los `warnings` del plan, y no es opinable.
4. Mover el puntero **escribe dentro de cada base gestionada** (`UPDATE` de la tabla de versión de
   Alembic, con conexión y advisory lock). **No es una operación local del gateway**, y por eso ese
   caso exige `confirm_token` y va marcado 🔌.

**Endpoints**

- `GET .../migrations/{version}/delete-plan` — **NUEVO**. Preview autoritativo: abre conexión a
  cada BD, así que manda sobre las banderas del listado, que salen de caché. Trae `deletable`,
  `renumber[]`, `stamp_plan[]`, `blockers[]`, `unstampable[]`, `partial_applications[]`,
  `requires_confirmation`, `confirm_token` (TTL 2 min), `expires_at` y `warnings[]`.
- `DELETE .../migrations/{version}` — gana el query param `confirm_token` (obligatorio **solo** si
  el plan mueve punteros; borrar la punta sin BDs adelante sigue funcionando sin token) y deja de
  responder vacío: ahora trae `renumbered[]` y `stamped[]`.

**Cambios de contrato que rompían supuestos de la SPA**

- `block_reason`: `"not_tip"` **eliminado**; el vocabulario v18 es `"in_use"`, `"partial"`, `null`.
  El enum de Zod del repo declaraba `['applied','partial','not_tip']`, y **un enum de Zod rechaza
  el valor desconocido y tumba la respuesta entera del listado** — por un texto de ayuda. Se dejó
  tolerante (`['in_use','partial','applied','not_tip']`) para que un gateway sin actualizar no
  rompa la pantalla.
- `deletable` **deja de moverse junto a `sql_frozen`**, y no es un bug: una versión con una BD
  *adelante* tiene `sql_frozen: true` (describe lo que ya corrió allí) y `deletable: true` (el
  borrado le mueve el puntero). Ningún control puede derivar una bandera de la otra.
- `delete_requires_stamps` — **NUEVO**. Marca el botón con 🔌, pero es **pista de caché, no
  veredicto**: el autoritativo es `delete-plan`. La divergencia va siempre en la dirección «el
  listado ofrece el botón y el plan después lo rechaza», nunca al revés.
- El 409 del DELETE pasa de `model_migration.still_applied` (`>=`) a
  `model_migration.version_in_use` (`==`). `still_applied` queda como `reason` de la **edición**:
  los dos criterios **divergen a propósito**.

**Un hallazgo del envelope que valía la tarea entera.** `envelope()` declara `data` como clave
**requerida**, y `ApiResponse._exclude_none` del backend **omite del envelope las claves nulas de
primer nivel**. O sea: el `data: null` de un gateway pre-v18 no llega como `null`, llega como
**clave ausente**, y un `.nullable()` a secas habría convertido un borrado **ya ejecutado** en «La
API devolvió una respuesta inesperada». Se resolvió con `.nullable().optional()` normalizado a
`null`.

**Errores clasificados por `public_context.code`** — nunca por la prosa del `message`, que no
transcribe el error del motor a propósito (puede llevar host, usuario o fragmentos de sentencia):
`version_in_use`, `unreadable_databases` (fail-closed: es un problema de acceso a esa BD, **no**
del blueprint), `renumber_confirmation_required`, `renumber_stamp_failed` (en los dos casos el
blueprint **no se modificó**: con `compensated: true` todo volvió a su lugar; si no, `left_moved[]`
lista **solo** las BDs mal marcadas, que necesitan un `stamp` manual antes de reintentar),
`renumber_target_missing` y `affected_partial_application`. El 422/410 del token no lleva `code`
y significa que **el parque cambió** —un apply concurrente— así que el plan congelado ya no
describe la realidad: se vuelve a planificar, y el texto no culpa al operador.
