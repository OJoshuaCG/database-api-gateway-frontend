---
description: Valida, reclama, bloquea o cierra una tarea del frontend en ClickUp siguiendo el protocolo anti-colisión
---

Argumento recibido: `$ARGUMENTS`

Cargá primero la skill `clickup-task-flow-frontend` (es la fuente del protocolo) y ejecutá el modo
que corresponda.

## Modos

| Argumento | Modo | Qué hacés |
| --- | --- | --- |
| `frontend` (o **vacío**) | **PENDIENTES DE FRONTEND** | Listar los handoff que esperan implementación. **Es la entrada natural de este repo** |
| `P-07` / `T-260824-ojoshuac-slug` | **RECLAMAR** | Validar y tomar la tarea |
| `fin P-07` | **CERRAR** | Cerrar a `complete` con comentario `FIN` |
| `fin P-07 <notas>` | **CERRAR** | Idem, con notas para el comentario |
| `bloqueo P-07 <motivo>` | **BLOQUEAR** | El backend no cumple el handoff: `on hold` + `BLOQUEADO POR BACKEND` |
| `nueva <descripción>` | **CREAR PROPIA** | Abrir trabajo nacido en el frontend (`T-…`, arranca en `to do`) |
| `estado` | **CONSULTAR** | Panorama completo del tablero |
| Texto sin ID | **RESOLVER** | Identificar a qué ítem se refiere antes de seguir |

---

## Modo PENDIENTES DE FRONTEND (el default)

```
clickup_filter_tasks
  list_ids: ["901716272178"]
  statuses: ["update required"]
  subtasks: true
```

Para cada una, leé los comentarios con `clickup_get_task_comments` y presentá:

- El ID y título de la tarea, con link
- Endpoints nuevos o cambiados
- Si hay **breaking changes** — **esas van primero**: rompen lo que ya está en producción
- La referencia al contrato **con su hash de commit**. El doc lo nombra el propio handoff y **no
  siempre es el mismo**: puede ser `backend/docs/api-reference.md` o el de la feature concreta
  (p. ej. `backend/docs/features/database-clone.md`). Implementá contra **esa** versión, no contra
  el `main` del backend — el hash está justamente para eso
- Qué tiene que hacer el frontend
- Si es una **RE-ENTREGA** o un **DESBLOQUEO**, el campo `Lo que NO cambió`: eso te dice qué
  trabajo previo sigue sirviendo
- Si es un **DESBLOQUEO** (`FIN BACKEND (DESBLOQUEO)`), el campo **`Sigue sin resolverse`**: es la
  respuesta a un bloqueo que pusiste vos, y si no dice "nada", parte de lo que pediste **no** se
  arregló. **Destacalo**: es exactamente donde vas a volver a chocar

**Marcá aparte tres anomalías, no las mezcles con las sanas:**

1. **Handoff invalidado**: tareas en `in progress` cuyo último comentario sea `HANDOFF INVALIDADO`.
   Desaparecen de este filtro porque volvieron a manos del backend, pero **te van a volver**.
   Reportalas como "vuelve al frontend, backend trabajando". **No las implementes.**
2. **`update required` sin comentario de handoff**: es un cierre mal hecho. Hay que pedirle el
   contexto a quien la dejó ahí, **no adivinarlo** leyendo el código del backend.
3. **`on hold` con `BLOQUEADO POR BACKEND`**: trabajo tuyo que quedó trabado y **el backend
   todavía no resolvió** — cuando lo resuelve la devuelve a `update required` con un
   `FIN BACKEND (DESBLOQUEO)`, así que sale de `on hold` sola. Reportá desde cuándo está parada:
   si lleva mucho, hay que empujarlo.

**Al tomar una de estas, pasala a `in progress`** con un `INICIO` de rol frontend. Eso es lo que
avisa que ya la estás haciendo y lo que le dice al backend que no la toque.

---

## Modo RECLAMAR

1. Resolvé la identidad del ejecutor: **`git config user.email`**. La identidad es el **email y
   nada más** — este repo tiene varios nombres para un mismo email, así que incluir el nombre
   haría que la misma persona se viera como dos.
2. Buscá el ID. Si el argumento no trae ID, identificá a qué ítem se refiere y **confirmalo con el
   usuario antes de seguir** — reclamar la tarea equivocada es peor que preguntar.
3. Si tenés el ID → `clickup_get_task`.
   Si no → `clickup_filter_tasks` con `list_ids: ["901716272178"]`, **`include_closed: true`**,
   `subtasks: true`, paginando con `next_page` mientras `has_more` sea `true`. Compará por
   prefijo del ID, no por título.
