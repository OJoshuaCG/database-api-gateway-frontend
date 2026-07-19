# Flujo de datos: cómo viaja la información

Este documento traza **el recorrido de una solicitud** desde la interacción del usuario
hasta el backend y de vuelta a la pantalla, indicando **por qué archivos pasa**. Luego
detalla los **escenarios más comunes**. Rutas relativas a `frontend/`.

---

## La tubería común (toda solicitud pasa por aquí)

Independientemente de la feature, todas las llamadas atraviesan la misma cadena de
archivos. Conviene memorizar este "carril":

```
Componente/Página                       src/features/<f>/pages|components/*
   │  (el usuario interactúa)
   ▼
Custom hook (useQuery / useMutation)    src/features/<f>/hooks/*
   │  (estado: data / isLoading / isError; caché; invalidación)
   ▼
Servicio (una función por endpoint)     src/features/<f>/api/<f>.api.ts
   │  (elige fetchData/fetchPage/fetchList/mutateData/mutateVoid + schema)
   ▼
Cliente API                             src/lib/api/client.ts  →  apiRequest()
   │  • buildUrl(path, query)        construye la URL con query params
   │  • fetch(..., credentials:'include')   adjunta la cookie de sesión
   │  • lee el cuerpo (texto → JSON)
   │  • si !ok → normalizeApiError()  (y handler de 401)   src/lib/api/errors.ts
   │  • si ok → schema.safeParse()    valida el envelope    src/lib/contracts/*
   ▼
Respuesta tipada y validada  ──►  el hook actualiza la caché  ──►  el componente re-renderiza
```

**Qué aporta cada parada:**

| Archivo | Responsabilidad concreta |
|---|---|
| `pages/components` | Disparan la acción y pintan `loading` / `empty` / `error` / `data`. |
| `hooks/*` | Deciden la `queryKey`, cuándo refetch/invalidar, y muestran toasts. |
| `api/*.api.ts` | Conocen la **ruta**, el **método** y el **schema** de cada endpoint. |
| `lib/api/client.ts` | Único lugar con `fetch`. Cookie, query params, parseo y validación. |
| `lib/api/errors.ts` | Convierte cualquier fallo (HTTP o de red) en un `ApiError` uniforme. |
| `lib/contracts/*` | Valida en runtime que la respuesta cumple el contrato (Zod). |

> Los helpers del cliente (`fetchData`, `fetchPage`, `fetchList`, `mutateData`,
> `mutateVoid`) se diferencian solo en **qué forma de envelope** esperan
> (`{data}`, `{data,pagination}`, lista no paginada, o `{message}` sin datos).

---

## Escenario A — Arranque y verificación de sesión

Qué pasa al abrir la app en `/servers` (o cualquier ruta protegida).

```
main.tsx
  └─ App.tsx (ErrorBoundary raíz)
       └─ AppProviders            app/providers.tsx  (Theme → Query → Toast → Session)
            └─ RouterProvider     app/router.tsx
                 └─ ProtectedRoute            features/auth/components/ProtectedRoute.tsx
                      └─ useSession()         features/auth/hooks/use-session.ts
                           └─ getMe()         features/auth/api/auth.api.ts
                                └─ fetchData('/auth/me', adminOutSchema)   lib/api/client.ts
```

Resultados posibles:

- **200** → `useSession` expone `admin`; `ProtectedRoute` renderiza `<Outlet/>` (la app).
- **401** → `useSession` marca `isUnauthenticated`; `ProtectedRoute` hace
  `<Navigate to="/login" state={{ from }} />`.
- **Cargando** → `ProtectedRoute` muestra `<FullPageSpinner/>`.

`SessionProvider` (montado en `providers.tsx`) registra el handler global de 401 en el
arranque vía `setUnauthorizedHandler(...)` — ver escenario G.

---

## Escenario B — Login

```
LoginPage (RHF + zodResolver(loginInSchema))     features/auth/pages/LoginPage.tsx
  └─ onSubmit → useLogin().mutateAsync(values)    features/auth/hooks/use-login.ts
       └─ login(credentials)                       features/auth/api/auth.api.ts
            └─ mutateData('POST','/auth/login', adminOutSchema, { body, suppressAuthHandler:true })
                 └─ apiRequest → fetch (el navegador guarda la cookie Set-Cookie)
```

- `loginInSchema` valida `username`/`password` **en el cliente** antes de enviar.
- `suppressAuthHandler: true` evita que un **401 (credenciales inválidas)** dispare el
  flujo global de "sesión expirada"; en su lugar el `catch` de `LoginPage` muestra el
  mensaje en el formulario.
