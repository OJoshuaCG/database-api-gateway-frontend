# Prompt para backend — un perfil de permisos recién creado no aparece en «Aplicar perfil»

> Documento para pasar al equipo/agente de **backend** del Database API Gateway.
> Contiene: síntoma, endpoints involucrados, flujo de ejecución exacto del frontend, hipótesis
> ordenadas por probabilidad con su comando de validación, y las preguntas concretas a responder.
> Todo lo descrito aquí se verificó leyendo el código del frontend (rutas de archivo incluidas).

---

## 0. Actualización del 2026-09-02 — qué cambió en el frontend

Al implementar **api-reference-v21** la pantalla de «Aplicar perfil» desapareció como tal: vive
dentro de «Otorgar / revocar» (`GrantPanel`). En el camino cambió la llamada del punto **3** de la
tabla de abajo, y eso **descarta dos de las hipótesis desde este lado**:

- **H3 (motor `mysql` vs `mariadb`) ya no puede ser la causa en el frontend.** El listado
  **dejó de mandar `engine`**: `usePermissionProfileOptions()` pide todos los perfiles activos y
  el recorte se hace en cliente **por familia de motor**, no por igualdad. Es lo que exige v21 §10:
  un perfil `mysql` sí se puede aplicar a un servidor MariaDB, y filtrar por igualdad perdía casos
  válidos. Si el perfil sigue sin aparecer, ya no es por el `engine`.
- **H6 (el servidor no está en la primera página de `/servers`) tampoco aplica.** El motor lo
  resuelve `ServerUserDetailPage` con `GET /servers/{id}`, no buscando dentro de un listado
  paginado.

**Lo que sigue abierto es H1/H2**: la llamada mantiene `active=true`, así que un perfil que nazca
con `is_active = false` —o un filtro `active` que el backend no reconozca— lo seguiría ocultando.
Esa mitad del diagnóstico sigue siendo válida tal cual está escrita más abajo.

---

## 1. Síntoma reportado

1. El usuario crea un perfil de permisos en **Perfiles de permisos** (`/permission-profiles`).
2. La creación aparenta ser exitosa (toast «Perfil de permisos creado») y **el perfil sí se ve
   listado en esa misma página**.
3. Va a **Usuarios del motor** → abre el modal de permisos de un usuario → pestaña
   **«Aplicar perfil»** → **el perfil recién creado no aparece** en el desplegable.

El dato importante es la **asimetría**: la misma entidad se ve en una pantalla y no en la otra.
Las dos pantallas llaman al **mismo endpoint** (`GET /permission-profiles`) pero **con distintos
query params**. Esa diferencia de params es el centro de la investigación.

---

## 2. Endpoints involucrados

Base URL del frontend: `VITE_API_BASE_URL`, que **ya incluye `/api/v1`**
(ej. `http://localhost:8000/api/v1`). Autenticación por **cookie de sesión**
(`credentials: 'include'`). Toda respuesta debe traer `X-Request-ID`.

| # | Método y ruta | Cuándo se ejecuta | Query params / cuerpo |
|---|---|---|---|
| 1 | `POST /permission-profiles` | Al guardar el formulario de creación | Cuerpo: `{ name, engine, description, items[] }` — **sin `is_active`** |
| 2 | `GET /permission-profiles` | Al abrir/filtrar la página «Perfiles de permisos» | `engine?` — **NO envía `active`** |
| 3 | `GET /permission-profiles` | Al entrar a la pestaña «Aplicar perfil» | `engine?` **y `active=true`** |
| 4 | `GET /servers?page=1&size={VITE_MAX_PAGE_SIZE}` | Al cargar la página de Usuarios del motor | Se usa para resolver el `engine` del servidor del usuario |
| 5 | `POST /server-users/{id}/apply-profile/{profile_id}` | Al pulsar «Aplicar perfil» | Cuerpo: `{ object_mappings: [{ level, object_ref }] }` |