4. Según el estado:
   - **`update required`** → **es lo tuyo.** Antes de reclamar, leé los comentarios y mirá el
     **último**, no el primero:
     - `HANDOFF FRONTEND` o `FIN BACKEND (RE-ENTREGA)` → vigente, seguí al paso 5.
     - **`FIN BACKEND (DESBLOQUEO)`** → vigente, y es la respuesta a un bloqueo que pusiste vos.
       Antes de seguir, leé **`Sigue sin resolverse`**: si no dice "nada", parte de lo que pediste
       no se arregló y vas a volver a chocar ahí. Y leé **`Lo que NO cambió`**: tenías media
       implementación hecha y probablemente sigue siendo válida.
     - **`HANDOFF INVALIDADO`** → **PARÁ. No implementes.** El backend está cambiando el contrato
       ahora mismo. Informá al usuario y esperá la re-entrega.
     - **Sin comentario de handoff** → cierre mal hecho. Pedí el contexto, no lo adivines.
   - **`in progress`** → leé el último `INICIO` para saber **quién**, **desde cuándo** y con qué
     **rol**:
     - Rol **frontend** y venís a hacer lo mismo → **PARÁ.** Informá quién la tiene.
     - Rol **backend** → el backend está re-tocando algo. **No la toques**; avisá al usuario que
       va a volver a `update required`.
   - **`to do`** → ¿es trabajo propio del frontend, o backlog del backend?
     - Propio del frontend → seguí al paso 5.
     - **Backlog del backend** → **no es tuyo.** Avisá y no la toques. Este repo no consume `to do`.
   - **`on hold`** → leé el último comentario (dice dónde quedó).
     - Si es un **`BLOQUEADO POR BACKEND`**, el backend **todavía no lo resolvió**: cuando lo hace,
       la devuelve a `update required` con un `FIN BACKEND (DESBLOQUEO)` y sale de `on hold` sola.
       Retomarla ahora es volver a chocar contra lo mismo. **Avisá desde cuándo está parada** en
       vez de reclamarla.
     - Si quedó a medias por nuestro lado → paso 5.
   - **`complete`** → **no es un portazo.** Informá el resumen del comentario `FIN`. Después van
     **dos** preguntas, en este orden — la antigüedad primero, porque puede cerrar el caso sola:

     **a) ¿Hace cuánto se cerró?** Mirá `date_closed` contra
     `date -d '30 days ago' +%Y-%m-%d`.
     - **Más de 30 días** → **no se reabre, aunque sea un fix de eso mismo.** Tarea nueva
       `T-<YYMMDD>-<iniciales>-<slug>` + `clickup_add_task_link` a la vieja. Un hilo de hace meses
       ya no describe el estado del código, y reabrirlo mete dos trabajos distintos en la misma
       tarea. **No recicles el ID viejo**: si era `P-07`, la nueva NO se llama `P-07`.
     - **30 días o menos** → seguí a (b).

     **b) Prueba del objetivo declarado:**
     - Es un **fix** de lo que esa tarea entregó → **REABRÍ** la misma: `in progress` + comentario
       `REAPERTURA` con motivo y alcance. Sin ID nuevo.
     - Es trabajo **distinto** o rehacer desde cero → **tarea nueva vinculada** con
       `clickup_add_task_link`.
     - **No está claro** → preguntá al usuario. No crees nada por tu cuenta.
   - **`reviewed`** → estado no usado en este flujo. Preguntá antes de asumir.
   - **No existe** → si es trabajo nacido en el frontend, andá al modo CREAR PROPIA. Si esperabas
     un handoff y no está, **no la inventes**: preguntá.
5. Reclamala, **en este orden**:
   - `clickup_update_task` → `status: "in progress"` (esto es lo que la reserva)
   - `clickup_create_comment` con el bloque `INICIO`, el **email** del ejecutor y **`Rol: frontend`**
     — obligatorio: `in progress` no dice por sí solo quién es
   - Mové el ítem a **🟡 En curso** en `TODO.md`, con ejecutor y fecha
   - Escribí el claim local:
     ```bash
     echo "P-XX — <título> (subtarea <id>, reclamada por <email>)" > .claude/.tarea-actual
     ```
     Sin esto, el recordatorio de cada prompt sigue diciendo "ninguna tarea reclamada".
6. Recién ahora empezá a trabajar. Confirmale al usuario que quedó reservada, con el ID.

---

## Modo CREAR PROPIA

Solo para trabajo **nacido en el frontend**: fix visual, refactor de componente, deuda de UI,
regresión de accesibilidad. Nada que venga de un handoff.

