import { fetchData, fetchList, fetchPage, mutateData, mutateVoid } from '@/lib/api/client'
import type { QueryParams } from '@/lib/api/client'
import {
  databaseModelOutSchema,
  projectBlueprintsLinkOutSchema,
  projectOutSchema,
  type DatabaseModelOut,
  type Page,
  type ProjectBlueprintsLinkOut,
  type ProjectCreate,
  type ProjectOut,
  type ProjectUpdate,
} from '@/lib/contracts'

const BASE = '/projects'

/** `GET /projects` — listado **paginado** (§3.1). `blueprint_count` ya viene calculado. */
export function listProjects(
  params: QueryParams,
  signal?: AbortSignal,
): Promise<Page<ProjectOut>> {
  return fetchPage(BASE, projectOutSchema, { query: params, signal })
}

export function getProject(id: number, signal?: AbortSignal): Promise<ProjectOut> {
  return fetchData(`${BASE}/${id}`, projectOutSchema, { signal })
}

/**
 * `POST /projects` → 201 (§3.2).
 *
 * El alta se manda **sin `model_ids`** a propósito: ver `projectCreateSchema`. Los blueprints se
 * vinculan después con `linkProjectBlueprints`, donde un id inválido no puede dejar el proyecto
 * a medio crear.
 */
export function createProject(body: ProjectCreate): Promise<ProjectOut> {
  return mutateData('POST', BASE, projectOutSchema, { body })
}

/**
 * `PATCH /projects/{id}` (§3.4) — parcial por **presencia de la clave**.
 *
 * El cuerpo se pasa tal cual lo arma el formulario: `description: null` vacía la descripción y
 * omitir la clave la deja intacta. `JSON.stringify` conserva los `null` explícitos, que es
 * justamente lo que distingue las dos intenciones.
 */
export function updateProject(id: number, body: ProjectUpdate): Promise<ProjectOut> {
  return mutateData('PATCH', `${BASE}/${id}`, projectOutSchema, { body })
}

/**
 * `DELETE /projects/{id}` (§3.5) — devuelve el `message`, no `data`.
 *
 * Ese texto («Proyecto eliminado. 3 blueprint(s) desvinculado(s); ninguno fue borrado.») se
 * muestra **tal cual**: es la última oportunidad de reafirmar que los blueprints no se tocaron.
 */
export function deleteProject(id: number): Promise<string | undefined> {
  return mutateVoid('DELETE', `${BASE}/${id}`)
}

/**
 * `GET /projects/{id}/blueprints` (§3.6) — lista **completa**, sin paginar.
 *
 * No acepta `page`/`size`: son unidades, no miles. Un paginador aquí agregaría controles que
 * nunca se usan y sugeriría que hay datos ocultos.
 */
export function listProjectBlueprints(
  id: number,
  signal?: AbortSignal,
): Promise<DatabaseModelOut[]> {
  return fetchList(`${BASE}/${id}/blueprints`, databaseModelOutSchema, { signal })
}

/**
 * `POST /projects/{id}/blueprints` (§3.7) — **idempotente y todo-o-nada**.
 *
 * Se puede mandar la selección completa (incluidos los que ya pertenecen): saldrán en
 * `already_linked` con 200. No hace falta calcular el delta en cliente ni deduplicar — el backend
 * deduplica conservando el orden.
 *
 * Si **algún** id no existe: 422 `project.blueprints_not_found` y **no se vincula ninguno**; el
 * `missing_model_ids` del error señala cuáles.
 */
export function linkProjectBlueprints(
  id: number,
  modelIds: number[],
): Promise<ProjectBlueprintsLinkOut> {
  return mutateData('POST', `${BASE}/${id}/blueprints`, projectBlueprintsLinkOutSchema, {
    body: { model_ids: modelIds },
  })
}

/**
 * `DELETE /projects/{id}/blueprints/{model_id}` (§3.8) — suelta el vínculo; el blueprint queda
 * intacto. Un 404 `project.blueprint_not_linked` significa que el vínculo ya no estaba: el estado
 * final es el que el usuario quería, así que se trata como éxito idempotente.
 */
export function unlinkProjectBlueprint(
  id: number,
  modelId: number,
): Promise<string | undefined> {
  return mutateVoid('DELETE', `${BASE}/${id}/blueprints/${modelId}`)
}

/**
 * `GET /database-models/{model_id}/projects` (§3.9) — vista inversa, **sin paginar**.
 *
 * Vive en este módulo aunque cuelgue de la ruta de blueprints: devuelve `ProjectOut[]` y su caché
 * se invalida con las mismas mutaciones de vinculación.
 */
export function listBlueprintProjects(
  modelId: number,
  signal?: AbortSignal,
): Promise<ProjectOut[]> {
  return fetchList(`/database-models/${modelId}/projects`, projectOutSchema, { signal })
}