Los endpoints **1, 2 y 3 son puro inventario** (no tocan ningún motor). El **5** sí ejecuta sobre el
motor. El problema reportado está en el **3**.

### Contrato de salida que el frontend exige (validación estricta)

`PermissionProfileOut` — `src/lib/contracts/permission-profiles.ts:25-34`:

```
id: int              (requerido)
name: string         (requerido)
engine: "mysql" | "mariadb" | "postgresql"   (requerido, enum exacto, minúsculas)
description: string | null                    (opcional)
is_active: boolean   (requerido)   ← nótese: el CAMPO se llama is_active
items: [{ level: GrantLevel, privileges: string[], requires_confirmation: boolean }]
created_at: string   (requerido)
updated_at: string   (requerido)
```

`GrantLevel` = `global | database | schema | table | column | sequence | …`
(enum en `src/lib/contracts/common.ts:32`).

Envelope esperado: `{ "data": [ ...PermissionProfileOut ], "message"?: string }` — lista **no
paginada**.

---

## 3. Flujo de ejecución exacto del frontend

### A. Creación del perfil

`PermissionProfilesPage` → `PermissionProfileFormModal` → `useCreatePermissionProfile`
(`src/features/permission-profiles/hooks/use-permission-profiles.ts:30-41`)

```
POST {BASE}/permission-profiles
Cuerpo enviado por toCreate() (src/features/permission-profiles/components/PermissionProfileForm.tsx:57-64):
{
  "name": "<nombre>",
  "engine": "mysql" | "mariadb" | "postgresql",
  "description": "<texto>" | null,
  "items": [ { "level": "database", "privileges": ["SELECT", ...] } ]
}
```

**⚠ Punto crítico #1:** el formulario **muestra un switch «Activo» que arranca en `true`**
(`DEFAULTS.is_active = true`, línea 38), pero **`toCreate()` NO incluye `is_active` en el cuerpo** —
el contrato `PermissionProfileCreate` no admite ese campo. Es decir: **el valor inicial de
`is_active` lo decide exclusivamente el backend**. El usuario cree haberlo creado activo porque vio
el switch encendido, pero nunca se envió.

Al tener éxito se invalida la caché con la clave prefijo `['permission-profiles']`, lo que **sí**
alcanza la clave del desplegable de «Aplicar perfil». **Descartado, por tanto, que sea un problema
de caché del frontend.**

### B. Listado en la página «Perfiles de permisos» (donde SÍ se ve)

`PermissionProfilesPage` → `usePermissionProfiles({ engine: engine?.value })`

```
GET {BASE}/permission-profiles?engine=<motor>      ← solo si hay filtro de motor elegido
```

**No se envía `active`.** Por eso esta pantalla muestra activos e inactivos, y de hecho tiene una
columna con badge **«Activo» / «Inactivo»** (`PermissionProfilesPage.tsx:66-71`).

### C. Pestaña «Aplicar perfil» (donde NO se ve)

`ServerUsersPage` → `ServerUserGrantsModal` (pestañas `Permisos efectivos` / `Otorgar/revocar` /
`Aplicar perfil`) → `ApplyProfilePanel` → `usePermissionProfileOptions(engine)`
(`src/features/permission-profiles/hooks/use-permission-profile-options.ts:7-14`)

```
GET {BASE}/permission-profiles?engine=<motor del servidor>&active=true
```

**⚠ Punto crítico #2:** aquí sí se manda **`active=true`**. Y nótese la discrepancia de nombre:
el **filtro** se llama `active`, pero el **campo del modelo de salida** se llama `is_active`.

**⚠ Punto crítico #3:** el `engine` es el del **servidor** al que pertenece el usuario, y el filtro
es una **coincidencia exacta de string**. Se resuelve así
(`src/features/server-users/pages/ServerUsersPage.tsx:38-42, 213`):

