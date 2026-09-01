# Cobertura de la API en la interfaz

Mapa endpoint → dónde se usa en la UI. Sirve para responder de un vistazo *"¿esto ya
está integrado y desde qué botón se dispara?"* sin volver a auditar el código.

> **Numeración**: la del apéndice "tabla resumen de endpoints" del contrato del backend
> (`backend/docs/api-reference.md`). 🔌 = toca el motor destino.
>
> **Convención de estados**:
>
> | Estado | Significado |
> |---|---|
> | ✅ | Integrado con superficie de UI (hay un botón/pantalla que lo dispara). |
> | 🧩 | Existe en la capa `api/`+`hooks/` pero ningún componente lo consume todavía. |
> | ⛔ | No integrado, **por decisión** (ver la nota de cada fila). |
>
> Regla: si añades un endpoint al frontend, añade su fila acá en el mismo PR (ver la
> convención de [`README.md`](README.md)).

## Autenticación y salud

| # | Endpoint | Estado | Dónde |
|---|---|---|---|
| 3 | `POST /auth/login` | ✅ | `LoginPage` (`/login`) |
| 4 | `POST /auth/logout` | ✅ | `Topbar` → "Cerrar sesión" |
| 5 | `GET /auth/me` | ✅ | `ProtectedRoute` (guarda de sesión) + `Topbar` |
| 2 | `GET /health/ready` | ✅ | `HealthBadge` en el `Topbar` (poll 30 s, `VITE_HEALTH_URL`) |
| 1 | `GET /health` | ⛔ | Liveness pensado para *probes* de orquestador; la UI no aporta nada mostrándolo. El schema existe en `contracts/health.ts` por si se necesita. |

## Servidores

