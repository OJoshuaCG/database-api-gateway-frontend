import { fetchData, fetchPage, type QueryParams } from '@/lib/api/client'
import { auditLogEntrySchema, type AuditLogEntry, type Page } from '@/lib/contracts'

const BASE = '/audit-log'

/**
 * `GET /audit-log` (v29 §11.3) — paginado, las más nuevas primero. `policy.admin`, sin step-up.
 * `params` ya trae los nombres del backend (`from`/`to` incluidos): los arma `auditQueryParams`.
 */
export function listAuditLog(
  params: QueryParams,
  signal?: AbortSignal,
): Promise<Page<AuditLogEntry>> {
  return fetchPage(BASE, auditLogEntrySchema, { query: params, signal })
}

/** `GET /audit-log/{id}` — una entrada. `404 audit.not_found` si no existe. */
export function getAuditLogEntry(id: number, signal?: AbortSignal): Promise<AuditLogEntry> {
  return fetchData(`${BASE}/${id}`, auditLogEntrySchema, { signal })
}