```
clickup_create_task
  name:    "T-<YYMMDD>-<iniciales>-<slug>"
  list_id: "901716272178"
  parent:  "86e2xzf9d"
```

Las iniciales salen del email, nunca del nombre:

```bash
git config user.email | cut -d@ -f1 | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9' | cut -c1-8
```

**NUNCA uses el siguiente `P-XX` libre.** Es secuencial y dos personas simultáneas calculan el
mismo. `P-XX` es solo para ítems que ya tienen ese ID asignado en el backlog del backend.

Después de crearla, **RE-VERIFICÁ antes de trabajar** (concurrencia optimista):

1. Volvé a buscar con `clickup_filter_tasks` + **`include_closed: true`**.
2. Contá cuántas hay con tu mismo ID o un slug equivalente reciente.
3. Si hay más de una: gana la de **`date_created` más antiguo**; si empatan, el **`id` menor**.
   Regla determinística a propósito: los dos lados de la carrera tienen que concluir lo mismo sin
   hablarse.
4. **Si perdiste: PARÁ.** Informá quién reclamó lo mismo y los IDs de ambas. **No borres la
   duplicada por tu cuenta.**

Con la re-verificación OK: vinculá si deriva de otra tarea, escribí el ID **como link Markdown**
(`[86e2y1abc](https://app.clickup.com/t/86e2y1abc)`) en la columna `Subtarea` de `TODO.md`, y
agregá el ítem a 🔴 Pendientes. La tarea queda en `to do` hasta que la reclames.

---

## Modo CERRAR

1. Resolvé la identidad del ejecutor: **`git config user.email`** (solo el email).
2. Buscá la subtarea por su ID (en `TODO.md`, o con `clickup_filter_tasks` +
   **`include_closed: true`**).
3. Verificá que esté en `in progress`. Si está en otro estado, **decilo** en vez de forzar:
   cerrar algo que nadie reclamó suele significar que se saltó el paso de reclamar.
