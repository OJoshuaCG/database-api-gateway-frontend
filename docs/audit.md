# Auditoría (`/audit-log`)

Pantalla de lectura del rastro de `audit_log` (api-reference-v29 §11.3–11.4). Código en
`src/features/audit-log/`; la lógica pura (URL ⇄ filtros ⇄ query, nombres de actor, destino y
estado) vive en `audit-model.ts`, aparte de los componentes.

## Quién la ve, y por qué esa persona

Solo `policy.admin`, que hoy tiene únicamente la global `security_officer`. Es separación de
deberes: **lee el rastro quien no hace los cambios de acceso**. Un `access_admin` sin
`security_officer` no ve la entrada «Auditoría» en el `Sidebar` y, si llega por URL, recibe el
`ForbiddenState` compartido sin «Reintentar» (el listado ni se pide). Los `GET` no piden step-up:
la auditoría dice quién hizo qué, no entrega datos de terceros.

## Filtros

- **Viven en la URL**, con los nombres del backend (`?action=access.*&status=denied`). Una búsqueda
  se comparte o se recarga tal cual, y «atrás» deshace un filtro. Lo que el backend rechazaría con
  422 (un `actor_type` inventado, `page=abc`, un `size` mayor al máximo) se descarta al leer la URL.
- La barra edita un **borrador** y escribe la URL al aplicar: escribir por pulsación pediría un
  `GET` por letra. Cuando la URL cambia desde afuera, la barra se remonta con otra `key` en vez de
  sincronizarse con un efecto.
- `action` es exacta, o prefijo si termina en `*`. Los presets (`access.*`, `gateway_user.*`,
  `auth.*`, `capability_grant.*`, `access_request.*`, `api_token.*`) aplican al toque.
- `admin_id`, `api_token_id`, `target_type`, `target_id` y `server_id` no tienen control en la
  barra, pero se respetan si llegan por URL (y se conservan al aplicar los demás).

## Fechas: UTC sin zona ↔ hora local

El backend guarda y devuelve UTC **sin zona** (`2026-10-02T17:04:11`). `new Date()` de eso lo lee
como hora local, así que todo se muestra con `formatUtcDateTime` (`lib/utils/format.ts`), que le
agrega la `Z`. Al revés, «Desde»/«Hasta» se eligen en hora local (`datetime-local`) y viajan en
UTC con `Z` (`localInputToUtc`): mandar la hora local tal cual correría el rango la diferencia
horaria. `from` es inclusive y `to` **exclusive**; `from >= to` se avisa en la barra y no se pide
(el `422 audit.invalid_range` del servidor igual tiene copy propio).

## Cómo se nombra cada fila

| Campo   | Regla                                                                                                                                                                                                                                  |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actor   | `admin` → username (o `Usuario #id`); `api_token` → **`Token #<PK>`**, nunca el bearer; `system` → «Sistema»; `anonymous` → «Anónimo». Un `actor_type` nuevo cae al username o al valor crudo.                                         |
| Estado  | Vocabulario **abierto**: `success`, `failure`, `error`, `denied`, `attempt` tienen etiqueta y color; cualquier otro se muestra crudo en gris, nunca se descarta. Por eso `actor_type` y `status` son `string` en el Zod y no `z.enum`. |
| Destino | `target_type #target_id` con el tipo traducido cuando se conoce.                                                                                                                                                                       |
| 🔌      | La fila tocó el motor (`touched_engine`).                                                                                                                                                                                              |

## Detalle

`?entrada=<id>` abre `AuditEntryDetailModal` (`GET /audit-log/{id}`), así que una entrada también
se enlaza directo; con la fila en la página cargada se pinta sin esperar. `detail_json` se declara
`unknown().nullable()` y se muestra **tal cual**, con sangría y en monoespaciada dentro de un
`<details>` plegable: su forma depende de la acción y la UI no la interpreta. Si es `null`, va
`detail` como texto. Los campos de DCL (`grantee`…`grantor`) solo aparecen cuando vienen llenos.
«Ver todo el request» filtra la tabla por el `request_id` de la entrada. `404 audit.not_found`
dice que la entrada no existe, sin «Reintentar».

## Relacionado: cerrar las sesiones de otra persona

La otra mitad de v29 §11 es de `access_admin` y vive en la página de accesos: ver la sección
«Sesiones activas» en [`security.md`](security.md) §1 y [`ui-components.md`](ui-components.md).
