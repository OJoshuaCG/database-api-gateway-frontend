import { readinessSchema, type Readiness } from '@/lib/contracts'

const HEALTH_URL = import.meta.env.VITE_HEALTH_URL?.replace(/\/$/, '')

export function isHealthConfigured(): boolean {
  return Boolean(HEALTH_URL)
}

export interface HealthResult {
  ok: boolean
  data: Readiness
}

/**
 * `GET /health/ready` — readiness (§11). Vive en la raíz, sin auth ni envelope, y puede
 * devolver 503. No usa el cliente API versionado.
 */
export async function getReadiness(signal?: AbortSignal): Promise<HealthResult> {
  if (!HEALTH_URL) throw new Error('VITE_HEALTH_URL no configurada')
  const response = await fetch(`${HEALTH_URL}/ready`, {
    headers: { Accept: 'application/json' },
    signal,
  })
  const text = await response.text()
  const body: unknown = text.length > 0 ? JSON.parse(text) : {}
  return { ok: response.ok, data: readinessSchema.parse(body) }
}
