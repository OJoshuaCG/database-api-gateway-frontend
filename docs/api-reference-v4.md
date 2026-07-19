# API Reference v4 — Usuarios del motor por identidad física

> **Guía para el equipo de frontend.** Addendum de [`api-reference.md`](api-reference.md) y
> [`api-reference-v3.md`](api-reference-v3.md). Documenta la **vista agrupada** de usuarios del
> motor y los **5 endpoints nuevos** que operan por identidad física (`server_id` + `username` +
> `host`) directamente sobre el motor destino, esté o no adoptada esa identidad en el inventario
> (`server_users`).
>
> Convenciones (base URL `/api/v1`, envelope `ApiResponse[T]`, auth por cookie de sesión, códigos
> de error, paginación) idénticas a las del documento original (§3).

**Versión de la API:** `v1` · 🔌 = lee/toca el servidor de BD destino · 🔒 = requiere sesión admin

---

## Por qué existe esto

El listado plano de §6 (`GET /servers/{id}/users` → `list[EngineUserInfo]`) sigue existiendo por
compatibilidad, pero **ya no se usa en el frontend**: repetía el username una vez por cada host en
MySQL/MariaDB (`'alice'@'localhost'` y `'alice'@'%'` son cuentas separadas, cada una con su propio
password y grants) y solo servía para leer, nunca para gestionar. La vista agrupada reemplaza ese
uso; `IntrospectionExplorer` perdió su tarjeta "Usuarios del motor" y esa gestión vive ahora en la
pestaña "Usuarios" de `ServerDetailPage`.

## Capacidades

1. **Vista agrupada** (`GET /servers/{id}/users/grouped`) — una fila por username, cruzando el
   plano en vivo del motor con el inventario. Cada identidad trae `status`: `adopted` (en ambos
   planos) · `unmanaged` (solo motor, adoptable) · `orphan` (solo inventario, drift).
2. **CRUD por identidad sin adopción previa** — crear (`POST /users`), rotar contraseña
   (`PATCH /users/password`) y eliminar (`DELETE /users`) funcionan tenga o no fila de inventario.
   Con `adopt=true` (o si ya existía fila) se sincroniza `server_users`, incluida la contraseña
   cifrada.
3. **Agregar host** (`POST /users/add-host`, solo MySQL/MariaDB) — clona una cuenta existente a un
   nuevo host, reutilizando el hash (`SHOW CREATE USER`) o con contraseña nueva; opcionalmente
   replica los grants (best-effort).
4. **Revelar contraseña** (`POST /users/reveal-password`) — solo si el gateway la fijó él mismo
   (create/rotación vía gateway); nunca si el motor solo guarda un hash que el gateway no conoció.

## Asimetría por motor — `supports_hosts`

| Concepto | MySQL / MariaDB | PostgreSQL |
|---|---|---|
| Identidad | `'user'@'host'` (varias por nombre) | un ROLE (una por nombre, sin host) |
| `supports_hosts` | `true` | `false` |
| Columna/expansión de host en la UI | mostrar | **ocultar** |
| Botón "Agregar host" | mostrar | **ocultar** (el endpoint daría `422`) |

El frontend lee `supports_hosts` **una vez** por respuesta y adapta toda la pestaña: en
PostgreSQL cada usuario tiene una sola identidad con `host: null` y la tabla no es expandible.

## Endpoints

### `GET /api/v1/servers/{server_id}/users/grouped`

Respuesta `GroupedEngineUsersOut`:

```jsonc
{
  "data": {
    "dialect": "mysql",
    "supports_hosts": true,
    "users": [
      {
        "username": "alice",
        "identity_count": 2,
        "identities": [
          { "host": "localhost", "status": "adopted", "server_user_id": 12,
            "has_password": true, "is_active": true, "notes": null },
          { "host": "%", "status": "unmanaged", "has_password": false }
        ]
      }
    ]
  }
}
```

`server_user_id` es la llave hacia `/server-users/{id}/grants` (§7); solo presente si
`status != 'unmanaged'`. `has_password` habilita/deshabilita "Revelar".

### `POST /api/v1/servers/{server_id}/users` 🔌 — `EngineUserCreateIn`

