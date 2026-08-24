---
name: clickup-task-flow-frontend
description: En este repositorio (database-api-gateway-frontend) es el protocolo obligatorio de gestión de tareas — validar, reclamar, comentar y cerrar tareas en ClickUp vía MCP, tomar los handoff que el backend dejó en `update required`, abrir trabajo propio del frontend, y mantener TODO.md sincronizado. Usar SIEMPRE antes de empezar cualquier tarea, implementación, fix, verificación o refactor en este repo, y otra vez al terminarla. También al preguntar qué handoff hay pendientes o en qué estado está algo.
---

# Gestión de tareas del frontend: ClickUp + TODO.md

Este protocolo existe para que **dos personas no trabajen lo mismo en paralelo**. Esta SPA es la
**única interfaz** de un gateway que administra servidores de BD con credenciales pseudo-root, y
muchas de sus acciones son irreversibles sobre un motor real. Dos implementaciones distintas de
la misma confirmación destructiva no es desprolijidad: es que un botón borre una base que el otro
botón creía que solo iba a comparar.

## Este repo es el CONSUMIDOR del handoff

El backend y el frontend comparten **la misma lista y la misma tarea paraguas**. Tienen que
compartirla: el ciclo `update required → in progress (fe) → complete (fe)` ocurre sobre **la misma
subtarea**. Si el frontend tuviera tablero propio, `update required` no reservaría nada.

Consecuencia directa: **la entrada natural del trabajo acá es el estado `update required`, no
`to do`.** Los ítems en `to do` son backlog del backend y no se tocan desde este repo.

## Coordenadas

| Campo | Valor |
| --- | --- |
| Tarea principal (paraguas) | `86e2xzf9d` |
| URL | https://app.clickup.com/t/86e2xzf9d |
| Espacio | Cero208 (`90172691192`) |
| Carpeta | Desarrollo (`901710687203`) |
| Lista | Database Gateway (`901716272178`) |
| Workspace | `9017559023` |

## Los estados y su significado EXACTO

La lista trae 6 estados. Este flujo usa 5, y cada uno tiene **un solo** significado.

| Estado | Significa | Quién lo pone |
| --- | --- | --- |
| `to do` | Libre. Backlog del backend, **o** trabajo propio del frontend recién abierto | — |
| `in progress` | Alguien la está haciendo. **Es lo que reserva la tarea.** Vale para backend Y para frontend: el **rol va declarado en el comentario `INICIO`** | Quien la toma |
| `on hold` | Detenida: trabada por algo externo, **o quedó a medias** | Quien la deja |
| `update required` | **Backend terminado. PENDIENTE DE FRONTEND.** Nada más | El backend |
| `complete` | Cerrada del todo. No queda nada pendiente en ningún lado | Quien la termina — en el ciclo con handoff, **el frontend** |
| `reviewed` | **NO SE USA en este flujo.** | Nadie |

**`update required` no es un buzón de ida y vuelta.** Significa "falta el frontend" y nada más.
Cuando terminás, la tarea va a `complete`: sos el final de la cadena, no la devolvés.

**Si el backend no entrega lo que el handoff prometía**, tampoco la devolvés a `update required`
—eso la haría aparecer en tu propio filtro y el mecanismo se muerde la cola—. Va a **`on hold`**
con un comentario `BLOQUEADO POR BACKEND` (ver más abajo). `on hold` ya significa exactamente eso:
trabada por algo externo.

**`reviewed` no se usa a propósito.** Está documentado acá para que nadie le invente un
significado: si aparece una tarea en `reviewed`, es un error o quedó de antes, y hay que
preguntar antes de asumir qué quiso decir.

## Reparto de autoridad — quién manda sobre qué

| Fuente | Manda sobre | No manda sobre |
| --- | --- | --- |
| **ClickUp** | El **estado** y **quién** trabaja. Es el árbitro de colisiones | El detalle técnico |
| **`TODO.md`** (raíz) | El **detalle completo** | El estado — puede quedar viejo si alguien no lo actualiza |

Ante discrepancia: para el estado gana **ClickUp**; para el detalle gana **`TODO.md`**.

En ClickUp va un **resumen simple**. El detalle largo va a `TODO.md`. Duplicarlo en ambos lados
garantiza que se desincronicen.

## Identidad del ejecutor: SOLO el email

```bash
git config user.email
```