- En éxito: `useLogin.onSuccess` hace `setQueryData(queryKeys.auth.me(), admin)` (siembra
  la sesión, evita un refetch) y `LoginPage` navega a `from` (la ruta que se intentó
  visitar) o a `/servers`.
- **429** (rate limit, 5/min) → `ApiError` con mensaje claro mostrado en el formulario.

---

## Escenario C — Listado paginado (GET con `page`/`size`)

Ejemplo: la tabla de servidores.

```
ServersPage  (estado local: page, size)          features/servers/pages/ServersPage.tsx
  └─ useServers({ page, size })                   features/servers/hooks/use-servers.ts
       └─ listServers(params)                     features/servers/api/servers.api.ts
            └─ fetchPage('/servers', serverOutSchema, { query:{ page, size } })
                 └─ apiRequest GET                 lib/api/client.ts
                      • buildUrl añade ?page=&size=
                      • paginatedEnvelope(serverOutSchema).safeParse(json)
  ◄── { items, pagination }
  └─ <DataTable data={items} columns=… />         components/ui/DataTable.tsx
  └─ <Pagination …/>  onPageChange → setPage      components/ui/Pagination.tsx
```

Notas de comportamiento:

- `keepPreviousData` mantiene la tabla anterior mientras carga la nueva página (sin
  parpadeo); `Pagination` muestra "actualizando…".
- **Paginación y filtros son server-side** (se mandan como query params soportados por la
  API: `page`, `size`, `server_id`, `owner_id`, `model_id`, `status`, `engine`, `active`).
- **Orden y búsqueda global son client-side** sobre la página ya cargada — la API no los
  expone server-side (ver [ADR-0003](adr/0003-tablas-orden-busqueda-cliente.md)). Esa
  lógica vive dentro de `DataTable.tsx` (TanStack Table).
- Cambiar un filtro hace `setPage(1)` y React Query refetch con la nueva `queryKey`.

---

## Escenario D — Crear y aprovisionar (mutación con `?provision` 🔌)

Ejemplo: crear una base de datos y aprovisionarla en el motor (`CREATE DATABASE` + `GRANT`).

```
ManagedDatabaseForm (RHF + Zod; selects dependientes)   features/managed-databases/components/ManagedDatabaseForm.tsx
  • Combobox Servidor → al cambiar, resetea owner_id (debe ser del mismo servidor)
  • Combobox Propietario → useServerUserOptions(serverId)  (cross-feature)
  • Switch "Aprovisionar en el motor 🔌"
  └─ submit → ManagedDatabaseFormModal.handleSubmit       .../components/ManagedDatabaseFormModal.tsx
       └─ useCreateManagedDatabase().mutate({ body, provision })   .../hooks/use-managed-databases.ts
            └─ createManagedDatabase(body, provision)               .../api/managed-databases.api.ts
                 └─ mutateData('POST','/managed-databases', schema, { body, query:{ provision } })
```

En `onSuccess` del hook:

- `invalidateQueries({ queryKey: queryKeys.managedDatabases.all })` → la lista se refresca.
- Si `provision=true` pero la BD vuelve con `status: 'error'` (el `CREATE` falló en el
  motor, **sin rollback**), se muestra un **toast de error** con `db.notes`; si no, toast
  de éxito.

En `onError` (incluye **502** "no alcanzable" / **504** "timeout" del motor):

- `toApiError(error).message` alimenta el toast; `ApiError.isEngineError` permite el
  texto extra de `ErrorState` cuando aplica.

> Las operaciones 🔌 son **request/response normales pero lentas**: no hay streaming. El
> botón queda en `isPending` (spinner) hasta la respuesta. Ver
> [ADR sobre ausencia de streaming](adr/0006-sin-streaming.md).

---

## Escenario E — Borrado con doble confirmación (`?drop_remote`)

Ejemplo: borrar una BD del motor (`DROP DATABASE`), que exige reescribir el nombre exacto.

```
ManagedDatabasesPage: clic "Eliminar" → setDeleteTarget(db)
  └─ {deleteTarget && <DeleteManagedDatabaseDialog database={deleteTarget} … />}   (montaje condicional = estado fresco)
       └─ <ConfirmDialog confirmWord={dropRemote ? db.name : undefined} …>          components/ui/ConfirmDialog.tsx
            • Switch "Eliminar también del motor (DROP DATABASE) 🔌" → dropRemote
            • Si dropRemote: el botón Eliminar se habilita SOLO al teclear db.name exacto
       └─ onConfirm → useDeleteManagedDatabase().mutate({ id, dropRemote, confirmName })
            └─ deleteManagedDatabase(id,{ dropRemote, confirmName })
                 └─ mutateVoid('DELETE', '/managed-databases/{id}', { query:{ drop_remote, confirm_name } })
```