| # | Endpoint | Estado | Dónde |
|---|---|---|---|
| 6–10 | CRUD de `/servers` | ✅ | `ServersPage` (`/servers`) + `ServerDetailPage` (`/servers/:serverId`); borrado con `ConfirmDialog` |
| 11 | `POST /{id}/test-connection` 🔌 | ✅ | `ServerDetailPage` → "Probar conexión" (muestra `dialect` + `server_version`) |
| 12 | `GET /{id}/databases` 🔌 | ✅ | Tab "Bases de datos" → `ServerDatabasesPanel` (cruzado con el inventario) + tab "Introspección" + selectores de los asistentes |
| 14 | `GET .../tables` 🔌 | ✅ | `IntrospectionExplorer` |
| 15 | `GET .../tables/{t}/schema` 🔌 | ✅ | `IntrospectionExplorer` (columnas, PK, índices, FKs) |
| 16 | `POST /{id}/grantable` 🔌 | ✅ | `GrantManager` (pre-chequeo antes de otorgar) |
| 59 | `GET /{id}/reconcile` 🔌 | ✅ | Tab "Reconciliación" → `ServerReconcilePanel` (`managed`/`unmanaged`/`orphan`) |
| 60 | `GET .../snapshot` 🔌 | ✅ | `SnapshotModal` ("Ver snapshot") + asistente de blueprint desde snapshot |
| 13 | `GET /{id}/users` (plano) 🔌 | ⛔ | Legacy: el propio contrato recomienda la vista agrupada (#64), que sí está integrada. Repetiría un `user@host` por cuenta. |

### Ciclo de vida de BDs a nivel servidor (`/servers/{id}/databases`, por identidad física)

Opera sobre el par `(server_id, database)`, sin exigir que la BD esté adoptada en el inventario.
Complementa —no reemplaza— al CRUD de `/managed-databases`.

| # | Endpoint | Estado | Dónde |
|---|---|---|---|
| — | `POST /{id}/databases` 🔌 | ✅ | Tab "Bases de datos" → "Nueva base de datos" → `CreateServerDatabaseModal` (formulario adaptado al motor; `register` como `Switch` que revela el propietario) |
| — | `GET .../{db}/users` 🔌 | ✅ | `ServerDatabaseDetailPage` (`/servers/:serverId/databases/:database`) → pestaña "Usuarios con permisos" → `DatabaseGranteesPanel` (consulta inversa; oculta `host` si `supports_hosts=false`) |
| — | `POST .../{db}/drop-preview` 🔌 | ✅ | `DropDatabaseDialog`, paso 1: conexiones activas, cruce con inventario y `confirm_token` con cuenta atrás contra `expires_at` |
| — | `DELETE .../{db}` 🔌 ⚠️ | ✅ | `DropDatabaseDialog`, paso 2: exige transcribir el nombre exacto + token vigente; `force_disconnect` como `Checkbox`. Sin reintento automático ni borrado en lote (§6.5/§6.6) |

## Usuarios del motor

### Inventario (`/server-users`, por `id`)

| # | Endpoint | Estado | Dónde |
|---|---|---|---|
| 17–21 | CRUD de `/server-users` | ✅ | `ServerUsersPage` (`/server-users`); `?provision` y `?drop_remote` como `Switch`; borrado remoto exige reescribir el username |
| 22 | `GET /{id}/databases` | ✅ | "Ver BDs" → `OwnedDatabasesModal` en `ServerUsersPage`; pestaña "Bases de datos" de la ficha física (`ServerUserDetailPage`) — ambos sobre `OwnedDatabasesContent` |
| 23 | `GET /{id}/grants` 🔌 | ✅ | Ficha física de la identidad (`ServerUserDetailPage`, `/servers/:serverId/users/:username/:host?`) → pestaña "Permisos efectivos" → `EffectiveGrantsPanel` (en PostgreSQL espera que se indique la BD antes de consultar). `ServerUserGrantsPage` (`/server-users/:userId/grants`) queda como redirect de compatibilidad hacia `?tab=grants` de la ficha |
| 24 | `POST /{id}/grants` 🔌 | ✅ | Ficha física → pestaña "Otorgar / revocar" → `GrantManager` |
| 25 | `DELETE /{id}/grants` 🔌 | ✅ | `GrantManager` → revocar (`cascade` solo PostgreSQL, con confirmación del grantee) |
| 26 | `POST /{id}/apply-profile/{profile_id}` 🔌 | ✅ | Ficha física → pestaña "Aplicar perfil" → `ApplyProfilePanel` (errores parciales enumerados) |
| 27 | `POST /server-users/provision` 🔌 | ✅ | `ServerUserForm` → sección "Permisos iniciales" al crear con aprovisionamiento (informa `grant_results[]`) |
| 61 | `POST /server-users/adopt` 🔌 | ✅ | `AdoptUserModal`, desde `EngineUsersPanel`, `ServerReconcilePanel` y la ficha física (`ServerUserDetailPage`, pestaña "Identidad" y CTA de las pestañas de permisos sin adoptar) |

> Las 4 pestañas de permisos/BDs de la ficha física (#23–26, #22) exigen `server_user_id`
> numérico: sin adoptar (`status !== 'adopted'`), se reemplazan por un único `EmptyState` con
> CTA "Adoptar esta identidad para gestionar sus permisos" en vez de ocultarse sin explicación.

### Identidad física y batch (`/servers/{id}/users/*`)

Endpoints por `(server_id, username, host)`. `EngineUsersPanel` (tabla, `/servers/:serverId?tab=users`)
y la ficha física de una identidad (`ServerUserDetailPage`, `/servers/:serverId/users/:username/:host?`)
comparten la misma query agrupada y los mismos modales; la ficha es el destino recomendado para
gestionar permisos (enlazada desde el username/host de cada fila y desde "Ver grants").

| # | Endpoint | Estado | Dónde |
|---|---|---|---|
| 64 | `GET /{id}/users/grouped` 🔌 | ✅ | `EngineUsersPanel` (pantalla principal; respeta `supports_hosts`) y `ServerUserDetailPage` (resuelve la identidad de la ficha por username+host) |
| 65 | `POST /{id}/users` 🔌 | ✅ | "Crear usuario" y "Recrear en el motor" (drift `orphan`), desde `EngineUsersPanel` y desde la pestaña "Identidad" de la ficha física |
| 66 | `PATCH /{id}/users/password` 🔌 | ✅ | "Rotar contraseña" por identidad, desde `EngineUsersPanel` y la ficha física |
| 67 | `DELETE /{id}/users` 🔌 | ✅ | `DeleteEngineUserDialog` (doble confirmación), desde `EngineUsersPanel` y la ficha física |
| 68 | `POST /{id}/users/add-host` 🔌 | ✅ | Solo MySQL/MariaDB; advierte del sobre-aprovisionamiento de `copy_grants` |
| 69 | `POST /{id}/users/reveal-password` 🔌 | ✅ | "Revelar" (solo si `has_password`); secreto efímero, sin caché |
| 70 | `POST /{id}/users/adopt-all-hosts` 🔌 | ✅ | `AdoptAllHostsModal` (acción por *username*); resultado por host |
| 71 | `POST /{id}/users/define-password` | ✅ | `DefineKnownPasswordModal`; alcance explícito, aviso de que el gateway **no verifica** la contraseña, reenvío con `overwrite` |
| 72 | `PATCH /{id}/users/password-all-hosts` 🔌 | ✅ | `RotatePasswordAllHostsModal`; resultado por host (un host con error conserva la contraseña anterior) |

> **Definir ≠ rotar.** `define-password` (#71) solo cifra y guarda una contraseña que el
> admin ya conoce, sin tocar el motor; `password`/`password-all-hosts` (#66/#72) cambian
> la contraseña real. Son modales separados a propósito: no los unifiques.

## Blueprints y sus migraciones

| # | Endpoint | Estado | Dónde |
|---|---|---|---|
| 28–33 | CRUD de `/database-models` + `/databases` | ✅ | `DatabaseModelsPage` (`/database-models`). `GET .../databases` trae además el **estado de despliegue** por BD y lo consumen las DOS pestañas de `BlueprintMigrationsPage`: «Estado en las BDs» (`?tab=estado`) con la tabla por BD, y «Versiones» a través de `VersionFactsCard`, que cuenta en cuántas BDs activas está PENDIENTE la versión seleccionada (`pending_versions`, lectura directa — **no** deriva ningún «aplicada en N»: ver el JSDoc de `version-adoption.ts`). El refresco 🔌 es `POST .../databases/refresh` |
| 63 | `POST /database-models/from-snapshot` 🔌 | ✅ | Asistente `/database-models/from-snapshot` y CTA del panel de reconciliación |
| 48–50 | Listar/crear/detallar migraciones | ✅ | `BlueprintMigrationsPage` (`/database-models/:modelId/migrations`); al crear, `version` va vacía = autoasignada. El listado alimenta tres piezas: el desplegable de `VersionNavigator`, la `VersionAlertsBar` (avisos del catálogo: versiones sin revisar, sin rollback, con el SQL editado tras aplicarse o congelado, cada uno con su lista y su consecuencia) y la ficha `VersionFactsCard`. **Ya no hay tabla de versiones**: era el tercer sitio que repetía las mismas insignias con vocabulario propio, y el vocabulario único vive ahora en `migration-badges.ts`. El detalle solo aporta `updated_at` y el tamaño del SQL base a la ficha — comparte clave de caché con el panel de SQL, así que no añade petición |
| 51 | `PATCH .../migrations/{version}` | ✅ | Confirmar `down_sql` sugerido, overrides por motor, y **aprobar el baseline** (`reviewed`, gate R1, desde `VersionFactsCard` — antes vivía en el «card delgado» del panel de detalle). Con `sql_frozen` se deshabilitan `up_sql` y los overrides pero **`down_sql` sigue editable** (v15 §4.bis): bloquearlo cerraría la única salida del 409 de rollback y dejaría la versión sin forma de revertirse. El 409 se clasifica por `public_context.code` —ya no por la prosa— y `sql_frozen` ofrece las dos salidas de `MigrationFreezePanel`. `partial_application` se pinta con `MigrationPartialProgressPanel`, que usa `incomplete_progress` para nombrar la base y la sentencia en la que quedó (**sin** ofrecer «Editar igual»: ese 409 no tiene override), y `stale_overrides` señala los campos concretos |
| v15 §3 | `POST .../migrations/{version}/edit-preview` 🔌 | ✅ | `MigrationEditOverrideDialog`, paso 1 de la vía de excepción para editar una versión **ya aplicada**. Lee la versión de cada BD del motor en vivo (de ahí el rate limit 20/min) y emite el `confirm_token`. Se llega desde la salida «Editar igual…» de `MigrationFreezePanel`, que solo se renderiza si el 409 trae `override_available: true` |
| v18 §3 | `GET .../migrations/{version}/delete-plan` 🔌 | ✅ | `MigrationDeletePlanDialog`, paso 1 del borrado. Es el **veredicto autoritativo**: abre conexión a cada BD del blueprint para leer su versión en vivo, así que manda sobre `deletable` y `delete_requires_stamps` del listado, que salen de caché. Trae `renumber[]` (la re-etiquetación), `stamp_plan[]` (una escritura remota por fila), `blockers[]`, `unstampable[]`, `partial_applications[]` y los `warnings[]`, que el diálogo muestra **tal cual y sin resumir**. Emite el `confirm_token` (TTL 2 min). Se pide desde el clic, nunca al montar el diálogo |
| 52 | `DELETE .../migrations/{version}` | ✅ | Desde el pie de `VersionFactsCard`, ahora sobre **cualquier** versión y no solo la punta (v18): las posteriores bajan un escalón y a las BDs que están adelante se les **mueve el puntero**, que es un `UPDATE` dentro de cada motor — de ahí el `confirm_token` en query, obligatorio solo si el plan mueve punteros, y el 🔌. La respuesta **dejó de ser vacía**: trae `renumbered[]` y `stamped[]`, y el diálogo los lista para que se vea en qué bases se escribió. Habilitado según `deletable`, con el motivo del `block_reason` **como texto visible** y no como `title` de un `<span>` —que no llega por teclado ni en táctil—, y con doble confirmación (hay que reescribir el número de versión) más reconocimiento explícito cuando hay escrituras remotas. Se deshabilita también si el detalle de la versión no cargó: puede haberse borrado por debajo. Los siete errores se clasifican por `public_context.code`; el 422/410 del token significa que el parque cambió y hay que volver a planificar, nunca que el operador se equivocó |
| 52b | `POST .../migrations/validate` | ✅ | `MigrationValidationPanel` dentro de `ModelMigrationForm`: sintaxis, traducción a PostgreSQL, siembra, COLLATE forzado y sentencias destructivas. Con una BD elegida (🔌) comprueba además que las tablas referenciadas existan |
| 53 | `POST .../migrations/apply-all` 🔌 | ✅ | `ApplyMigrationsDialog`: selector de destinos (todas / los que elija, vía `database_ids`), **filtro por entorno** (`environment_id`, que el backend aplica antes del tope), dry-run, `force`, `on_failure`, y resultado por BD con enlace a sus resultados capturados. El resultado distingue **tres** estados (aplicada / bloqueada por política, en ámbar / con error) usando `error_code`, ordena errores primero, y usa `matched_databases` en la cabecera. **Sin consentimiento por corrida** (el backend lo retiró, v13 §1): en su lugar se avisa qué versiones van a capturar y cuáles frenarían el lote por no estar aprobadas. El rechazo por captura sin revisar llega **por ítem dentro de un 200** y se clasifica con `error_code: migration.capture_unreviewed`; el enlace a lo capturado usa `captured_versions` y ya no adivina con la última versión aplicada |

## Proyectos (agrupadores de blueprints)

Relación **N:M** contra `database_models`. No tocan ningún motor: ninguna fila lleva 🔌.

| # | Endpoint | Estado | Dónde |
|---|---|---|---|
| v16 §3.1 | `GET /projects` | ✅ | Pestaña «Proyectos» de `DatabaseModelsPage` (`/database-models`, pestaña **por defecto**) → `ProjectsPanel`. La columna «Blueprints» usa el `blueprint_count` que ya viene calculado; **0 no se pinta como advertencia** — es el estado normal del alta recomendada |
| v16 §3.2 | `POST /projects` | ✅ | `ProjectFormModal`. Se envía **sin `model_ids`** a propósito: con ids inválidos el 422 deja el proyecto YA creado y reintentar el alta daría 409 por el nombre. El 409 `project.name_taken` se muestra **inline en Nombre**, sin CTA de reintentar |
| v16 §3.3 | `GET /projects/{id}` | ✅ | `ProjectDetailPage` (`/projects/:projectId`), cabecera |
| v16 §3.4 | `PATCH /projects/{id}` | ✅ | `ProjectFormModal` en modo edición. `description: null` **vacía** la descripción (botón «Vaciar la descripción»); `""` guardaría una cadena vacía |
| v16 §3.5 | `DELETE /projects/{id}` | ✅ | `DeleteProjectDialog`: confirmación **simple**, sin re-tipear el nombre — no es destructivo. El `message` del backend se muestra **tal cual** porque es lo que reafirma que los blueprints no se borraron; el 404 se trata como éxito idempotente |
| v16 §3.6 | `GET /projects/{id}/blueprints` | ✅ | Tabla de `ProjectDetailPage`. **Sin paginador**: el endpoint no acepta `page`/`size`. Se reordena por nombre en cliente |
| v16 §3.7 | `POST /projects/{id}/blueprints` | ✅ | `LinkBlueprintsModal`. Se manda la selección completa sin calcular el delta (es idempotente); `already_linked` se comunica como **éxito**. El 422 marca las filas de `missing_model_ids` y ofrece «Reintentar solo con los válidos»; el 409 `project.link_conflict` ofrece **reintentar** (transitorio), a diferencia del 409 de nombre |
| v16 §3.8 | `DELETE /projects/{id}/blueprints/{model_id}` | ✅ | «Quitar del proyecto» en la tabla del detalle y en la vista inversa. **Sin confirmación, con deshacer** (barra inline); el 404 `project.blueprint_not_linked` es éxito idempotente |
| v16 §3.9 | `GET /database-models/{model_id}/projects` | ✅ | `BlueprintProjectsSection`, dentro de `BlueprintMigrationsPage`. Sin paginador; lista vacía es un estado normal, no un dato faltante |

## Bases de datos gestionadas y migraciones por BD

| # | Endpoint | Estado | Dónde |
|---|---|---|---|
| 34–39 | CRUD + `reassign-owner` | ✅ | `ManagedDatabasesPage` (`/managed-databases`); filtros por servidor, propietario, blueprint, estado y **entorno** (`environment_id` / `only_unassigned`, en un solo control para que la combinación ilegal sea inexpresable); borrado remoto exige reescribir el nombre. El nombre de cada fila enlaza a la ficha unificada `ServerDatabaseDetailPage` (`/servers/:serverId/databases/:database`) |
| 62 | `POST /managed-databases/adopt` 🔌 | ✅ | `AdoptDatabaseModal`: incluye *stamp-on-adopt* (blueprint + versión de partida). Se abre tanto desde `ServerReconcilePanel` como desde el CTA "Adoptar" de `ServerDatabaseDetailPage` cuando la BD física todavía no está en el inventario |
| 63 | `POST /managed-databases/{id}/provision` 🔌 | ✅ | `ProvisionDatabaseDialog`, desde el botón "Aprovisionar 🔌" que `ManagedDatabasesPage` muestra solo en filas `pending`/`error`, y desde el aviso "La base de datos no existe en el motor" de `ManagedDatabaseMigrationsContent`. Ejecuta el `CREATE DATABASE` que faltaba sobre una fila ya registrada — sin él la única salida era borrar el registro y rehacerlo, perdiendo notas, entorno, blueprint e historial. `allow_recreate` solo se manda desde `active` (base borrada por fuera del gateway) |
| 54 | `GET .../migrations/status` 🔌 | ✅ | `ManagedDatabaseMigrationsContent`, compartido por la ruta de compatibilidad `ManagedDatabaseMigrationsPage` (`/managed-databases/:databaseId/migrations`) y por la pestaña "Migraciones" de `ServerDatabaseDetailPage` (`/servers/:serverId/databases/:database?tab=migrations`, solo si la BD está adoptada) (versión actual, pendientes y **banner de aplicación parcial**). Con `database_exists: false` la vista deja de pintar contadores que mienten —`pending_count` lista todo el blueprint porque no hay base— y muestra el CTA de aprovisionamiento, deshabilitando lo que toca el motor |
| 55 | `POST .../migrations/apply` 🔌 | ✅ | Previsualizar (dry-run) + aplicar; selector `on_failure`; resultado por versión con retomas y sentencia de fallo; mensaje de auto-reconciliación. **Sin consentimiento por corrida** (v13 §1): un aviso informativo, acotado a las versiones PENDIENTES de esa base, dice cuáles van a capturar; el dry-run lo confirma con `will_capture_versions`. El 409 que queda es el de captura **sin revisar**, con CTA al blueprint |
| 56 | `POST .../migrations/rollback` 🔌 | ✅ | Doble confirmación de la versión actual; el 409 por `down_sql` faltante enlaza al blueprint. **Sin consentimiento por corrida** (v13 §1); el aviso de captura cubre el camino a revertir, porque el `down_sql` captura igual que el `up_sql` |
| 57 | `POST .../migrations/stamp` 🔌 | ✅ | Con `force` y la advertencia del anti-patrón (no arregla un apply a medias) |
| 81 | `POST .../migrations/reconcile-partial` 🔌 | ✅ | `ReconcilePartialSection` (sección de ese mismo contenido, vía `?reconcile=`): previsualiza los reversos, avisa de los no demostrablemente seguros y exige confirmar la versión |
| 58 | `GET .../migrations/history` 🔌 | ✅ | Tab "Historial" (paginado) |
| 58b | `GET .../migrations/{version}/select-results` | ✅ | `SelectResultsPage` (`/managed-databases/:databaseId/migrations/:version/select-results`). Faltaba en esta tabla pese a estar implementada. `rows` es POSICIONAL (`rows[i][j]` ↔ `columns[j]`) y solo guarda la corrida más reciente |
| 58c | `DELETE .../migrations/{version}/select-results` | ✅ | Botón "Purgar ahora" de esa misma pantalla, con confirmación |

## Comparación de esquemas

| # | Endpoint | Estado | Dónde |
|---|---|---|---|
| 73 | `POST /schema-comparisons` 🔌 | ✅ | Asistente `/schema-comparisons`, paso selector (acepta BDs del inventario o crudas). También se llega con `?targetDatabaseId=` prellenado desde `ManagedDatabasesPage` y desde la acción "Comparar esquema" de `ServerDatabaseDetailPage` (habilitada solo si la BD está adoptada) |
| 74 | `GET /{id}` | ✅ | Paso resumen (410 → banner "Recalcular") |
| 75 | `GET /{id}/items` | ✅ | Paso detalle, filtrable; orden del servidor (`seq`), nunca reordenado por `phase` |
| 76 | `GET /{id}/export` | ✅ | Descarga `.sql`; respeta filtros activos o la selección, con rollback comentado opcional |
| 77 | `POST /{id}/resolve-selection` | ✅ | `DependencyClosureNotice` en los pasos de confirmación; sus `resolved_item_ids` son la selección final |
| 78 | `POST /{id}/adopt` 🔌 | ✅ | Opción A (oculta si el target no está en el inventario) |
| 79 | `POST /{id}/execute-preview` | ✅ | Preview obligatorio: `confirm_token`, `excluded_by_dependency` y `plan_warnings` |
| 80 | `POST /{id}/execute` 🔌 | ✅ | Opción B, con confirmación del nombre del target |

> **La unidad de selección es el `op_group`, no la fila.** Un objeto redefinido rinde dos
> sentencias (DROP + CREATE) que viajan juntas; enviar media parte se rechaza con 422.

## Catálogos y administración

| # | Endpoint | Estado | Dónde |
|---|---|---|---|
| 40–41 | `/privileges` (listar, activar/desactivar) | ✅ | `PrivilegesPage` (`/privileges`) |
| 42–46 | CRUD de `/permission-profiles` | ✅ | `PermissionProfilesPage` (`/permission-profiles`) |
| 44 | `GET /permission-profiles/{id}` | 🧩 | El modal de edición reutiliza los datos de la fila; el hook queda disponible por si hace falta una vista de detalle. |
| 47 | `POST /admin/crypto/rotate` | ✅ | `AdminPage` (`/admin`), con confirmación |

## Entornos de despliegue

Clasifican cada BD gestionada y llevan la política que el backend hace cumplir (hoy:
`blocks_destructive_migrations`). Contrato del backend: `docs/features/environments.md`.

**Los entornos son un conjunto FIJO de cuatro** (`local`, `development`, `staging`, `production`)
y la administración es **por API a propósito**: no hay pantalla de CRUD, y no es un olvido. La
política se cambia editando una fila por API sin desplegar, cosa que sigue siendo posible; lo que
no existe es la superficie de UI para mutarla. Ver las filas ⛔ de abajo.

⚠️ No confundir con el campo `environment` de `GET /health`: ese es el `APP_ENV` del **proceso**
del gateway, no la clasificación de una base de datos.

| # | Endpoint | Estado | Dónde |
|---|---|---|---|
| — | `GET /environments` | ✅ | `useEnvironmentOptions` / `useEnvironmentMap` (catálogo compartido por 5 consumidores, `staleTime` infinito): badge de entorno en `ManagedDatabasesPage`, selector en `ManagedDatabaseForm`, filtro «Entorno» del inventario y filtro del `ApplyMigrationsDialog`. Se pide **completo** (sin `only_active`): el selector filtra los activos en cliente, pero el badge tiene que poder resolver un entorno desactivado |
| — | `POST /environments` | ⛔ | Los cuatro entornos son un conjunto fijo; crear uno nuevo es una decisión de política, no de operación diaria. Por API. |
| — | `GET /environments/{id}` | ⛔ | El listado ya trae todos los campos (son 4 filas), así que un detalle no aportaría nada. |
| — | `PATCH /environments/{id}` | ⛔ | Cambiar la política —y sobre todo **debilitarla**— exige repetir el slug (`confirm_slug`) y queda auditado con `record_intent`. Se hace por API a propósito: darlo por UI abarataría un gesto que el backend encareció deliberadamente. |
| — | `DELETE /environments/{id}` | ⛔ | Exige cero BDs asignadas (409 con el conteo) y no tiene `force`. Por API. |

## Catálogo de charset/collation

Módulo de `api-reference-v7.md`: catálogo global (no por servidor) de combinaciones
charset/collation habilitadas para crear bases de datos. No aparece en el apéndice
numerado del contrato original; su contrato está modelado en
`lib/contracts/charset-collation-options.ts`. Reemplaza el texto libre que tenían
`CreateServerDatabaseModal` (`POST /servers/{id}/databases`) y `ManagedDatabaseForm` en
modo alta (`POST /managed-databases`) — los dos ahora validan contra este catálogo y
repueblan el selector con `public_context.allowed` si llega un 422 de combinación no
habilitada, sin pedirlo de nuevo.

| Endpoint | Estado | Dónde |
|---|---|---|
| `GET /charset-collation-options` | ✅ | `CharsetCollationOptionsPage` (`/charset-collation-options`, sin filtros) para administrar; `CharsetCollationSelector` (`?engine_family=&only_enabled=true`) para el selector de creación |
| `POST /charset-collation-options` | ✅ | `AddCharsetCollationOptionModal`; el 409 de duplicada ofrece habilitar la fila existente en vez de un error genérico |
| `PATCH /charset-collation-options/{id}` | ✅ | `CharsetCollationOptionsPage`: `Switch` de habilitada, botón "Marcar sugerida", y `DisableDefaultOptionDialog` para el invariante "la sugerida debe estar habilitada" |

> **No hay `DELETE`, y no es un olvido** (§5.4 del doc): deshabilitar ya saca la
> combinación del selector; conservar la fila mantiene legible el histórico de las bases
> creadas con ella. La pantalla de administración no tiene botón de eliminar a propósito.

## Clonado de bases de datos

El asistente `/database-clones` consume un módulo que **no aparece en el apéndice de
endpoints del contrato**; su contrato está modelado en `lib/contracts/database-clones.ts`
a partir de `backend/docs/features/database-clone.md`.

| Endpoint | Estado | Dónde |
|---|---|---|
| `POST /database-clones` | ✅ | Paso de plan. Se llega con `?sourceDatabaseId=` prellenado desde `ManagedDatabasesPage` y desde la acción "Clonar" de `ServerDatabaseDetailPage` (habilitada solo si la BD está adoptada) |
| `GET /database-clones/{id}` | ✅ | Estado del trabajo (poll 2 s hasta estado terminal) |
| `GET /database-clones/{id}/objects` | ✅ | Inventario con portabilidad y grafo de dependencias |
| `POST /database-clones/{id}/resolve-selection` | ✅ | Cierre de dependencias de una selección parcial |
| `POST /database-clones/{id}/preview` | ✅ | Plan resuelto + `confirm_token` |
| `POST /database-clones/{id}/execute` | ✅ | Encola la ejecución (aquí `force` va en el cuerpo, no en la query) |
| `GET /database-clones/{id}/items` | ✅ | Monitor de pasos ejecutados |
| `POST /database-clones/{id}/cancel` | ✅ | Cancelación cooperativa |

### Lote de clonación (`/database-clones/lotes`)

Contrato en `backend/docs/api-reference-v19.md`, modelado en `lib/contracts/clone-batches.ts`.
Es la capa de **orquestación** del mismo módulo: cada fila del lote termina siendo un
`CloneJob` real y el monitor enlaza a su pantalla de detalle (`?jobId=`).

**No hay `preview`**: el plan de cada base se resuelve cuando le toca el turno, así que lo que
se confirma es el conjunto de pares origen→destino, no el DDL.

| Endpoint | Estado | Dónde |
|---|---|---|
| `POST /database-clone-batches` | ✅ | Paso «Bases» → crea el plan del lote |
| `GET /database-clone-batches` | ⬜ | El historial existe en el backend; la SPA todavía no lo lista (se entra por `?batchId=`) |
| `GET /database-clone-batches/{id}` | ✅ | Cabecera + `counts` (poll 5 s por el límite de 30/min) |
| `GET /database-clone-batches/{id}/items` | ✅ | Una fila por base, con link al clon hijo |
| `POST /database-clone-batches/{id}/execute` | ✅ | Confirmación agregada: re-tipear el nombre del **servidor** destino |
| `POST /database-clone-batches/{id}/cancel` | ✅ | Cancela el lote y la base en curso |
| `GET /database-clone-batches/{id}/retry-candidates` | ✅ | Dos grupos: reintentables y las que requieren atención |
| `POST /database-clone-batches/{id}/retry-failed` | ✅ | Crea un lote nuevo, que vuelve a pedir confirmación |

## Conversión de collation de una base de datos

Módulo de `api-reference-v8.md`: re-alinea el charset/collation de una BD completa —tablas,
columnas y (en MySQL/MariaDB) los 5 tipos de objeto que el motor congela con la collation de la
sesión que los creó (PROCEDURE, FUNCTION, TRIGGER, EVENT, VIEW)— con `DROP`+`CREATE` y
reaplicación de privilegios de rutina. En PostgreSQL es otra operación (columna por columna: el
`ENCODING`/`LC_COLLATE` de la base es inmutable). El modo (`universal`/`columns`) lo decide el
motor, nunca el operador. Pantalla propia, no un tab embebido (un job puede tardar horas y debe
sobrevivir a la navegación): se entra desde el botón "Convertir collation" de la pestaña
"Collation" de `ServerDatabaseDetailPage` (`/servers/:serverId/databases/:database?tab=collation`),
sin entrada de sidebar propia — mismo criterio que el borrado de una base. Contrato en
`lib/contracts/collation-conversions.ts`.

| Endpoint | Estado | Dónde |
|---|---|---|
| `POST /servers/{id}/databases/{database}/collation-conversions` 🔌 | ✅ | `PlanStep` — objetivo (charset+collation en MySQL/MariaDB, solo collation en PostgreSQL, con el mecanismo de "plan sonda" para poblar el catálogo de collations del servidor, ver nota) |
| `GET /collation-conversions/{id}` | ✅ | `SummaryStep`/`MonitorStep` — polling cada 2 s hasta estado terminal |
| `GET /collation-conversions/{id}/objects` 🔌 | ✅ | `InventoryStep` — inventario en vivo por tabla (universal) o por columna (columns), sin polling propio |
| `POST /collation-conversions/{id}/preview` 🔌 | ✅ | `PreviewStep` — plan resuelto + `confirm_token`, modelado como `useQuery` con `useDeferredValue` (cambiar la selección invalida el token solo, sin lógica manual) |
| `POST /collation-conversions/{id}/execute` 🔌 | ✅ | `PreviewStep` — `ConfirmDialog` con el nombre exacto de la base; rate limit `3/minute`, el más restrictivo del módulo |
| `GET /collation-conversions/{id}/items` | ✅ | `MonitorStep` — paginado, con polling mientras el job no sea terminal |
| `POST /collation-conversions/{id}/cancel` | ✅ | `MonitorStep` — cooperativa, no revierte lo ya aplicado |

### Lote por blueprint, versión de contabilidad y deriva (v17)

Contratos en `lib/contracts/collation-conversions.ts`; códigos y tonos en
`features/collation-conversions/messages.ts`. Se llega desde el botón **Collation** de cada fila
de `BlueprintsPanel`, en `/database-models`.

| Endpoint | Estado | Dónde |
|---|---|---|
| `POST /database-models/{id}/collation-conversions` 🔌 | ✅ | `BatchPlanStep` — planifica un job por BD activa (toca el motor una vez por base: 10/min) |
| `POST /database-models/{id}/collation-conversions/{batchId}/execute` 🔌 | ✅ | `BatchConfirmStep` — pide las tres confirmaciones (slug, conjunto echado de vuelta, re-tipeo por BD de entorno protegido). 3/min |
| `GET /database-models/{id}/collation-conversions/{batchId}` | ✅ | `BatchMonitorStep` — polling cada 5 s (no 2 s: el endpoint es 30/min y el lote dura horas) |
| `POST /database-models/{id}/collation-conversions/{batchId}/cancel` | ✅ | `BatchMonitorStep` — las bases en cola no llegan a tocar el motor; la que convierte corta en el próximo punto seguro |
| `POST /database-models/{id}/collation-conversions/{batchId}/blueprint-version` | ✅ | `BlueprintVersionCard` — se **stampea, no se aplica**; el `note` del backend se muestra textual |
| `GET /database-models/{id}/collation-drift` | ✅ | `CollationDriftPanel` — pestaña "Deriva". Sin 🔌 ni rate limit: lee la caché del gateway, no el motor |

> **`unknown` no comparte tono con `ok` en el panel de deriva.** Pintarlos igual afirmaría que
> todo está bien sobre bases de las que el inventario no tiene registrada la collation, que es una
> afirmación distinta de "coincide" — y la diferencia importa justo cuando se decide si convertir.
> Por el mismo motivo `source_note` se muestra **textual**: esa pantalla es una caché, no el motor.

> **Los cuatro campos nuevos del summary de un job** (`batch_id`, `batch_seq`, `tables_total`,
> `objects_total`) permitieron **borrar** el `savedTotals` de `use-collation-conversion-wizard.ts`.
> Ese estado existía porque `progress` solo cuenta lo hecho y nunca el total, y se perdía al
> recargar justo en una operación que dura horas: al volver, el monitor pasaba de "3 de 40" a
> "3 procesadas". Ahora el total viene del servidor.

> **PostgreSQL — huevo y gallina del catálogo de collations (`[SUPUESTO F1]` del addendum v8).**
> `available_collations` sale del inventario de un plan ya creado, pero crear un plan ya exige una
> collation válida. `PlanStep` resuelve esto con la opción que el propio addendum asume del
> frontend: crea automáticamente un plan **sonda** con `target_collation: "C"` (case-sensitive,
> existe en prácticamente todo PostgreSQL), lee su inventario para poblar el selector real, y el
> sonda se abandona solo (expira en 24 h). Es una solución transitoria — falta pedirle al backend
> un endpoint de catálogo de collations por servidor.

## Consola SQL

Módulo de `api-reference-v6.md`: ejecutar SQL ad-hoc eligiendo **con qué usuario del motor**
se conecta, para verificar en la práctica que un permiso quedó como se esperaba. Vive en
`/sql-console` (`?server=<id>&tab=console|history`), no en el detalle del servidor, porque
opera sobre cualquier base de cualquier servidor del inventario. Numeración propia del
contrato v6.

| Endpoint | Estado | Dónde |
|---|---|---|
| `POST /servers/{id}/query/preview` 🔌 | ✅ | Botón "Analizar y ejecutar" / "Solo analizar" → `ClassificationPanel`. Emite el `confirm_token` y estima el impacto. Nunca se dispara por pulsación: el rate limit es 30/min y el preview abre conexión al motor para los `COUNT`. |
| `POST /servers/{id}/query/execute` 🔌 ⚠️ | ✅ | Directo si el nivel es `read`; con `ConfirmExecutionDialog` (tipeo del nombre de la base + token) si es `write`/`ddl`. Resultado en `ResultsPanel`. |
| `GET /servers/{id}/query/history` | ✅ | Pestaña "Historial" → `QueryHistoryPanel`, con filtro por base y "Cargar en el editor" |

Tres cosas que no se leen en la tabla y condicionan el código:

- **`success: false` no es un error.** Un rechazo del motor llega con **HTTP 200** y es el
  resultado que el admin fue a buscar: se pinta en tono neutro. El rojo queda para
  `ddl_persisted`, `policy_miss` y los 5xx.
- **`blocked` manda sobre `requires_confirmation`.** Un lote prohibido vuelve con los dos en
  `true` y el token en `null`; `decidePath` los evalúa en el orden correcto.
- **El historial guarda metadatos, no filas.** No hay forma de volver a ver un resultado: se
  recarga el SQL en el editor y se ejecuta de nuevo.

## Exportación de bases de datos

Módulo de `api-reference-v10.md`: volcado configurable de la estructura y/o los datos de una base a
`sql`/`csv`/`json`/`ndjson`, con confirmación de doble factor, TTL corto sobre el archivo, descarga
de un solo uso y auditoría de cada entrega. Resuelve tres cosas que un `mysqldump` a mano no da:
consistencia de punto único en el tiempo sobre los datos, determinismo byte a byte (dos volcados del
mismo esquema son idénticos, así que se pueden diffear y versionar) y un manifiesto que permite
auditar qué salió sin abrir el archivo. Pantalla nueva en `/database-exports`
(`?serverId=&database=`, reentrada al monitor por `?jobId=`), sin entrada de sidebar: el formulario
entero se deriva de las capacidades de una base concreta, así que sin contexto no habría ni un
control que pintar. Se entra desde la acción "Exportar" de cada fila de `ServerDatabasesPanel` y
desde la pestaña "Resumen" de `ServerDatabaseDetailPage`. Contrato en
`lib/contracts/database-exports.ts`; flujo del frontend en [`database-export.md`](database-export.md).

| Endpoint | Estado | Dónde |
|---|---|---|
| `GET /servers/{id}/databases/{db}/export-capabilities` 🔌 | ✅ | `OriginStep` — **se llama primero y de aquí sale el formulario entero** (controles, valores válidos, defaults, matriz de combinaciones prohibidas, dialecto csv, empaquetado y límites). 30/min |
| `POST /servers/{id}/databases/{db}/database-exports` 🔌 | ✅ | `WizardNav` en `origin` → crea el plan al salir del paso 1, no al final: el catálogo de objetos cuelga del job. Manda `idempotency_key` para que un doble clic no genere dos planes. 10/min |
| `GET /database-exports/{id}/objects` 🔌 | ✅ | `ObjectsStep` — árbol del catálogo con las dos columnas de casillas (estructura / datos), buscador, filtro por tipo y `counts_by_type`. **No usa el envelope paginado estándar**: la paginación viaja dentro del objeto. 10/min |
| `POST /database-exports/{id}/resolve-selection` 🔌 | ✅ | `ObjectsStep` — cierre de dependencias sin congelar nada, como `useQuery` + `useDeferredValue` con flag `isStale`. 10/min |
| `POST /database-exports/{id}/preview` 🔌 | ✅ | Dos usos distintos: `useExportDryRunPreview` (query, `dry_run_only: true` forzado) alimenta el panel vivo de `OptionsStep`/`ConfirmStep`; `useExportPreview` (mutación) es el autoritativo que congela la selección y emite el `confirm_token`. 10/min |
| `POST /database-exports/{id}/execute` 🔌 | ✅ | `ConfirmStep` — encadenado al preview autoritativo para que el token viaje recién emitido; exige el nombre de la base re-tecleado. **3/min**, el más restrictivo |
| `GET /database-exports/{id}` | ✅ | `MonitorStep` — polling cada 2,5 s hasta estado terminal. Sin rate limit a propósito |
| `GET /database-exports/{id}/items` | ✅ | `MonitorStep`, **solo cuando el job ya es terminal**: el backend escribe los ítems de una sola vez al terminar, así que pedirlos antes mostraría «0 incidencias» durante toda la corrida |
| `POST /database-exports/{id}/cancel` | ✅ | `MonitorStep` — cooperativa; descarta el artefacto parcial. Sin rate limit para que un freno nunca quede bloqueado por una cuota |
| `GET /database-exports/{id}/manifest` | ✅ | `MonitorStep` — checksum, tamaño, objetos y TTL del artefacto. **Sobrevive a `consumed` y a `purged`**: «¿qué me llevé?» se sigue pudiendo responder cuando el archivo ya no está |
| `GET /database-exports/{id}/download` | ✅ | `MonitorStep` — `fetchBlob`; **NO pasa por el envelope `ApiResponse`** y los metadatos (`X-Export-Sha256`, `X-Export-Complete`) viajan en cabeceras. Un solo uso. **3/min** |
| `GET /database-exports/{id}/content` | ✅ | `MonitorStep` — `fetchText` para el portapapeles; deshabilitado desde el preview cuando `inline_delivery_viable` es `false`. Un solo uso. **3/min** |

Cinco cosas que no se leen en la tabla y condicionan el código:

- **El cliente no duplica ni una regla de negocio.** No hay un solo `if (format === 'csv')` en la
  feature: el evaluador de `compatibility` de `logic.ts` aplica la misma matriz que el servidor hace
  cumplir. Un 422 `export.incompatible_option` que llegue igual es un bug de ese evaluador, no del
  usuario, y `messages.ts` lo loguea como tal.
- **La consistencia es asimétrica por motor.** En MySQL/MariaDB el punto único en el tiempo cubre los
  datos pero **no** la estructura. El backend lo avisa en `preview.warnings`; ocultar ese aviso sería
  el peor bug de la pantalla, así que se muestran **todos** los warnings, no el primero.
- **No hay enmascarado de datos.** Riesgo aceptado explícito: los controles compensatorios son la
  confirmación de doble factor, el TTL corto, la descarga de un solo uso y la auditoría de cada
  descarga. De ahí la banda permanente (`PlainDataNotice`), no un tooltip.
- **Hay dos vencimientos distintos** y no se mezclan: el del PLAN (24 h, afecta a
  `preview`/`execute`) y el del ARTEFACTO (30 min desde que el job termina, afecta a
  `download`/`content`).
- **El kill switch (`EXPORT_ENABLED=False`) no cubre los 12 endpoints, sino 8.** Los de observación y
  freno (leer el job, los ítems, el manifiesto y cancelar) siguen respondiendo a propósito: si se
  apaga el módulo mientras hay un job corriendo, el operador tiene que poder verlo y detenerlo. Por
  eso `MonitorStep` no se desmonta al recibir un `export.disabled` en otra llamada.

## Pendiente de verificar contra el backend real

Los contratos Zod se escriben a mano desde la documentación del backend
([ADR-0001](adr/0001-contrato-zod-manual.md)), así que un campo con nombre o forma
distinta a la documentada **falla en tiempo de ejecución** (la validación del envelope
rechaza la respuesta) y no en compilación. Los siguientes se modelaron desde el
documento y todavía no se han ejercitado contra una instancia real:

- `#70`, `#71`, `#72` — los tres endpoints batch de usuarios y sus `results[]`.
- `#81` — `reconcile-partial`, incluido el 409 con
  `public_context.unreversible_statements` que llega **incluso en `dry_run`**.
- `#54`/`#55` — `has_partial_application`/`partial_application[]` y el bloque
  `reconciliation`, más los campos de checkpoint de `results[]`.
- `#77` — `resolve-selection` y los campos `op_group`/`depends_on` de los ítems.
- **Catálogo de charset/collation** (`/charset-collation-options` completo): según el
  propio addendum v7, el backend todavía no corrió `utf8mb4_0900_ai_ci` habilitada contra
  un MariaDB real ni verificó que los locales sembrados de PostgreSQL existan en el SO del
  servidor destino. El contrato puede tener ajustes menores; el mapeo de `charsetRejected`/
  `charsetDuplicate` está concentrado en `lib/api/errors.ts`.
- **Conversión de collation** (`/collation-conversions` completo): según el propio addendum
  v8, el backend está verificado con tests de API y adapters mockeados pero **no e2e contra
  motores reales** — falta confirmar que una recreación de rutina falle/funcione como se
  documenta en MySQL/MariaDB real, y que los locales de PostgreSQL sembrados existan en el SO
  de cada servidor. El mapeo de errores está concentrado en `wizard/messages.ts` de la
  feature (`classifyConversionError`); el contrato puede tener ajustes menores.
- **Exportación de bases entera** (`/database-exports` completo): el contrato v10 documenta el
  backend como implementado (fases F1–F6) pero nada de esto se ha ejercitado contra una instancia
  real desde la UI. Puntos concretos a confirmar, todos elegidos porque el documento no los muestra
  con datos: la forma de `excluded_by_dependency` (el contrato solo la muestra como array vacío; se
  modeló como `[{object_type, name}]`), si `advisory` de `resolve-selection` comparte forma con
  `edges`, y si `when` de la matriz de compatibilidad puede traer valores booleanos además de texto
  (se aceptan las dos formas a propósito, y el comparador las normaliza). Todo el mapeo está
  concentrado en `lib/contracts/database-exports.ts`, `features/database-exports/logic.ts` y
  `features/database-exports/messages.ts`.
- **Consola SQL entera** (`query/preview`, `query/execute`, `query/history`): el propio
  contrato v6 (§2.8) avisa de que el backend todavía no se validó contra motores
  MySQL/MariaDB/PostgreSQL reales y de que puede haber ajustes menores. Por eso todo el
  mapeo de la respuesta está concentrado en `lib/contracts/sql-console.ts` y
  `features/sql-console/logic.ts`. Punto concreto a confirmar: la paginación del historial
  (§7 la documenta con la clave `meta`, el resto de la API usa `pagination`); el servicio
  acepta las dos formas a propósito.

Ver el checklist de [`deployment.md`](deployment.md#checklist-de-endurecimiento-para-producción).
