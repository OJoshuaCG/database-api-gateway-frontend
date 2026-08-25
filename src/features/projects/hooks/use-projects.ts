import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import type { QueryParams } from '@/lib/api/client'
import { PROJECT_ERROR_CODES, type ProjectCreate, type ProjectUpdate } from '@/lib/contracts'
import {
  createProject,
  deleteProject,
  getProject,
  linkProjectBlueprints,
  listBlueprintProjects,
  listProjectBlueprints,
  listProjects,
  unlinkProjectBlueprint,
  updateProject,
} from '../api/projects.api'

export function useProjects(params: QueryParams) {
  return useQuery({
    queryKey: queryKeys.projects.list(params),
    queryFn: ({ signal }) => listProjects(params, signal),
    placeholderData: keepPreviousData,
  })
}

export function useProject(id: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.projects.detail(id),
    queryFn: ({ signal }) => getProject(id, signal),
    enabled,
  })
}

/**
 * Blueprints de un proyecto. Sin paginar y sin `params`: el endpoint devuelve la lista completa.
 */
export function useProjectBlueprints(id: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.projects.blueprints(id),
    queryFn: ({ signal }) => listProjectBlueprints(id, signal),
    enabled,
  })
}

/** Vista inversa: los proyectos a los que pertenece un blueprint (§3.9). Puede ser lista vacía. */
export function useBlueprintProjects(modelId: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.projects.ofBlueprint(modelId),
    queryFn: ({ signal }) => listBlueprintProjects(modelId, signal),
    enabled,
  })
}

/**
 * Alta de proyecto.
 *
 * Sin toast de error: el único fallo esperable es el 409 `project.name_taken`, y ese se muestra
 * **inline en el campo Nombre** con el foco puesto ahí. Un toast rojo encima taparía justamente
 * el campo que hay que corregir, y además invitaría a reintentar — que es lo contrario de lo que
 * resuelve este error.
 */
export function useCreateProject() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: ProjectCreate) => createProject(body),
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
      toast.success('Proyecto creado.', project.name)
    },
  })
}

/** Edición del proyecto. Mismo criterio que el alta con el 409 de nombre: se muestra inline. */
export function useUpdateProject(id: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: ProjectUpdate) => updateProject(id, body),
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
      queryClient.setQueryData(queryKeys.projects.detail(id), project)
      toast.success('Proyecto actualizado.', project.name)
    },
  })
}

/**
 * Borrado del proyecto.
 *
 * El `message` del backend se muestra **tal cual** («Proyecto eliminado. 3 blueprint(s)
 * desvinculado(s); ninguno fue borrado.»): es la última oportunidad de reafirmar que los
 * blueprints siguen existiendo, y un «Eliminado» genérico la desperdicia.
 *
 * Un 404 se trata como **éxito idempotente**: el proyecto ya no está, que es el estado que el
 * usuario pedía. Mostrar un error rojo ahí describe un fracaso que no ocurrió.
 */
export function useDeleteProject() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (id: number) => deleteProject(id),
    onSuccess: (message) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
      toast.success(message ?? 'Proyecto eliminado.')
    },
    onError: (error) => {
      const apiError = toApiError(error)
      if (apiError.code === PROJECT_ERROR_CODES.notFound) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
        toast.success('Este proyecto ya no existía.')
        return
      }
      toast.error('No se pudo eliminar el proyecto', apiError.message)
    },
  })
}

/**
 * Vinculación en lote (§3.7).
 *
 * Sin toast aquí: el resultado se pinta **dentro del selector**, que es donde el usuario está
 * mirando y donde hay que marcar las filas de `missing_model_ids` si llega el 422. El mensaje de
 * éxito combina `linked` y `already_linked` en **una sola frase de éxito** — ver `LinkResultText`.
 */
export function useLinkProjectBlueprints(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (modelIds: number[]) => linkProjectBlueprints(projectId, modelIds),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
    },
  })
}

/**
 * Desvinculación de a uno (§3.8). No pide confirmación —un `confirm()` aquí es fricción sin
 * contenido— y a cambio la pantalla ofrece deshacer.
 *
 * El 404 `project.blueprint_not_linked` también es éxito idempotente: el vínculo ya no estaba.
 */
export function useUnlinkProjectBlueprint(projectId: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (modelId: number) => unlinkProjectBlueprint(projectId, modelId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
    },
    onError: (error) => {
      const apiError = toApiError(error)
      if (apiError.code === PROJECT_ERROR_CODES.blueprintNotLinked) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
        return
      }
      toast.error('No se pudo quitar el blueprint del proyecto', apiError.message)
    },
  })
}