- Sin `drop_remote`: solo borra del inventario (el objeto sigue en el motor).
- Con `drop_remote`: `confirm_name` debe coincidir exacto o el backend responde **422**.
  La UI ya obliga a teclearlo (defensa en el cliente), pero el backend es la autoridad.
- El mismo patrón aplica a usuarios del motor (`confirm_username`,
  `DeleteServerUserDialog`). Un usuario que posee BDs no se puede borrar → **409**
  (toast con el motivo).
- **Montaje condicional** (`{target && <Dialog/>}`): el diálogo se monta nuevo cada vez,
  así su estado interno (`dropRemote`, texto tecleado) empieza limpio sin usar efectos.

---

## Escenario F — Introspección (queries dependientes 🔌)

Ejemplo: explorar la estructura de un servidor (solo lectura, nunca filas).

```
ServerDetailPage (tab "Introspección")            features/servers/pages/ServerDetailPage.tsx
  └─ IntrospectionExplorer(serverId)              features/servers/components/IntrospectionExplorer.tsx
       ├─ useServerDatabases(serverId, enabled:true)        → GET /servers/{id}/databases 🔌
       │     (Combobox de bases de datos)
       ├─ al elegir BD →  useTables(serverId, db, enabled)  → GET /servers/{id}/databases/{db}/tables 🔌
       │     (Combobox de tablas)
       └─ al elegir tabla → useTableSchema(serverId, db, table, enabled) → .../tables/{t}/schema 🔌
             (tabla de columnas + PK/FK/índices)
```

- Los usuarios del motor tienen su **propia** pestaña ("Usuarios", Escenario L) — ya no
  se listan aquí en plano; la vista agrupada por username reemplaza ese uso de
  `GET /servers/{id}/users`.

(Hooks en `features/servers/hooks/use-introspection.ts`.)

- Cada nivel se **habilita** (`enabled`) solo cuando se eligió el anterior (queries
  dependientes de React Query). Al cambiar de BD se resetea la tabla seleccionada.
- Cada llamada es 🔌: muestra su propio `Spinner`/`ErrorState` inline; un servidor no
  alcanzable produce **502/504** que se renderizan en su sección sin tumbar la página.

---

## Escenario G — 401 a mitad de sesión (handler global)

Qué pasa si la cookie expira y luego haces cualquier acción.

```
Cualquier hook → servicio → apiRequest GET/POST/…   lib/api/client.ts
  • respuesta 401 (y la llamada NO usó suppressAuthHandler)
  • apiRequest invoca unauthorizedHandler?.()
        └─ registrado por SessionProvider:           features/auth/SessionProvider.tsx
              queryClient.setQueryData(queryKeys.auth.me(), null)
  • throw normalizeApiError(401, body)               (el hook que llamó recibe el error)

Como auth/me pasó a null → useSession marca isUnauthenticated
  └─ ProtectedRoute redirige a /login (preservando la ruta en state.from)
```

Resultado: una sola fuente de verdad (`auth/me` en caché) decide si hay sesión. El login
**no** dispara este flujo (usa `suppressAuthHandler`), porque su 401 significa
"credenciales inválidas", no "sesión expirada".

---

## Escenario H — Normalización de errores y estados de UI

Toda rama de error converge en `ApiError` (`lib/api/errors.ts`):

```
fetch rechaza (offline/CORS/abort)  → networkError()         → ApiError{ status:0 }
respuesta !ok                       → normalizeApiError(status, body):
    body.detail = "texto"           → message = "texto"                  (forma de api-reference.md)
    body.detail = { msg, type, … }  → message = msg, type = type          (handlers reales del backend)
    body.detail.context = [...]     → fieldErrors[]   (422 en modo desarrollo)
    sin detalle utilizable          → mensaje de fallback por status (incl. 502/504)
schema.safeParse falla              → ApiError{ status:0, "respuesta inesperada" } + console.error  (drift de contrato)
```

Cómo lo consume la UI:

- **Carga fallida de una vista** → `<ErrorState error onRetry={refetch}/>`
  (`components/ui/ErrorState.tsx`); si `isEngineError` (502/504) añade una nota.