```
GET /servers?page=1&size={VITE_MAX_PAGE_SIZE}  →  Map<server.id, server.engine>
engine = Map.get(usuario.server_id) ?? null
```

Si `engine` termina en `null`, el param `engine` **no se envía** (el `buildUrl` omite `null`/
`undefined`/`''` — `src/lib/api/client.ts:39-53`), y entonces la petición sería
`?active=true` a secas.

Comportamiento del panel según la respuesta (`ApplyProfilePanel.tsx:48-67`):

| Respuesta del backend | Lo que ve el usuario |
|---|---|
| `data: []` (lista válida y vacía) | Estado vacío: **«No hay perfiles para este motor»** |
| Lista con ≥1 perfil | El desplegable con los perfiles |
| Cualquier item que **no cumpla el contrato** | Estado de **error** (ver abajo) |
| 4xx/5xx | Estado de error con el mensaje del backend |

**⚠ Punto crítico #4 — la validación es todo-o-nada.** El cliente valida la respuesta completa con
Zod (`src/lib/api/client.ts:128-134`). Si **un solo** perfil de la lista viola el contrato (falta
`is_active`, falta `updated_at`, `engine` viene como `"MySQL"` en mayúsculas, un `level` fuera del
enum…), **se descarta la respuesta entera** y se lanza `ApiError` con
`«La API devolvió una respuesta inesperada.»`, dejando en consola
`[api] Respuesta no conforme al contrato: /permission-profiles [issues...]`.
Resultado: la lista se ve vacía/en error **aunque el backend haya devuelto los perfiles
correctamente en cuanto a negocio**.

### D. Aplicación del perfil (para contexto; no es donde falla)

`ApplyProfilePanel.handleApply()` construye un `object_mapping` por cada item del perfil:

```
POST {BASE}/server-users/{userId}/apply-profile/{profileId}
{
  "object_mappings": [
    { "level": "global",   "object_ref": {} },
    { "level": "database", "object_ref": { "database": "<bd>", "schema": "public" } }   // schema solo si PostgreSQL
  ]
}
```

---

## 4. Qué está pasando — hipótesis ordenadas por probabilidad

### H1 — El backend crea el perfil con `is_active = false` (o `NULL`) por defecto ⭐ la más probable

Explica **exactamente** la asimetría observada: la página de perfiles no filtra y lo muestra; la
pestaña «Aplicar perfil» filtra `active=true` y lo oculta. Y encaja con el punto crítico #1: el
frontend **nunca envía `is_active` al crear**, así que el default es 100 % responsabilidad del
backend.

**Validación inmediata (sin tocar código):** mirar el badge de la columna «Estado» del perfil en la
página «Perfiles de permisos». Si dice **«Inactivo»**, la causa es esta.

```bash
# ¿Con qué is_active nace un perfil?
curl -s -b cookies.txt -X POST "$BASE/permission-profiles" \
  -H 'Content-Type: application/json' \
  -d '{"name":"prueba-default","engine":"mysql","description":null,
       "items":[{"level":"database","privileges":["SELECT"]}]}' | jq '.data.is_active'
```

- Si devuelve `false` → **es esto**. Decidir: ¿el default debe ser `true`? (lo esperable para un
  perfil que el usuario acaba de crear), o bien el frontend debe permitir enviar `is_active` en el
  `POST` y el contrato `PermissionProfileCreate` debe admitirlo.
- Si devuelve `true` → descartar y pasar a H2.

### H2 — El backend no reconoce el filtro `active` (nombre desalineado: `active` vs `is_active`)

El frontend envía `?active=true`, pero el campo del modelo es `is_active`. Si el endpoint declara el
query param como `is_active`, entonces `active=true`:

- se ignora silenciosamente (FastAPI descarta params no declarados) → devolvería **todos** los
  perfiles, y entonces el problema **no** sería este; **o**
