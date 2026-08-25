import { z } from 'zod'

/**
 * Proyectos (api-reference-v16): agrupadores de blueprints en relación **N:M**. Un blueprint
 * puede estar en varios proyectos, en uno, o en ninguno.
 *
 * Un proyecto es **nombre + descripción + una lista de blueprints**. No tiene servidor, ni
 * credenciales, ni versión, ni entorno, y **no toca ningún motor de base de datos**: es
 * organización pura. Por eso ninguna acción de este módulo lleva el 🔌 del resto del gateway,
 * ni cuarentena, ni jobs asíncronos, ni polling.
 */

/** Tope de la descripción. Vive en el schema Pydantic del backend, no en la columna, y ningún
 *  endpoint lo publica (§8 pregunta 5 del plan): se replica aquí para poder contar caracteres
 *  en el formulario. Si el backend lo sube, este contador queda corto sin que nada avise. */
export const PROJECT_DESCRIPTION_MAX = 5000

/** Tope del nombre. Único en todo el gateway; el backend le recorta los espacios de los extremos. */
export const PROJECT_NAME_MAX = 150

/**
 * `ProjectOut` (§3.1) — misma forma en el listado, en el detalle, en la respuesta del alta y en
 * la vista inversa de un blueprint.
 *
 * `description` es `nullable` pero **no** `optional`: la omisión de claves nulas del backend
 * ocurre solo en el nivel superior del envelope (`message`, `pagination`). Dentro de `data` un
 * nulo viaja como `null` explícito.
 *
 * `blueprint_count` lo calcula el backend con **una sola query para toda la página**: se puede
 * pintar como columna sin pagar una llamada por fila.
 */
export const projectOutSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string().nullable(),
  blueprint_count: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type ProjectOut = z.infer<typeof projectOutSchema>

/**
 * `ProjectCreate` (§3.2).
 *
 * **`model_ids` existe en el contrato pero este formulario no lo envía nunca**, y no es una
 * omisión: si se manda y alguno de los ids no existe, el backend responde `422
 * project.blueprints_not_found` **con el proyecto ya creado y vacío** — los vínculos se validan
 * después de insertar la fila. Reintentar el alta daría entonces `409 project.name_taken` por el
 * nombre que la propia llamada anterior tomó. Se da de alta sin blueprints y se vincula en una
 * segunda llamada, donde ese 422 no puede dejar nada a medio camino.
 */
export const projectCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Requerido')
    .max(PROJECT_NAME_MAX, `Máximo ${PROJECT_NAME_MAX} caracteres`),
  description: z
    .string()
    .max(PROJECT_DESCRIPTION_MAX, `Máximo ${PROJECT_DESCRIPTION_MAX} caracteres`)
    .nullable()
    .optional(),
  model_ids: z.array(z.number().int()).optional(),
})
export type ProjectCreate = z.infer<typeof projectCreateSchema>

/**
 * `ProjectUpdate` (§3.4) — parcial de verdad: sin campos, no cambia nada.
 *
 * ⚠️ La semántica de `description` tiene **tres** estados y se distinguen por la PRESENCIA de la
 * clave, no por su valor:
 *
 * | Qué se manda            | Qué pasa            |
 * |-------------------------|---------------------|
 * | la clave ausente        | no se toca          |
 * | `description: null`     | **se limpia**       |
 * | `description: "texto"`  | se reemplaza        |
 *
 * Mandar `''` guarda una cadena vacía, que **no** es lo mismo que vaciarla. Por eso el formulario
 * ofrece un botón explícito «Vaciar la descripción» en vez de deducirlo de un campo en blanco.
 *
 * `name: null` no significa nada y el backend lo ignora: para no tocar el nombre se omite la clave.
 */
export const projectUpdateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Requerido')
    .max(PROJECT_NAME_MAX, `Máximo ${PROJECT_NAME_MAX} caracteres`)
    .optional(),
  description: z
    .string()
    .max(PROJECT_DESCRIPTION_MAX, `Máximo ${PROJECT_DESCRIPTION_MAX} caracteres`)
    .nullable()
    .optional(),
})
export type ProjectUpdate = z.infer<typeof projectUpdateSchema>

/** `ProjectBlueprintsIn` (§3.7) — cuerpo de la vinculación. Al menos un id. */
export const projectBlueprintsInSchema = z.object({
  model_ids: z.array(z.number().int()).min(1, 'Selecciona al menos un blueprint'),
})
export type ProjectBlueprintsIn = z.infer<typeof projectBlueprintsInSchema>

/**
 * `ProjectBlueprintsLinkOut` (§3.7) — resultado de vincular.
 *
 * `linked` y `already_linked` son cosas distintas y las dos son **éxito**: la operación es
 * idempotente, así que reenviar un blueprint que ya pertenecía no falla, sale en
 * `already_linked`. Presentarlo como advertencia enseñaría al operador a desconfiar de una
 * llamada que es segura de repetir — y a calcular a mano el delta que el backend ya calcula.
 */
export const projectBlueprintsLinkOutSchema = z.object({
  project_id: z.number().int(),
  linked: z.array(z.number().int()).default([]),
  already_linked: z.array(z.number().int()).default([]),
  blueprint_count: z.number().int(),
})
export type ProjectBlueprintsLinkOut = z.infer<typeof projectBlueprintsLinkOutSchema>

/**
 * Vocabulario cerrado de `detail.public_context.code` del módulo (§4). Se clasifica **siempre**
 * por este código, nunca por la prosa de `msg` ni por `detail.context` (que solo llega en
 * `development`).
 *
 * Dos pares que NO son intercambiables, y confundirlos manda al usuario al lugar equivocado:
 *
 * - `nameTaken` vs `linkConflict`: los dos son 409. El primero se arregla **cambiando un dato que
 *   el usuario escribió**; el segundo, **repitiendo la misma llamada**. Ofrecer «reintentar» en
 *   el primero es un bucle; pedir otro nombre en el segundo manda a arreglar algo que no está roto.
 * - `blueprintNotLinked` vs `blueprintNotFound`: los dos son 404. El primero es la **relación**
 *   (el blueprint existe, el vínculo no); el segundo, el **recurso**.
 */
export const PROJECT_ERROR_CODES = {
  notFound: 'project.not_found',
  blueprintsNotFound: 'project.blueprints_not_found',
  nameTaken: 'project.name_taken',
  linkConflict: 'project.link_conflict',
  blueprintNotLinked: 'project.blueprint_not_linked',
  blueprintNotFound: 'project.blueprint_not_found',
} as const