**La identidad es el email, y nada más.** No se usa `user.name`.

**Por qué:** el historial de este repo tiene varios nombres distintos (`ojoshuacg`, `Joshua CG`,
`Joshua`, `Joshua Carrasco`) para **un mismo email**. Si la identidad incluyera el nombre, la misma
persona trabajando desde dos máquinas se vería como dos personas y el protocolo la interrumpiría
contra sí misma. El email es lo único estable.

**Va escrito DENTRO del texto del comentario.** Todos los comentarios se publican con la cuenta
del token de la integración MCP (hoy `Orlando Carrasco`), sin importar quién ejecute. El campo
"autor" de ClickUp es por lo tanto **inútil para detectar colisiones**.

### Las iniciales del ID salen del email

```bash
git config user.email | cut -d@ -f1 | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9' | cut -c1-8
```

```
ojoshuacg@gmail.com   → ojoshuac
LeoZubiri@outlook.com → leozubir
ocarrasco@inbtel.com  → ocarrasc
```

## Los dos orígenes del trabajo en este repo

### A) Handoff del backend — el caso normal

La tarea **ya existe** en `update required`, con su comentario `HANDOFF FRONTEND`. No se crea
nada: se reclama pasándola a `in progress` con un `INICIO` de rol **frontend**.

El nombre ya está puesto por el backend (`P-XX — …` o `T-<YYMMDD>-<iniciales>-<slug>`). **No lo
renombres.** Ese nombre es la clave de identidad de los dos lados.

### B) Trabajo nacido en el frontend

Un fix visual, un refactor de componente, deuda de UI, una regresión de accesibilidad: cosas que
no vienen de ningún handoff. Sí se crean acá, como subtarea de la paraguas, y arrancan en `to do`:

```
T-<YYMMDD>-<iniciales>-<slug>

T-260824-ojoshuac-scroll-horizontal-appshell
T-260824-ojoshuac-fix-contraste-toasts
```

`YYMMDD` = hoy · `iniciales` = parte local del email (arriba) · `slug` = 2 a 4 palabras en
kebab-case.

**NUNCA uses "el siguiente `P-XX` libre" para algo nuevo.** Ese esquema es secuencial y
**colisiona**: dos personas que arrancan a la vez calculan el mismo, y el prefijo —que existe
justamente para evitar duplicados— pasa a apuntar a dos trabajos distintos. `P-XX` se usa **solo**
para ítems que ya tienen ese ID asignado en el `TODO.md` del backend.

## REGLA DURA: el frontend NO crea sub-subtareas

La jerarquía es de **dos niveles**: tarea paraguas `86e2xzf9d` → subtareas.

El tercer nivel existe para **un solo escenario**, y **no es tuyo**: el backend necesita cambiar
algo de una tarea que vos estás haciendo en este momento. En ese caso **el backend** abre una
sub-subtarea colgada de tu tarea, y te deja un comentario `TRABAJO DERIVADO` en la madre.

**Qué hacés vos cuando eso pasa:** leés el campo `Impacto en lo que estás haciendo`. Si dice
`NINGUNO`, seguís tranquilo. Si te afecta, decidís con el usuario. **Tu tarea madre sigue su
curso y la cerrás vos cuando terminás lo tuyo, sin esperar a la sub-subtarea** — esa tiene su
ciclo propio.

Si te parece que un caso justifica que **vos** abras un tercer nivel: **no lo crees. Planteáselo
al usuario** y que se establezca como regla nueva. Una excepción sin discutir se convierte en la
norma en dos semanas.

## Paso 1 — Validar antes de empezar (sin excepciones)

**1.1** Si ya tenés el ID (de `TODO.md` o del listado de handoff) → `clickup_get_task`. Camino
corto y exacto.

**1.2** Si no, buscá en ClickUp **antes de crear nada**:

```
clickup_filter_tasks
  list_ids:        ["901716272178"]
  include_closed:  true          ← OBLIGATORIO
  subtasks:        true
                                 ← SIN date_closed_from: ver abajo
```

**`include_closed: true` no es opcional.** Viene **apagado por defecto**, así que sin él una
tarea ya `complete` **no aparece** y se crea un duplicado exacto. Si la respuesta trae
`has_more: true`, paginá con `next_page` hasta que sea `false`.

