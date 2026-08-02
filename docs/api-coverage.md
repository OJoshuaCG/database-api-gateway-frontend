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
| 22 | `GET /{id}/databases` | ✅ | "Ver BDs" → `OwnedDatabasesModal` |
| 23 | `GET /{id}/grants` 🔌 | ✅ | `ServerUserGrantsPage` (`/server-users/:userId/grants`) → pestaña "Permisos efectivos" (en PostgreSQL espera que se indique la BD antes de consultar) |
| 24 | `POST /{id}/grants` 🔌 | ✅ | `GrantManager` → tab "Otorgar" |
| 25 | `DELETE /{id}/grants` 🔌 | ✅ | `GrantManager` → revocar (`cascade` solo PostgreSQL, con confirmación del grantee) |
| 26 | `POST /{id}/apply-profile/{profile_id}` 🔌 | ✅ | `ApplyProfilePanel` (errores parciales enumerados) |
| 27 | `POST /server-users/provision` 🔌 | ✅ | `ServerUserForm` → sección "Permisos iniciales" al crear con aprovisionamiento (informa `grant_results[]`) |
| 61 | `POST /server-users/adopt` 🔌 | ✅ | `AdoptUserModal`, desde `EngineUsersPanel` y `ServerReconcilePanel` |

### Identidad física y batch (`/servers/{id}/users/*`)

| # | Endpoint | Estado | Dónde |
|---|---|---|---|
| 64 | `GET /{id}/users/grouped` 🔌 | ✅ | `EngineUsersPanel` (pantalla principal; respeta `supports_hosts`) |
| 65 | `POST /{id}/users` 🔌 | ✅ | "Crear usuario" y "Recrear en el motor" (drift `orphan`) |
| 66 | `PATCH /{id}/users/password` 🔌 | ✅ | "Rotar contraseña" por identidad |
| 67 | `DELETE /{id}/users` 🔌 | ✅ | `DeleteEngineUserDialog` (doble confirmación) |
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
| 34–39 | CRUD + `reassign-owner` | ✅ | `ManagedDatabasesPage` (`/managed-databases`); filtros por servidor, propietario, blueprint y estado; borrado remoto exige reescribir el nombre |
| 62 | `POST /managed-databases/adopt` 🔌 | ✅ | `AdoptDatabaseModal` (incluye *stamp-on-adopt*: blueprint + versión de partida) |
| 54 | `GET .../migrations/status` 🔌 | ✅ | `ManagedDatabaseMigrationsPage` (`/managed-databases/:databaseId/migrations`) (versión actual, pendientes y **banner de aplicación parcial**) |
| 55 | `POST .../migrations/apply` 🔌 | ✅ | Previsualizar (dry-run) + aplicar; selector `on_failure`; resultado por versión con retomas y sentencia de fallo; mensaje de auto-reconciliación |
| 56 | `POST .../migrations/rollback` 🔌 | ✅ | Doble confirmación de la versión actual; el 409 por `down_sql` faltante enlaza al blueprint |
| 57 | `POST .../migrations/stamp` 🔌 | ✅ | Con `force` y la advertencia del anti-patrón (no arregla un apply a medias) |
| 81 | `POST .../migrations/reconcile-partial` 🔌 | ✅ | `ReconcilePartialSection` (sección de esa misma página, vía `?reconcile=`): previsualiza los reversos, avisa de los no demostrablemente seguros y exige confirmar la versión |
| 58 | `GET .../migrations/history` 🔌 | ✅ | Tab "Historial" (paginado) |

## Comparación de esquemas

| # | Endpoint | Estado | Dónde |
|---|---|---|---|
| 73 | `POST /schema-comparisons` 🔌 | ✅ | Asistente `/schema-comparisons`, paso selector (acepta BDs del inventario o crudas) |
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

## Clonado de bases de datos

El asistente `/database-clones` consume un módulo que **no aparece en el apéndice de
endpoints del contrato**; su contrato está modelado en `lib/contracts/database-clones.ts`
a partir de `backend/docs/features/database-clone.md`.

| Endpoint | Estado | Dónde |
|---|---|---|
| `POST /database-clones` | ✅ | Paso de plan |
| `GET /database-clones/{id}` | ✅ | Estado del trabajo (poll 2 s hasta estado terminal) |
| `GET /database-clones/{id}/objects` | ✅ | Inventario con portabilidad y grafo de dependencias |
| `POST /database-clones/{id}/resolve-selection` | ✅ | Cierre de dependencias de una selección parcial |
| `POST /database-clones/{id}/preview` | ✅ | Plan resuelto + `confirm_token` |
| `POST /database-clones/{id}/execute` | ✅ | Encola la ejecución (aquí `force` va en el cuerpo, no en la query) |
| `GET /database-clones/{id}/items` | ✅ | Monitor de pasos ejecutados |
| `POST /database-clones/{id}/cancel` | ✅ | Cancelación cooperativa |

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

Ver el checklist de [`deployment.md`](deployment.md#checklist-de-endurecimiento-para-producción).