- **Mutaciones** → toast de error vía `useToast()` con `toApiError(error).message`.
- **422 con `fieldErrors`** → se pueden mapear a campos del formulario (RHF `setError`).
- **Crash de render en una sección** → `SectionErrorFallback` (error boundary por sección
  en `AppShell`).

---

## Escenario I — Gestión de permisos de un usuario (grants 🔌)

Desde la tabla de usuarios del motor, el botón "Permisos" abre un modal con tres pestañas.

```
ServerUsersPage: clic "Permisos" → setGrantsTarget(user)
  └─ <ServerUserGrantsModal user engine key={user.id} … />   features/server-users/components/ServerUserGrantsModal.tsx
       ├─ Pestaña "Permisos efectivos"
       │    └─ useUserGrants(id, database?, enabled)          features/server-users/hooks/use-user-grants.ts
       │         └─ listUserGrants(id, database)              → GET /server-users/{id}/grants 🔌
       │    (PostgreSQL: el campo `database` lleva debounce para no consultar el motor en cada tecla)
       ├─ Pestaña "Otorgar / revocar"  → GrantManager        features/server-users/components/GrantManager.tsx
       │    • construye object_ref según el nivel (database/schema/table/column/sequence/routine)
       │    • "Comprobar delegación" → useCheckGrantable(serverId) → POST /servers/{id}/grantable 🔌
       │    • Otorgar → useGrantPrivileges(id)   → POST   /server-users/{id}/grants 🔌
       │    • Revocar → useRevokePrivileges(id)  → DELETE /server-users/{id}/grants 🔌 (cuerpo + ?confirm_grantee si cascade)
       └─ Pestaña "Aplicar perfil"     → ApplyProfilePanel    features/server-users/components/ApplyProfilePanel.tsx
            └─ useApplyProfile(id)     → POST /server-users/{id}/apply-profile/{profileId} 🔌
```

- Los grants son 🔌 (introspección/DCL en el motor real); cada mutación invalida
  `['server-users', id, 'grants']` para refrescar la pestaña de permisos efectivos.
- `REVOKE … CASCADE` (solo PostgreSQL) exige `confirm_grantee` = username (defensa en cliente + `422` del backend).
- El modal lleva `key={user.id}` para **reiniciar su estado entre filas** (ver gotcha en `maintenance.md`).
- Los privilegios se eligen con `PrivilegeMultiSelect` (poblado desde el catálogo `/privileges` por motor).
- **Atajo:** crear usuario + aprovisionar + grants iniciales en una sola llamada →
  `useProvisionServerUser` → `POST /server-users/provision`.

---

## Escenario J — Migraciones de esquema (blueprint y por BD 🔌)

Dos niveles: **definir** los deltas SQL en el blueprint (inventario) y **aplicarlos** sobre cada BD real (🔌).

```
# Definir (no toca motores)
DatabaseModelsPage: "Migraciones" → ModelMigrationsModal(model)       features/database-models/components/ModelMigrationsModal.tsx
  ├─ useModelMigrations(modelId, {page,size})  → GET  .../migrations            (resúmenes paginados)
  ├─ Nueva migración → useCreateModelMigration → POST .../migrations
  │     (la respuesta trae `translated` {mysql,postgresql} + `down_sql_suggested`; se muestran para revisión)
  ├─ Detalle/edición → useUpdateModelMigration → PATCH .../migrations/{version} (confirmar down_sql / overrides)
  └─ Aplicar a todas → ApplyAllDialog → useApplyAllMigrations → POST .../migrations/apply-all 🔌 (dry-run/force/max_databases)

# Aplicar sobre UNA BD (🔌)
ManagedDatabasesPage: "Migraciones" → ManagedDatabaseMigrationsModal(db)  features/managed-databases/components/ManagedDatabaseMigrationsModal.tsx
  ├─ useMigrationStatus(dbId)            → GET  .../migrations/status         (actual vs. pendientes)
  ├─ Aplicar → useApplyMigrations(dbId)  → POST .../migrations/apply          (dry-run = previsualización; isDryRunResult discrimina)
  ├─ Rollback → useRollbackMigration     → POST .../migrations/rollback?confirm_version=…  (destructivo, doble confirmación)
  ├─ Stamp → useStampMigration           → POST .../migrations/stamp?version=…            (marca sin ejecutar SQL)
  └─ Historial → useMigrationHistory     → GET  .../migrations/history        (paginado)
```

