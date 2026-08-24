# TODO — database-api-gateway-frontend

> **Espejo detallado de las tareas de ClickUp.** Este archivo es la fuente de verdad del
> **detalle**; ClickUp es la fuente de verdad del **estado** y de **quién** está trabajando.
> El protocolo completo está en la skill `clickup-task-flow-frontend`. No se trabaja nada sin
> pasar por ahí.

## Tarea principal en ClickUp

| Campo | Valor |
| --- | --- |
| **Task ID** | `86e2xzf9d` |
| **URL** | https://app.clickup.com/t/86e2xzf9d |
| **Espacio** | Cero208 (`90172691192`) |
| **Carpeta** | Desarrollo (`901710687203`) |
| **Lista** | Database Gateway (`901716272178`) |
| **Workspace** | `9017559023` |

**Tablero compartido con el backend, a propósito.** El ciclo
`update required → in progress (fe) → complete (fe)` ocurre sobre **la misma subtarea** que el
backend dejó lista. Por eso la entrada natural de trabajo acá es el estado `update required`, no
`to do`: los ítems en `to do` son backlog del backend y no se tocan desde este repo.

---

## 🔵 Handoff pendientes — esperando frontend

Tareas en `update required`: el backend terminó y **falta esta SPA**. Antes de implementar
cualquiera, leé el **último** comentario de la tarea: si es `HANDOFF INVALIDADO`, el backend está
cambiando el contrato ahora mismo y no hay que tocarla.

| # | Ítem | Resumen del handoff | Subtarea |
| --- | --- | --- | --- |
| T-260822-lz-clon-solo-datos-collation | Wizard de clonado: intención `data_only`, charset/collation y owner | El clon acepta `copy_intent: data_only`, selección declarativa por tipo/patrón con cierre por FK, charset/collation del destino validado, y owner de PostgreSQL. El **spec ahora se manda en el preview**, que lo congela. **Sin breaking changes** para la SPA actual (los contratos Zod no usan `.strict()`), pero hay **tres cambios de comportamiento** que el wizard tiene que absorber. Ver detalle abajo. | [86e2xzzyh](https://app.clickup.com/t/86e2xzzyh) |

### Detalle — T-260822-lz-clon-solo-datos-collation

**Endpoints cambiados**

- `POST /api/v1/database-clones/{id}/preview` — acá va el spec ahora, no en `create`:
  `copy_intent`, `structure`, `data`, `target_charset`, `target_owner_user_id`. Solo se aplica lo
  que viene en el cuerpo (un campo ausente deja el valor que el plan ya tenía). Devuelve los
  valores **efectivos** resueltos, `notices: [{code, message, severity, detail}]` y
  `blocking_issues`.
- `GET /api/v1/database-clones/{id}/objects` — acepta `?include_data_stats=true`; con eso cada
  objeto trae `row_estimate`, `row_estimate_known` y `has_primary_key`.
- `POST /api/v1/database-clones` — sin cambios obligatorios; `include_data` y `selection` siguen
  aceptándose como atajo legacy.

**Tres cambios de comportamiento a absorber**

1. `confirm_token` **puede llegar vacío** cuando hay `blocking_issues`: el plan se ve pero no se
   confirma. Hoy el wizard mandaría ese token vacío al `execute`.
2. Los **mensajes** de error cambiaron. `wizard/messages.ts` los matchea con expresiones regulares
   sobre la prosa (`/expiró/i`, `/cuarentena/i`); ahora hay **códigos estables `clone.*`** en
   `public_context.code`.
3. Todos los errores del módulo pasaron de `context` (dev-only) a **`public_context`**.

**Dos bloqueantes ya localizados en este repo**

- `WizardNav.tsx:41` bloquea el avance con selección de estructura vacía — que en solo-datos **es
  el modo**.
- La rehidratación de `use-database-clone-wizard.ts:366-412` devuelve un job `data_only` como
  `structure_and_data`. Es el fallo exacto que la feature arregla, y se recorre justo después de
  un `failed`.

**Qué hay que hacer**

1. Ofrecer las tres intenciones nombradas en `PlanStep` y derivar los ejes, con `data.on_existing`
   en `SelectionStep` (no antes de ver qué tablas tienen PK).
2. Arreglar los dos bloqueantes de arriba.
3. Migrar `messages.ts` de prosa a los códigos `clone.*`, y dar peso visual real a
   `blocking_issues` y a los notices peligrosos (hoy los warnings salen en gris `text-xs`).

**Contrato:** `backend/docs/features/database-clone.md` § Opciones del plan, § Guard de
compatibilidad del destino — commit `de73439`. Vocabulario cerrado de códigos y de `reason` en
`app/services/db_admin/clone_spec.py`.

**Límites del backend que vamos a sentir** (anotados por el backend como
`T-260822-lz-clon-contrato-frontend`): `CloneSummaryOut` **no expone el spec**, y `preview` da
`409` en cuanto el job deja de estar `pending` — así que después de un fallo no hay forma de
reconstruir cuál era el plan, justo cuando se usa «Replanear». Y `severity` solo tiene
`info|warning`, así que la lista de códigos peligrosos queda del lado del cliente.

**Nota:** el handoff menciona un plan de UI completo ya escrito, **fuera del repo**, y al agente
`frontend-planning`, que **este repositorio no tiene**. Hay que pedir ese plan antes de arrancar.

---

## 🟡 En curso

| # | Ítem | Ejecutor | Rol | Desde | Subtarea |
| --- | --- | --- | --- | --- | --- |

---

## 🔴 Pendientes — trabajo propio del frontend

Trabajo nacido en esta SPA que no viene de ningún handoff: fix visual, refactor de componente,
deuda de UI, regresión de accesibilidad. Se crean como `T-<YYMMDD>-<iniciales>-<slug>` colgando de
la tarea paraguas, y arrancan en `to do`. **Nunca** con el siguiente `P-XX` libre.

También van acá las tareas que quedaron **bloqueadas por backend** (`on hold` con un comentario
`BLOQUEADO POR BACKEND`), marcadas como tales.

| # | Ítem | Detalle | Estado | Subtarea |
| --- | --- | --- | --- | --- |

---

## 🟢 Realizadas

| # | Ítem | Qué se hizo | Qué quedó SIN verificar | Subtarea |
| --- | --- | --- | --- | --- |

**La columna "Qué quedó SIN verificar" no es opcional.** En este repo los tests **no se ejecutan
por rutina** (ver «Tests: escribirlos sí, ejecutarlos no» en `CLAUDE.md`), así que es normal que
algo quede sin probar. Lo que no es aceptable es que no esté dicho. Si escribiste tests y no los
corriste, se anota así, con todas las letras.
