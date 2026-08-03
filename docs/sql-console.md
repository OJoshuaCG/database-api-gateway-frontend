# Consola SQL

Pantalla `/sql-console`. Implementa el módulo descrito en `api-reference-v6.md` del backend:
ejecutar SQL ad-hoc contra cualquier base de cualquier servidor del inventario, **eligiendo
con qué usuario del motor se conecta**.

## Por qué existe (y por qué la identidad va en el request)

El gateway ya sabe *otorgar* permisos. Lo que no había era forma de **comprobar** que un
permiso quedó como se esperaba sin salir de la aplicación, abrir un cliente SQL propio y
conseguir la contraseña del usuario por fuera.

La pieza que diferencia esto de "una consola SQL más" es que **con qué usuario se ejecuta es
parte del request**. Sin eso, todo correría con la credencial pseudo-root del gateway y daría
verde siempre — que es exactamente el error que el módulo existe para evitar. De ahí dos
decisiones de la pantalla:

- El selector de identidad **arranca vacío**. El schema del backend usa `admin` por defecto,
  pero la UI no: obliga a elegir.
- El modo `admin` lleva **banner rojo permanente** mientras esté seleccionado.

## Dónde vive cada cosa

```
src/lib/contracts/sql-console.ts      contratos Zod + QUERY_LIMITS + SYSTEM_DATABASES
src/features/sql-console/
  api/sql-console.api.ts              preview · execute · history
  logic.ts                            TODO el mapeo contrato → decisiones de UI (puro)
  messages.ts                         clasificación de errores + enlaces por motivo
  hooks/use-sql-console.ts            orquestador: ciclo de vida del confirm_token
  hooks/use-sql-console-mutations.ts  preview y execute como MUTACIONES
  hooks/use-query-history.ts          bitácora paginada
  components/                         identidad · clasificación · confirmación · resultados · historial
  pages/SqlConsolePage.tsx            servidor + pestañas (?server=&tab=)
```

`logic.ts` y `messages.ts` concentran a propósito todo lo que depende de la forma del
contrato: §2.8 del contrato v6 avisa de que el backend **todavía no se validó contra motores
reales** y de que puede haber ajustes menores. Un cambio del contrato debe tocar esos dos
archivos y `lib/contracts/sql-console.ts`, nunca diez componentes.

## El flujo, en una pasada

```
editor → [Analizar y ejecutar] → POST query/preview
   danger=read     → execute directo                        → Resultados
   danger=write|ddl→ ConfirmExecutionDialog (tipeo + token)  → execute → Resultados
   blocked=true    → BlockedNotice, sin salida de ejecución
```

**Un solo botón principal.** Clasifica y actúa en el mismo gesto: una lectura —el caso más
frecuente— es un clic, sin dejar de pasar nunca por el preview. Como el diálogo de
confirmación se abre con un token recién emitido, el 410 por caducidad pasa a ser raro en vez
de habitual. Hay un botón secundario "Solo analizar" para quien quiera la clasificación sin
ejecutar. **El preview nunca se dispara por pulsación**: el rate limit es de 30/min y el
preview abre conexión al motor para los `SELECT COUNT(*)` de estimación.

El contrato permite ejecutar un `SELECT` puro sin preview, y saltárselo ahorraría un request
de los 30/min. **No se hace, a propósito**: sin clasificar antes no hay forma de saber que el
lote es una lectura, y en un despliegue con `QUERY_SAFE_MODE` apagado el backend
*ejecutaría* un `UPDATE` sin exigir token — la UI se habría saltado su propia confirmación
sobre una escritura real. Un request de más es barato; ejecutar una escritura sin confirmar,
no.

## Las cinco trampas del contrato, y cómo se resuelven acá

### 1. `blocked` manda sobre `requires_confirmation`

Un lote prohibido vuelve con **los dos en `true`** y `confirm_token: null`. Mirar
`requires_confirmation` primero abriría un diálogo con token nulo, que termina en un 403
*después* de hacerle tipear el nombre de la base al usuario. `decidePath` (en `logic.ts`) fija
el orden correcto y es lo único que la UI consulta.

### 2. El `confirm_token` se invalida por huella, no por efectos

El backend ata el token a `(hash del SQL, modo, usuario, host, rol)`. `requestFingerprint`
calcula esa misma huella y `useSqlConsole` la compara **en cada render**: si no coincide con
la del preview guardado, `preview` vale `null` y no hay token que mandar. Nadie tiene que
acordarse de limpiar nada al editar el SQL o cambiar de usuario, y no hace falta ningún
`setState` dentro de un `useEffect` (que este repo trata como error).

El SQL se compara **recortado en los extremos**, que es lo único que normaliza el backend
antes de hashear. La contraseña queda fuera de la huella a propósito: el backend no la incluye
en la ligadura, y hacer que corregirla obligue a re-clasificar sería ruido puro.

### 3. Caducidad del token: recuperación transparente, pero no ciega

Ante un 410 (o el 422 de "el token no corresponde"), `runExecute` re-clasifica y reintenta
**una sola vez**, sin mostrar un error. Con una excepción deliberada: si la estimación de
impacto cambió entre los dos previews, **no** se re-ejecuta en silencio — el admin confirmó
"2 481 902 filas", no un cheque en blanco. En ese caso se reabre la confirmación con la cifra
nueva y un aviso.

