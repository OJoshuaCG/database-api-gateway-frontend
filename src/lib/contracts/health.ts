import { z } from 'zod'

/** `GET /health` — liveness (§11). Sin envelope, sin auth. */
export const livenessSchema = z.object({
  status: z.string(),
  service: z.string(),
  environment: z.string(),
})
export type Liveness = z.infer<typeof livenessSchema>

/** `GET /health/ready` — readiness (§11). `200` ready / `503` unavailable. */
export const readinessSchema = z.object({
  status: z.string(),
  service: z.string(),
  environment: z.string(),
  detail: z.string().nullable().optional(),
})
export type Readiness = z.infer<typeof readinessSchema>
