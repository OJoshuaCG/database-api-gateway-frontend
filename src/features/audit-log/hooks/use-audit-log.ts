import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import type { QueryParams } from '@/lib/api/client'
import type { AuditLogEntry } from '@/lib/contracts'
import { getAuditLogEntry, listAuditLog } from '../api/audit-log.api'

/**
 * Página de la auditoría. `enabled` lo apaga quien no tiene `audit.read` (sería un 403 seguro) y
 * un rango de fechas invertido (sería un 422 seguro). `keepPreviousData`: cambiar de página o de
 * filtro no vacía la tabla mientras llega la siguiente.
 */
export function useAuditLog(params: QueryParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.auditLog.list(params),
    queryFn: ({ signal }) => listAuditLog(params, signal),
    placeholderData: keepPreviousData,
    enabled,
  })
}

/**
 * Una entrada, para el detalle. `placeholder` es la fila de la página en pantalla: el diálogo se
 * pinta al instante y el `GET /{id}` sirve para el enlace directo (`?entrada=`), donde la fila no
 * está en la página cargada.
 */
export function useAuditLogEntry(id: number, placeholder?: AuditLogEntry, enabled = true) {
  return useQuery({
    queryKey: queryKeys.auditLog.detail(id),
    queryFn: ({ signal }) => getAuditLogEntry(id, signal),
    placeholderData: placeholder,
    enabled,
  })
}