**Y esta búsqueda NO lleva `date_closed_from`.** Verificado contra la API: ese filtro devuelve
**solo tareas cerradas**, así que acá haría desaparecer todo lo que está en `update required`,
`in progress`, `to do` y `on hold` — justo el trabajo que te toca. El recorte a 30 días es una
regla de **decisión** sobre lo que encontrás, no un filtro de la consulta (ver "La ventana de 30
días").

**1.3** Compará por el **prefijo del ID**, no por el título.

### Qué hacer según el estado que encuentres

| Estado | Acción |
| --- | --- |
| `update required` | **Es lo tuyo.** Antes de tocar código, leé los comentarios (abajo: "Antes de implementar un handoff"). Después reclamala (paso 2) |
| `in progress` | Leé el último `INICIO` con `clickup_get_task_comments` para saber **quién**, **desde cuándo** y con qué **rol**. Si el rol es **frontend** y venís a hacer lo mismo → **INTERRUMPIR**, informá quién la tiene. Si el rol es **backend**, el backend está re-tocando algo: **no la toques**, y avisá al usuario que va a volver a `update required` |
| `to do` | Si es **trabajo propio del frontend** que abriste vos o alguien de frontend, se puede tomar. Si es **backlog del backend**, **no es tuyo**: avisá y no la toques |
| `on hold` | **Leé primero el último comentario**: dice por qué se detuvo y dónde quedó. Si es un `BLOQUEADO POR BACKEND`, el backend **todavía no lo resolvió** — cuando lo resuelve la devuelve a `update required` con un `FIN BACKEND (DESBLOQUEO)`. Retomarla ahora es volver a chocar contra lo mismo |
| `complete` | **No es un portazo:** informá que ya se hizo, con el resumen del comentario `FIN`. Después mirá su **`date_closed`**: si se cerró hace **más de 30 días**, no se reabre — va tarea nueva vinculada. Si es más reciente, aplicá la prueba de "¿tarea nueva o la misma?" (abajo) |
| `reviewed` | Estado **no usado** en este flujo. Preguntá antes de asumir |
| No existe | Solo para **trabajo nacido en el frontend**: creála (abajo) |

### Antes de implementar un handoff: verificá que siga vigente

**Leé `clickup_get_task_comments` y mirá el ÚLTIMO comentario, no el primero.** Cuatro casos:

- Último = `HANDOFF FRONTEND` o `FIN BACKEND (RE-ENTREGA)` → vigente, adelante.
- Último = **`FIN BACKEND (DESBLOQUEO)`** → vigente, y es **la respuesta a un bloqueo que pusiste
  vos**. Antes de retomar, leé el campo **`Sigue sin resolverse`**: si no dice "nada", parte de lo
  que pediste **no** se arregló, y conviene saberlo antes de volver a chocar contra eso.
- Último = **`HANDOFF INVALIDADO`** → **PARÁ. No implementes.** El backend está cambiando el
  contrato ahora mismo. Informá al usuario y esperá la re-entrega.
- **No hay comentario de handoff** y la tarea está en `update required` → es un cierre mal hecho.
  **Pedile el contexto a quien la dejó ahí; no lo adivines** leyendo el código del backend.

Si es una **RE-ENTREGA** o un **DESBLOQUEO**, el campo `Lo que NO cambió` te dice qué trabajo tuyo
sigue sirviendo. Leelo antes de rehacer nada — en un desbloqueo es casi seguro que ya tenías media
implementación hecha y sigue siendo válida.

### Crear la subtarea (solo trabajo propio del frontend)

```
clickup_create_task
  name:     "T-<YYMMDD>-<iniciales>-<slug>"
  list_id:  "901716272178"
  parent:   "86e2xzf9d"              ← siempre subtarea, nunca tarea suelta
```

Después de crearla, **en este orden**:

1. **Re-verificá** que no haya duplicado (abajo).
2. Si deriva de otra tarea, **vinculala** con `clickup_add_task_link`.
3. Escribí el ID devuelto en la columna `Subtarea` de `TODO.md`, **como link Markdown**:
   `[86e2y1abc](https://app.clickup.com/t/86e2y1abc)`. Un ID pelado obliga a armar la URL a mano.

### La ventana de colisión no se puede cerrar — se detecta

El chequeo es *buscar, después crear*. No hay lock ni "crear si no existe" atómico en ClickUp:

```
A: busca → no existe
B: busca → no existe        ← ambos pasaron
A: crea la subtarea
B: crea la subtarea         ← duplicado
```

**Inmediatamente después de `clickup_create_task`, y antes de empezar a trabajar:**

1. Volvé a buscar con `clickup_filter_tasks` (`include_closed: true`).
2. Contá cuántas subtareas hay con tu mismo ID, o con un **slug equivalente** creado en los
   últimos minutos.
3. Si hay **más de una**, resolución **determinística** para que los dos lados concluyan lo mismo
   sin hablarse:
   - Gana la de **`date_created` más antiguo**.
   - Si empatan al segundo, gana el **`id` de tarea menor** en orden lexicográfico.
4. **Si ganaste:** seguí normalmente.
5. **Si perdiste: PARÁ.** No trabajes. Informá quién reclamó lo mismo y los IDs de las dos. **No
   borres la duplicada por tu cuenta** — proponelo y que decida el usuario.

Sin este paso el duplicado es **invisible** hasta el merge.

## ¿Tarea nueva, o va sobre una que ya existe?

**No se decide por tamaño** — nadie estima igual. Se decide con una prueba verificable:

> **¿El trabajo nuevo se puede describir sin cambiar el objetivo declarado de la tarea original?**

**Sí → va sobre la misma tarea. No → tarea nueva, vinculada a la original.**

| Situación | Qué se hace |
| --- | --- |
| **Fix** de algo que la tarea entregó mal, y la tarea sigue abierta | **Misma tarea.** Comentario explicando el fix. Sin ID nuevo |
| **Fix** de algo que ya está `complete` **hace 30 días o menos** | **Misma tarea: se REABRE** a `in progress` con un comentario `REAPERTURA`. Cerrarla de nuevo al terminar |
| **Fix** de algo `complete` de **hace más de 30 días** | **NO se reabre nunca. Tarea nueva `T-…`, vinculada** (ver "La ventana de 30 días") |
| **Feature** que extiende la tarea sin cambiar su objetivo | **Misma tarea.** Se actualiza la descripción + comentario |
| **Feature** que cambia el objetivo, o toca pantallas que la original no tocaba | **Tarea nueva, vinculada** |
| Rehacer desde cero algo ya `complete` | **Tarea nueva, vinculada.** No es un fix: es trabajo distinto sobre el mismo terreno |

### La ventana de 30 días: qué se reabre y qué no

La prueba del objetivo declarado decide **si es la misma historia**. La antigüedad decide **si vale
resucitar el hilo**. Son dos preguntas distintas y hay que hacer las dos.

**Si la coincidencia está `complete`, mirá su `date_closed`:**

- **Cerrada hace ≤ 30 días** → prueba del objetivo declarado, como siempre. Si es un fix, se
  **reabre**.
- **Cerrada hace > 30 días** → **no se reabre, aunque sea un fix de eso mismo.** Va **tarea nueva
  `T-<YYMMDD>-<iniciales>-<slug>`**, vinculada con `clickup_add_task_link`.

**Por qué el corte:** una tarea de hace meses arrastra un hilo de comentarios que ya no describe
el estado del código. Reabrirla mete dos trabajos separados por meses en la misma tarea, y el
`FIN` original —que alguien va a leer como el resumen de lo entregado— pasa a describir algo que
ya no es. La vinculación conserva la historia sin resucitar el hilo: se ve de dónde viene, y cada
trabajo tiene su propio cierre.

La fecha de corte sale de bash, no la calcules a ojo:

```bash
date -d '30 days ago' +%Y-%m-%d
```

**⚠️ La ventana NO se aplica a la búsqueda, solo a la decisión.** La búsqueda de validación sigue
yendo con `include_closed: true` **y sin filtro de fecha**, por dos motivos:

1. **`date_closed_from` devuelve SOLO tareas cerradas** — verificado contra la API. Usarlo en la
   búsqueda principal haría desaparecer todo lo que está en `update required`, `in progress`,
   `to do` y `on hold`; o sea, justo el trabajo que te toca.
2. **El ID tiene que seguir siendo único contra TODO el historial.** Si existe una `P-07` cerrada
   hace un año, no podés crear otra `P-07` — el prefijo dejaría de identificar un solo trabajo.
   Por eso el trabajo derivado de algo viejo usa un ID **nuevo** (`T-…`) y se vincula, en vez de
   reciclar el ID original.

Cuando corresponde tarea nueva, la relación se registra **en los dos lados**:

```
clickup_add_task_link
  task_id:  "<la nueva>"
  links_to: "<la original>"
```

Y en `TODO.md`, el ítem derivado anota de dónde sale. Sin la vinculación, en tres meses nadie
sabe que esas dos tareas eran la misma historia.

**Ante la duda, preguntá al usuario antes de crear nada.** Una tarea de más es ruido; una tarea
partida en dos cuando era una sola pierde la historia.

## Paso 2 — Al empezar

```
clickup_update_task
  task_id: "<subtarea>"
  status:  "in progress"
```

**Esto es lo que reserva la tarea.** Va **antes** de escribir la primera línea de código.

Después: `clickup_create_comment` con el bloque `INICIO` (rol **frontend**, obligatorio), y mové
el ítem a **🟡 En curso** en `TODO.md`.

## Paso 3 — Al terminar: `complete`

El frontend es el **final de la cadena**. No hay bifurcación de handoff hacia adelante.

```
clickup_update_task  →  status: "complete"
clickup_create_comment  →  bloque FIN
```

Mové el ítem a **🟢 Realizadas** en `TODO.md`, con el detalle completo: archivos tocados,
decisiones, y muy especialmente **qué quedó sin verificar**.

Es normal que algo quede sin verificar — en este repo los tests **no se ejecutan por rutina** (ver
"Tests: escribirlos sí, ejecutarlos no" en `CLAUDE.md`). Lo que **no** es aceptable es que no esté
dicho. Si escribiste tests y no los corriste, el comentario lo dice así, con todas las letras.

**Nunca pongas `reviewed`** y **nunca devuelvas a `update required`**.

## Paso 4 — Si se abandona a mitad, o si el backend no cumple

Nunca se deja en `in progress`. Una tarea colgada ahí bloquea a todos los demás por nada.

### 4a. Quedó a medias por tu lado → `on hold` + comentario que diga **dónde quedó**

### 4b. El backend no entrega lo que el handoff prometía → `on hold` + `BLOQUEADO POR BACKEND`

Es el caso más frecuente y el que peor se maneja si se improvisa: el endpoint devuelve otra forma,
falta un campo, el código de error no es el documentado, o directamente no existe la ruta.

```
clickup_create_comment
  entity_id:    "<subtarea>"
  notify_all:   true          ← que se entere quien hizo el backend
  comment_text: <bloque BLOQUEADO POR BACKEND>
```

**No la devuelvas a `update required`.** Ese estado significa "falta el frontend": devolverla ahí
la deja en tu propio filtro de pendientes y nadie del backend se entera de que está trabada.

## Formato de los comentarios

```
**Ejecutor:** <email>          ← la identidad es el EMAIL, no el nombre
**Rol:** frontend                  ← OBLIGATORIO: `in progress` no dice quién es
**Acción:** INICIO — <nombre de la tarea>
**Resumen:** <una o dos líneas de qué se va a hacer>
**Handoff que implemento:** <fecha del comentario HANDOFF FRONTEND, o "trabajo propio del frontend">
```

```
**Ejecutor:** <email>
**Rol:** frontend
**Acción:** FIN — <nombre de la tarea>
**Resumen:** <qué se hizo, en simple>
**Pantallas / componentes tocados:** <rutas concretas>
**Endpoints consumidos:** <los del handoff que quedaron efectivamente integrados>
**Sin verificar:** <lo que quedó sin probar, o "nada". Si hay tests escritos y no ejecutados, decilo acá>
```

```
**Ejecutor:** <email>
**Rol:** frontend
**Acción:** BLOQUEADO POR BACKEND — <nombre de la tarea>
**Qué esperaba (según el handoff):** <lo prometido>
**Qué encontré:** <respuesta real, código de estado, forma del payload>
**Cómo lo reproduzco:** <request concreto — SIN credenciales ni datos reales>
**Qué necesito del backend:** <concreto, no "arreglarlo">
**Dónde quedé:** <qué parte del frontend ya está hecha y sirve igual>
```

```
**Ejecutor:** <email>
**Rol:** frontend
**Acción:** REAPERTURA — <nombre de la tarea>
**Motivo:** <qué se rompió o qué faltó>
**Alcance:** <qué se va a corregir, sin cambiar el objetivo de la tarea>
```

## Los ciclos completos, escritos de punta a punta

`(be)` = lo hace el backend, `(fe)` = lo hace el frontend. **Lo que hacés vos está en `(fe)`.**

**1. Handoff normal — el caso de todos los días**

```
update required → in progress (fe) → complete (fe)
  (ya llegó así)   (vos la reclamás)   (vos la cerrás)
```

**2. Trabajo nacido en el frontend**

```
to do → in progress (fe) → complete (fe)
 (la creás vos)
```

**3. El backend no cumple el handoff — y el camino de vuelta**

```
update required → in progress (fe) → on hold → in progress (be) → update required → in progress (fe) → complete (fe)
                   (empezás y chocás) (BLOQUEADO  (el be desbloquea)  (FIN BACKEND
                                       POR BACKEND)                    (DESBLOQUEO))
```

**El desbloqueo te la devuelve a `update required`, no a `on hold`.** O sea: una tarea que sigue
en `on hold` con tu `BLOQUEADO POR BACKEND` como último comentario es una que el backend **todavía
no resolvió**. No la retomes esperando que ande.

**4. Fix de algo que vos ya cerraste**

```
complete → in progress (fe) → complete (fe)
            (REAPERTURA)
```

**5. Re-entrega: el backend invalidó el handoff antes de que empezaras**

```
update required → in progress (be) → update required → in progress (fe) → complete (fe)
  (no empieces)    (HANDOFF INVALIDADO)  (RE-ENTREGA con delta)
```

**6. El backend necesita cambiar algo mientras vos trabajás** — no toca tu tarea, abre una
sub-subtarea colgada de la tuya:

```
tu subtarea:   in progress (fe) ───────────────────────────→ complete (fe)
                      │ (sigue su curso: la cerrás vos)
                      └── sub-subtarea del backend: to do → in progress (be) → update required → …
```

## Resumen: qué cambia y en qué momento

Todos los cambios de estado ocurren en **ClickUp vía MCP**. Ningún estado vive solo en el repo.

| Momento | ClickUp | `TODO.md` |
| --- | --- | --- |
| Llega un handoff | — (lo puso el backend) | Ítem → 🔵 Pendiente de frontend, con el resumen |
| **Frontend reclama** | `in progress` + `INICIO` (**rol frontend**) | Ítem → 🟡 En curso |
| Frontend termina | `complete` + `FIN` | Ítem → 🟢 Realizadas |
| Trabajo propio nuevo | `create_task` (`parent: 86e2xzf9d`) en `to do` + re-verificación | Ítem nuevo en 🔴 Pendientes con su ID `T-…` |
| Se abandona a mitad | `on hold` + comentario con dónde quedó | Ítem vuelve a 🔴 Pendientes |
| El backend no cumple | `on hold` + `BLOQUEADO POR BACKEND` (`notify_all`) | Ítem → 🔴 Pendientes, marcado como bloqueado |
| Fix de algo que cerraste | `in progress` + `REAPERTURA` → después `complete` | 🟢 → 🟡 → 🟢 |
| Aparece `HANDOFF INVALIDADO` | No la toques | Ítem se queda en 🔵, anotado como invalidado |

## Qué NO va a ClickUp

Credenciales, contenido de `.env`, volcados de datos de clientes, ni fragmentos de sentencias con
datos reales. ClickUp es un sistema externo: lo que se escribe ahí sale del repo. Eso vale
también para los **adjuntos** y para el campo `Cómo lo reproduzco` de un bloqueo.

## Límites conocidos de la API vía MCP

Verificados, no asumidos:

- **No existe** herramienta para crear **espacios**. Solo carpetas, listas, tareas, documentos.
- **No se puede mover una lista** entre espacios o carpetas: `clickup_update_list` solo cambia
  `name` / `content` / `status`.
- **No existe** `delete_list` ni `delete_folder`.
- **Sí** se puede mover una tarea (`clickup_move_task`) y **el ID sobrevive** el movimiento.
- `clickup_add_tag_to_task` **falla si el tag no existe** en el espacio: hay que crearlo antes a
  mano desde la UI.
- Las herramientas de ClickUp son **deferred**: antes de invocarlas hay que traer su esquema con
  `ToolSearch(query: "select:clickup_filter_tasks,clickup_update_task,…")`.
- **Todos los comentarios se publican con la cuenta del token**, sin importar quién ejecute. Por
  eso la identidad va dentro del texto.