4. Cerrala:
   - `clickup_update_task` → `status: "complete"`
   - `clickup_create_comment` → bloque `FIN`, con **`Sin verificar:`** completo y honesto

   **El frontend es el final de la cadena.** No hay handoff hacia adelante: nunca devuelvas a
   `update required` y nunca pongas `reviewed`.

   **Sobre `Sin verificar:`** en este repo los tests **no se ejecutan por rutina** (ver "Tests:
   escribirlos sí, ejecutarlos no" en `CLAUDE.md`). Si escribiste tests y no los corriste, el
   comentario lo dice con todas las letras. **Nunca afirmes ni insinúes que pasaron.** Si corriste
   `pnpm typecheck`, `pnpm lint` o `pnpm build`, decilo también: eso sí se ejecuta normalmente y
   es información útil.
5. Mové el ítem a **🟢 Realizadas** en `TODO.md` con el detalle completo: pantallas y componentes
   tocados, decisiones, y qué quedó sin verificar.
6. **Borrá el claim local**, que es lo que apaga el recordatorio:
   ```bash
   rm -f .claude/.tarea-actual
   ```

Si el trabajo quedó a medias: **`on hold`** con un comentario que diga dónde quedó. **No uses
`update required` para eso**: ese estado significa "falta el frontend", y devolverla ahí la deja
en tu propio filtro de pendientes.

---

## Modo BLOQUEAR

Para cuando **el backend no entrega lo que el handoff prometía**: el endpoint devuelve otra forma,
falta un campo, el código de error no es el documentado, o la ruta no existe.

```
clickup_update_task    →  status: "on hold"
clickup_create_comment →  entity_id: "<subtarea>", notify_all: true
                          comment_text: bloque BLOQUEADO POR BACKEND
```

```
**Ejecutor:** <email>
**Rol:** frontend
**Acción:** BLOQUEADO POR BACKEND — <tarea>
**Qué esperaba (según el handoff):** <lo prometido, citando el comentario y su fecha>
**Qué encontré:** <respuesta real, código de estado, forma del payload>
**Cómo lo reproduzco:** <request concreto — SIN credenciales ni datos reales>
**Qué necesito del backend:** <concreto, no "arreglarlo">
**Dónde quedé:** <qué parte del frontend ya está hecha y sirve igual>
```

`notify_all: true` no es opcional acá: un bloqueo del que el backend no se entera es una tarea
muerta.

**El campo `Dónde quedé` tampoco es relleno:** sin él, quien retome —vos incluido, en dos
semanas— rehace trabajo que estaba bien.

Actualizá el ítem en `TODO.md` a 🔴 Pendientes marcándolo como bloqueado, y **borrá el claim
local** (`rm -f .claude/.tarea-actual`): ya no la estás trabajando.

---

## Modo CONSULTAR

Son **dos** llamadas, y no se pueden fusionar en una:

```
# 1. El panorama de lo VIVO (y la base para detectar duplicados de ID)
clickup_filter_tasks
  list_ids:       ["901716272178"]
  include_closed: true
  subtasks:       true

# 2. Lo cerrado RECIENTE, para no listar el archivo entero
clickup_filter_tasks
  list_ids:         ["901716272178"]
  include_closed:   true
  subtasks:         true
  date_closed_from: "<date -d '30 days ago' +%Y-%m-%d>"
```

**Por qué dos y no una con el filtro de fecha:** verificado contra la API, `date_closed_from`
devuelve **solo tareas cerradas**. Si lo ponés en la llamada principal desaparece todo lo que está
en `update required`, `in progress`, `to do` y `on hold` — o sea, todo lo que importa.

Paginá cada una hasta `has_more: false` y presentá:

- Qué está en **`update required`** — o sea, **lo que te toca a vos ahora**
- Qué está **`in progress`**, con quién la tiene y **con qué rol** (del comentario `INICIO`)
- Qué está **`on hold`**, con el motivo y dónde quedó; separá los `BLOQUEADO POR BACKEND`
- Qué hay en **`to do`**, distinguiendo backlog del backend (no es tuyo) de trabajo propio del
  frontend sin reclamar
- Qué se cerró en los **últimos 30 días** (de la segunda llamada). Ese es el tramo donde un fix
  todavía **reabre** la tarea original; más viejo que eso va como tarea nueva vinculada
- **Duplicados sospechosos**: dos o más subtareas con el mismo ID, o con slugs equivalentes
  creados el mismo día. Es el residuo de una carrera perdida que nadie detectó a tiempo —
  reportalos con sus `date_created` para que se pueda decidir cuál sobrevive. **Esto sale de la
  PRIMERA llamada, la que no tiene ventana**: un duplicado de ID hay que verlo contra todo el
  historial, no contra los últimos 30 días
- Si aparece alguna en **`reviewed`**: señalala como anomalía, ese estado no se usa

---

## Reglas que no se negocian en ningún modo

- **`include_closed: true`** en toda búsqueda. Viene apagado por defecto y sin él una tarea ya
  terminada no aparece → se crea un duplicado exacto.
- **`date_closed_from` NUNCA va en la búsqueda de validación.** Devuelve **solo tareas cerradas**
  (verificado contra la API), así que ahí haría desaparecer todo lo que está en `update required`,
  `in progress`, `to do` y `on hold`. Solo se usa como **segunda** llamada en CONSULTAR.
- **La ventana de 30 días es de DECISIÓN, no de búsqueda.** Un `complete` de hace más de 30 días
  **no se reabre**: va tarea nueva `T-…` vinculada. Pero el ID sigue siendo único contra **todo**
  el historial — si existe una `P-07` cerrada hace un año, no se crea otra `P-07`.
- **La identidad del ejecutor es el EMAIL** (`git config user.email`), no el nombre, y va DENTRO
  del texto del comentario. El campo "autor" de ClickUp siempre dice la cuenta del token, así que
  no sirve para detectar colisiones.
- **`Rol: frontend`** en todo comentario `INICIO`. `in progress` no dice por sí solo quién es.
- **Toda subtarea cuelga de `86e2xzf9d`.** Nunca una tarea suelta en la lista.
- **El frontend NO crea sub-subtareas.** El tercer nivel es del backend, para un solo escenario de
  emergencia. Si te parece que hace falta, planteáselo al usuario.
- **`in progress` va antes de escribir código**, no después.
- **`update required` significa una sola cosa: falta el frontend.** Nunca la devuelvas ahí. Para
  "quedó a medias" o "el backend no cumple" está `on hold`.
- **`reviewed` no se usa.**
- **No renombres una tarea que vino del backend.** Su nombre es la clave de identidad de los dos
  lados.
- Nada de credenciales, `.env`, ni datos de clientes en los comentarios **ni en los adjuntos** —
  tampoco en el campo `Cómo lo reproduzco` de un bloqueo.

---

## El claim local (`.claude/.tarea-actual`)

Alimenta al hook `UserPromptSubmit` (`.claude/hooks/recordar-protocolo.sh`), que inyecta el
recordatorio del protocolo en **cada** prompt.

- Lo escribe **RECLAMAR**, lo borran **CERRAR** y **BLOQUEAR**.
- Está **gitignored**: es estado de esta máquina y de esta persona, no del repo.
- **No es fuente de verdad del estado.** Si discrepa con ClickUp, **gana ClickUp**.
