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
| 28–33 | CRUD de `/database-models` + `/databases` | ✅ | `DatabaseModelsPage` (`/database-models`) |
| 63 | `POST /database-models/from-snapshot` 🔌 | ✅ | Asistente `/database-models/from-snapshot` y CTA del panel de reconciliación |
| 48–50 | Listar/crear/detallar migraciones | ✅ | `BlueprintMigrationsPage` (`/database-models/:modelId/migrations`); al crear, `version` va vacía = autoasignada |
| 51 | `PATCH .../migrations/{version}` | ✅ | Confirmar `down_sql` sugerido, overrides por motor, y **aprobar el baseline** (`reviewed`, gate R1) |
| 52 | `DELETE .../migrations/{version}` | ✅ | Solo habilitado en la punta de la secuencia |
| 53 | `POST .../migrations/apply-all` 🔌 | ✅ | `ApplyAllDialog` (dry-run, `max_databases`, `force`, `on_failure`, resultado por BD) |

## Bases de datos gestionadas y migraciones por BD

| # | Endpoint | Estado | Dónde |
|---|---|---|---|
| 34–39 | CRUD + `reassign-owner` | ✅ | `ManagedDatabasesPage` (`/managed-databases`); filtros por servidor, propietario, blueprint y estado; borrado remoto exige reescribir el nombre. El nombre de cada fila enlaza a la ficha unificada `ServerDatabaseDetailPage` (`/servers/:serverId/databases/:database`) |
| 62 | `POST /managed-databases/adopt` 🔌 | ✅ | `AdoptDatabaseModal`: incluye *stamp-on-adopt* (blueprint + versión de partida). Se abre tanto desde `ServerReconcilePanel` como desde el CTA "Adoptar" de `ServerDatabaseDetailPage` cuando la BD física todavía no está en el inventario |
| 54 | `GET .../migrations/status` 🔌 | ✅ | `ManagedDatabaseMigrationsContent`, compartido por la ruta de compatibilidad `ManagedDatabaseMigrationsPage` (`/managed-databases/:databaseId/migrations`) y por la pestaña "Migraciones" de `ServerDatabaseDetailPage` (`/servers/:serverId/databases/:database?tab=migrations`, solo si la BD está adoptada) (versión actual, pendientes y **banner de aplicación parcial**) |
| 55 | `POST .../migrations/apply` 🔌 | ✅ | Previsualizar (dry-run) + aplicar; selector `on_failure`; resultado por versión con retomas y sentencia de fallo; mensaje de auto-reconciliación |
| 56 | `POST .../migrations/rollback` 🔌 | ✅ | Doble confirmación de la versión actual; el 409 por `down_sql` faltante enlaza al blueprint |
| 57 | `POST .../migrations/stamp` 🔌 | ✅ | Con `force` y la advertencia del anti-patrón (no arregla un apply a medias) |
| 81 | `POST .../migrations/reconcile-partial` 🔌 | ✅ | `ReconcilePartialSection` (sección de ese mismo contenido, vía `?reconcile=`): previsualiza los reversos, avisa de los no demostrablemente seguros y exige confirmar la versión |
| 58 | `GET .../migrations/history` 🔌 | ✅ | Tab "Historial" (paginado) |

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
- **Consola SQL entera** (`query/preview`, `query/execute`, `query/history`): el propio
  contrato v6 (§2.8) avisa de que el backend todavía no se validó contra motores
  MySQL/MariaDB/PostgreSQL reales y de que puede haber ajustes menores. Por eso todo el
  mapeo de la respuesta está concentrado en `lib/contracts/sql-console.ts` y
  `features/sql-console/logic.ts`. Punto concreto a confirmar: la paginación del historial
  (§7 la documenta con la clave `meta`, el resto de la API usa `pagination`); el servicio
  acepta las dos formas a propósito.

Ver el checklist de [`deployment.md`](deployment.md#checklist-de-endurecimiento-para-producción).