- se rechaza con `422` si hay validación estricta de extras → el panel mostraría un **error**, no el
  estado vacío.

```bash
# ¿El filtro se respeta? Comparar los tres resultados.
curl -s -b cookies.txt "$BASE/permission-profiles"                  | jq '.data | length'
curl -s -b cookies.txt "$BASE/permission-profiles?active=true"      | jq '.data | length'
curl -s -b cookies.txt "$BASE/permission-profiles?is_active=true"   | jq '.data | length'
```

Si el conteo de `?active=true` es idéntico al sin filtro **y** hay perfiles inactivos en la base,
el param se está ignorando → **confirmar el nombre correcto del query param** para alinear al
frontend.

### H3 — Desalineación de motor: `mysql` vs `mariadb`

El filtro `engine` es coincidencia **exacta**. El formulario de creación arranca con
`engine: 'mysql'` por defecto (`PermissionProfileForm.tsx:36`). Si el servidor del usuario es
**MariaDB** y el perfil se creó (por el default, sin cambiarlo) como **mysql**, la pestaña pide
`?engine=mariadb&active=true` y **no lo encuentra**. El mensaje que ve el usuario es literalmente
«No hay perfiles para este motor», lo que apunta a esto.

```bash
# ¿Con qué engine quedó el perfil y qué engine tiene el servidor?
curl -s -b cookies.txt "$BASE/permission-profiles" | jq '.data[] | {id,name,engine,is_active}'
curl -s -b cookies.txt "$BASE/servers?page=1&size=100" | jq '.data[] | {id,name,engine}'
```

**Pregunta de diseño para backend:** ¿debe `GET /permission-profiles?engine=mariadb` devolver
también los perfiles `mysql` (y viceversa), al ser familia compatible? En el módulo de comparación
de esquemas el gateway **sí** trata MySQL↔MariaDB como una familia. Si aquí también deben ser
compatibles, es un cambio de backend (o el frontend tendría que consultar por ambos motores).

### H4 — Un perfil rompe el contrato de salida y tumba la respuesta completa

Ver punto crítico #4. Sospechar de esto si el usuario ve un **error** en lugar del vacío, o si en la
consola del navegador aparece `[api] Respuesta no conforme al contrato: /permission-profiles`.

```bash
# Revisar que TODOS los perfiles cumplan: is_active presente, engine en minúsculas,
# created_at/updated_at presentes, items[].requires_confirmation presente.
curl -s -b cookies.txt "$BASE/permission-profiles?active=true" | jq '.data[] |
  {id, name, engine, is_active,
   has_created: (has("created_at")), has_updated: (has("updated_at")),
   items: [.items[] | {level, has_rc: (has("requires_confirmation"))}]}'
```

Causas típicas: `requires_confirmation` ausente en algún item, `engine` con mayúsculas, `level` con
un valor nuevo que el enum del frontend no conoce, `updated_at` en `null` en un registro recién
creado (el contrato lo exige **no nulo**).

### H5 — El envelope de este endpoint no es el de lista no paginada

El frontend espera `{ "data": [...] }`. Si `GET /permission-profiles` empezara a devolver
`{ "data": { "items": [...] } }` o a paginar de otra forma, fallaría la validación (mismo efecto que
H4). Confirmar que sigue siendo **lista no paginada**.

```bash
curl -s -b cookies.txt "$BASE/permission-profiles?active=true" | jq 'keys, (.data|type)'
# Esperado: incluye "data", y .data es "array"
```

### H6 — El servidor del usuario no está en la primera página de `/servers`

`useServerOptions` pide `page=1&size=VITE_MAX_PAGE_SIZE`. Con más servidores que ese tamaño, el
`engine` del usuario se resuelve a `null` y la pestaña pediría `?active=true` sin filtro de motor.
Esto **no** produciría lista vacía (mostraría perfiles de todos los motores), así que es la menos
probable; se incluye solo para descartarla. Es un asunto del frontend, no del backend.