- Requiere `model_id` asignado en la BD; si no, el backend responde **422** y el modal lo avisa y deshabilita.
- `apply` en `dry_run` **no muta ni notifica** (es previsualización); `isDryRunResult()` distingue la respuesta
  del envelope (`lib/contracts/db-migrations.ts`).
- Tras `apply`/`rollback`/`stamp` se invalida `queryKeys.managedDatabases.all` (estado, historial, detalle y listas).
- **Cuarentena:** un fallo deja la BD en `status:"error"`; se reintenta con `?force=true`.

---

## Escenario K — Administración: rotación de cifrado

```
AdminPage: "Rotar clave" → ConfirmDialog → useRotateCrypto()        features/admin/hooks/use-crypto-rotation.ts
  └─ rotateCrypto()  → POST /admin/crypto/rotate  → { servers_reencrypted, server_users_reencrypted }
```

- Opera sobre la BD de metadatos del gateway (**no toca motores destino**).
- El cliente solo muestra los contadores devueltos; nunca maneja claves ni credenciales.

---

## Escenario L — Usuarios del motor por identidad física (adopción opcional 🔌)

Pestaña "Usuarios" de `ServerDetailPage`. Ver `docs/features/engine-users-management.md`.

```
ServerDetailPage (tab "Usuarios")                 features/servers/pages/ServerDetailPage.tsx
  └─ EngineUsersPanel(serverId, engine)            features/servers/components/EngineUsersPanel.tsx
       └─ useGroupedEngineUsers(serverId)          → GET /servers/{id}/users/grouped 🔌
             (una fila por username; `supports_hosts` decide si se muestra la columna/expansión de hosts)

       Por identidad, según `status` (adopted | unmanaged | orphan):
       ├─ adopted   → Revelar (si has_password) · Rotar · Ver grants · Eliminar
       │     ├─ RevealEngineUserPasswordModal → useRevealEngineUserPassword(serverId)
       │     │     → POST /servers/{id}/users/reveal-password 🔌  (secreto NUNCA cacheado; solo estado local del modal)
       │     ├─ ChangeEngineUserPasswordModal → useChangeEngineUserPassword(serverId)
       │     │     → PATCH /servers/{id}/users/password 🔌
       │     ├─ "Ver grants" → useServerUser(server_user_id) → <ServerUserGrantsModal>  (reusa features/server-users)
       │     └─ DeleteEngineUserDialog → useDeleteEngineUser(serverId)
       │           → DELETE /servers/{id}/users 🔌 (confirm_username exacto; 409 si posee BDs gestionadas)
       ├─ unmanaged → Adoptar (reusa <AdoptUserModal> de features/server-users) · Rotar (adopt=true) · Eliminar · Agregar host
       └─ orphan    → Recrear en el motor (CreateEngineUserModal prefill) · Limpiar registro (useDeleteServerUser, dropRemote:false)

       Por username (si supports_hosts) → AddEngineUserHostModal → useAddEngineUserHost(serverId)
             → POST /servers/{id}/users/add-host 🔌  (reuse_password clona el hash; copy_grants es best-effort)
```

- **Complementa, no reemplaza** el inventario `/server-users`: toda mutación por identidad
  invalida tanto `queryKeys.servers.groupedUsers(serverId)` como `queryKeys.serverUsers.all`,
  porque puede crear/actualizar la fila de inventario (`adopt=true`) sin pasar por ese feature.
- **Guard anti auto-lockout**: crear/rotar/dropear/agregar-host sobre `Server.root_username`
  responde **409** — el backend lo protege, el frontend solo muestra el `message`.
- **PostgreSQL** (`supports_hosts:false`): sin columna de host, sin expansión, sin botón
  "Agregar host" (el endpoint daría 422 — ni se ofrece).
- **Revelar contraseña** es una acción explícita (no se auto-dispara al abrir el modal) y
  su resultado vive únicamente en el estado del componente: al cerrar el modal, desaparece.

---

## Resumen: "¿qué toco para…?"

| Quiero cambiar… | Archivo(s) |
|---|---|
| El shape esperado de una respuesta | `src/lib/contracts/<entidad>.ts` |
| La ruta/método/flag de un endpoint | `src/features/<f>/api/<f>.api.ts` |
| Cuándo se invalida/refresca la caché | `src/features/<f>/hooks/*` + `src/lib/api/query-keys.ts` |
| Cómo se adjunta la cookie / maneja 401 | `src/lib/api/client.ts` |
| El texto/clasificación de un error | `src/lib/api/errors.ts` |
| El layout, navegación o boundaries | `src/components/layout/*` |
| Un color del tema | `src/styles/theme.css` (una variable) |