```jsonc
{ "username": "alice", "host": "%", "password": "s3cr3t", "adopt": false, "notes": null }
```

Responde `201` con `{ username, host, adopted, server_user_id }`. `422` si `username`/`host` no
pasan la whitelist; `409` sobre la credencial pseudo-root del gateway.

### `PATCH /api/v1/servers/{server_id}/users/password` 🔌 — `EnginePasswordChangeIn`

```jsonc
{ "username": "alice", "host": "%", "new_password": "n3w-p4ss", "adopt": false }
```

Si ya existe fila de inventario, la contraseña **siempre** se sincroniza (`adopt` solo aplica
cuando no había fila previa). Misma forma de respuesta que create.

### `DELETE /api/v1/servers/{server_id}/users?username=&host=%&confirm_username=` 🔌

`confirm_username` debe repetir el username exacto o `422`. `409` si el usuario posee bases de
datos gestionadas, o si es la credencial pseudo-root.

### `POST /api/v1/servers/{server_id}/users/add-host` 🔌 — `AddHostIn` (solo MySQL/MariaDB)

```jsonc
{
  "username": "alice", "source_host": "%", "new_host": "10.0.0.5",
  "reuse_password": true, "new_password": null, "copy_grants": false, "adopt": false
}
```

`reuse_password=false` exige `new_password` (si falta, `422`). En PostgreSQL siempre `422`.
Responde `201` con `{ username, new_host, password_mode, grants_copied, grants_error?, adopted,
server_user_id }`; `grants_error` presente si `copy_grants=true` falló parcialmente (el host sí se
creó — mostrar como advertencia, no como fallo total).

### `POST /api/v1/servers/{server_id}/users/reveal-password` 🔌

```jsonc
{ "username": "alice", "host": "%" }
```

| Situación | Código |
|---|---|
| Usuario no está en el inventario | `404` |
| Adoptado pero el gateway no conoce la contraseña (`password_encrypted = NULL`) | `409` |
| Contraseña fijada por el gateway | `200` — `{ username, host, password }` |

Auditada (`server_user.password.reveal`). El frontend **nunca** cachea el resultado (no pasa por
React Query): vive solo en el estado local del modal mientras está abierto.

## Semántica de errores (además de §3/v3)

| Código | Causa específica de estos endpoints |
|---|---|
| `409` | Guard anti auto-lockout: operar sobre `Server.root_username` (create/password/delete/add-host). |
| `409` | `DELETE` de un usuario que posee BDs gestionadas. |
| `409` | `reveal-password` de un adoptado sin contraseña conocida por el gateway. |
| `404` | `reveal-password` de un usuario que no está en el inventario. |
| `422` | Whitelist de `username`/`host`; `add-host` en PostgreSQL; `confirm_username` incorrecto;
`reuse_password=false` sin `new_password`. |

El frontend no siempre sabe cuál es el `root_username` del servidor: para el guard 409 basta con
mostrar el `message` del backend en un toast.

## Dónde vive en el frontend

```
features/servers/pages/ServerDetailPage.tsx      (pestaña "Usuarios")
features/servers/components/EngineUsersPanel.tsx  (vista agrupada + acciones por status)
features/servers/components/{CreateEngineUserModal,ChangeEngineUserPasswordModal,
  DeleteEngineUserDialog,AddEngineUserHostModal,RevealEngineUserPasswordModal}.tsx
features/servers/hooks/use-engine-users.ts
features/servers/api/servers.api.ts               (funciones nuevas, mismo módulo que /servers)
lib/contracts/engine-users.ts
```

Reutiliza deliberadamente dos componentes de `features/server-users` en vez de duplicarlos:
`AdoptUserModal` (adoptar un `unmanaged`) y `ServerUserGrantsModal` (ver grants de un `adopted`,
resuelto vía `server_user_id` → `useServerUser`). Ver Escenario L de
[`data-flow.md`](data-flow.md) para el flujo completo.

> El texto completo de esta guía (contrato detallado, ejemplos curl, diagrama de flujo por
> `status`) fue provisto por el equipo de backend; este archivo es el resumen operativo que el
> frontend usa como contrato.