### 4. Un rechazo del motor no es un error

Llega como **HTTP 200 con `success: false`** (o con `connection_error`), y desde la
perspectiva del admin la prueba salió *bien*: confirmó que el permiso no está. Se muestra en
tono neutro, con el error nativo del motor en monoespaciado y sin traducir — ese texto es el
resultado.

El rojo queda reservado para tres cosas:

| Señal | Por qué es lo más grave de la pantalla |
|---|---|
| `ddl_persisted: true` | Pese a `rolled_back: true`, quedaron cambios de **esquema** aplicados (commit implícito del DDL en MySQL/MariaDB). Sin destacarlo, la UI diría "se revirtió todo" y sería mentira. |
| `policy_miss: true` | El gateway clasificó como lectura algo que escribe. Es un **bug del gateway**, no del usuario, y la señal de telemetría más valiosa del módulo. |
| 5xx / 502 / 504 | Fallo real de infraestructura. Es el único caso con `request_id` visible y botón de reintentar. |

### 5. La escritura sobre bases de sistema solo la detecta el `execute`

Un preview sobre `mysql` con un `UPDATE` devuelve `danger: "write"` y un token válido, y aun
así el execute responde 403 (`system_database_write`). `blocksSystemDatabaseWrite` corta antes
en el cliente para no llevar al usuario a tipear el nombre de la base y chocarse con un muro.
Leer esas bases sigue permitido.

## Detalles de la interfaz que no son cosméticos

- **`estimated_rows: null` nunca se muestra como "0 filas".** Significa "no hay cifra exacta
  que mostrar" (el `WHERE` cruza tablas, o el usuario elegido no puede leerlas), no "no afecta
  nada". El copy es *"No se pudo estimar cuántas filas afectará"*.
- **El campo de confirmación no se pre-rellena ni se recuerda.** Hoy no hay segundo factor
  real: tipear el nombre de la base es *la* protección, no un trámite. Tampoco hay botón de
  "copiar el nombre": copiar y pegar la anularía.
- **`truncated: true` siempre visible.** Un resultado recortado en silencio lleva a
  conclusiones falsas.
- **Lo que no se pudo clasificar cae en `ddl`, no en `read`** (política *fail-closed*). Los
  motivos `opaque_statement`, `unparseable` y `unmapped_statement` son los que más se ven con
  SQL legítimo —un `CALL` a un procedimiento—, así que llevan un texto propio que dice "no se
  pudo determinar qué hace", no "esto destruye datos".
- **`blocked` no se reintenta nunca.** Cada motivo que menciona un módulo dedicado del gateway
  (`dcl_grant_revoke`, `dcl_user_role`, `database_lifecycle`, `copy_statement`) lleva un enlace
  a la pantalla que sí hace esa operación: es lo que convierte un bloqueo frustrante en una
  redirección útil (`reasonLink` en `messages.ts`).
- **`impersonate` se oculta fuera de PostgreSQL.** Es una limitación del motor, no del gateway.
- **La contraseña del modo `provided` no se guarda en ningún lado**: ni en el gateway, ni en el
  historial, ni en el navegador. Al cargar una consulta del historial en modo `provided`, la
  pantalla avisa de que hay que volver a escribirla.
- **Cambiar de servidor remonta la consola** (`key={server.id}`), lo que descarta SQL,
  identidad y token de una vez sin efectos de limpieza.

## Historial

Guarda **metadatos, nunca filas**: el gateway no es custodio de los datos del usuario final.
No se puede construir "ver el resultado de la ejecución del martes", así que la pantalla es
bitácora + atajo de re-ejecución, con un aviso permanente que lo dice. La columna más valiosa
es *"Ejecutado como"*: responde "¿con qué usuario probamos esto?".

Su estado `error` va en tono **neutro**, no rojo: ahí caen los rechazos por permisos. El
estado `blocked` significa que la política lo rechazó y **nunca se tocó el motor**.

> ⚠️ **Discrepancia conocida del contrato.** §7 documenta la paginación del historial con la
> clave `meta` (`meta.total`, `meta.page`, `meta.size`), mientras el resto de la API del
> gateway usa `pagination` con seis campos. `listQueryHistory` acepta **las dos formas** y
> deriva lo que falte. Es la única concesión defensiva del módulo, y está ahí porque fallar
> por un nombre de clave dejaría la pantalla inservible.

## Piezas compartidas que salieron de este módulo

- `lib/utils/countdown.ts` + `lib/utils/use-countdown.ts` — la cuenta atrás de vigencia del
  `confirm_token`, que antes vivía dentro de `server-databases`. Ahora la usan los dos.
- `lib/utils/format.ts` — `engineLabel` (movido desde `server-databases`), más `formatInteger`
  y `formatDuration`.
- `ApiError.reasons` y `ApiError.blockedStatements` — extracción del `public_context` del 403
  de política.
- `requestJson` en `lib/api/client.ts` — escape hatch para envelopes que no encajan en
  `fetchData`/`fetchPage`/`fetchList`. Hoy lo usa solo el historial, por la discrepancia de
  arriba.
- Iconos nuevos en `components/ui/icons.tsx`: `PlayIcon`, `HistoryIcon`, `AlertIcon`,
  `BanIcon`, `DownloadIcon`.