---

## 5. Preguntas concretas a responder desde backend

1. **`POST /permission-profiles`: ¿cuál es el valor por defecto de `is_active`?** ¿`true`, `false` o
   `NULL`? Si no es `true`, ¿es intencional? ¿Debería `PermissionProfileCreate` aceptar `is_active`
   para que el frontend pueda enviarlo?
2. **`GET /permission-profiles`: ¿cómo se llama exactamente el query param del filtro de estado —
   `active` o `is_active`?** ¿Qué hace ante un valor no reconocido: lo ignora o responde `422`?
3. ¿Cómo se serializa el booleano esperado: `true` / `1` / `True`? (el frontend envía **`active=true`**).
4. **¿El filtro `engine` es de coincidencia exacta?** ¿Debe `engine=mariadb` incluir perfiles
   `mysql` por compatibilidad de familia, como sí ocurre en comparación de esquemas?
5. ¿`GET /permission-profiles` sigue siendo **lista no paginada** con envelope `{ data: [...] }`?
6. ¿Puede algún perfil salir con `updated_at` nulo, `engine` en mayúsculas, o items sin
   `requires_confirmation`? El frontend **exige** esos tres campos y descarta la respuesta completa
   si falta cualquiera.
7. Con el `X-Request-ID` que adjuntemos, ¿pueden confirmar en logs qué query params llegaron
   realmente y cuántas filas devolvió la consulta?

---

## 6. Datos que el frontend puede aportar para acelerar el diagnóstico

- **Badge de estado del perfil** en la página «Perfiles de permisos»: ¿dice «Activo» o «Inactivo»?
  (esto solo ya decide H1).
- **`engine` del perfil** vs **`engine` del servidor** del usuario (decide H3).
- **Pestaña Network** del navegador, petición a `/permission-profiles` al abrir «Aplicar perfil»:
  URL completa con query string, código de estado, `X-Request-ID` y cuerpo de la respuesta.
- **Consola del navegador**: presencia o ausencia de
  `[api] Respuesta no conforme al contrato: /permission-profiles` (decide H4/H5).
- Qué se ve en la pestaña: el vacío **«No hay perfiles para este motor»** (respuesta válida y vacía
  → H1/H2/H3) o un **estado de error** (→ H4/H5 o 4xx/5xx).

---

## 7. Resumen en una línea

La pestaña «Aplicar perfil» pide `GET /permission-profiles?engine=<motor del servidor>&active=true`,
mientras la página de perfiles pide `GET /permission-profiles?engine=<filtro>` sin `active`; el
perfil se crea **sin enviar `is_active`** (el default es del backend) y el filtro de motor es de
coincidencia exacta — así que lo más probable es que el perfil haya nacido **inactivo**, o que su
**`engine` no coincida** con el del servidor, o que el **filtro `active` no se esté respetando**.

### Archivos del frontend implicados (para referencia cruzada)

- `src/features/permission-profiles/hooks/use-permission-profile-options.ts` — la consulta de la pestaña (`active: true`)
- `src/features/permission-profiles/hooks/use-permission-profiles.ts` — la consulta de la página (sin `active`)
- `src/features/permission-profiles/api/permission-profiles.api.ts` — endpoints de perfiles
- `src/features/permission-profiles/components/PermissionProfileForm.tsx` — `toCreate()` no envía `is_active`
- `src/features/server-users/components/ApplyProfilePanel.tsx` — estados vacío/error y armado de `object_mappings`
- `src/features/server-users/components/ServerUserGrantsModal.tsx` — las 3 pestañas
- `src/features/server-users/pages/ServerUsersPage.tsx` — resolución del `engine` del servidor
- `src/lib/contracts/permission-profiles.ts` — contrato exigido
- `src/lib/api/client.ts` — `buildUrl` (omite nulos) y validación estricta todo-o-nada
