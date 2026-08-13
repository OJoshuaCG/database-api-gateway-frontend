import { fetchList, mutateData } from '@/lib/api/client'
import {
  charsetCollationOptionOutSchema,
  type CharsetCollationOptionCreate,
  type CharsetCollationOptionOut,
  type CharsetCollationOptionUpdate,
  type EngineFamily,
} from '@/lib/contracts'

const BASE = '/charset-collation-options'

/** `GET /charset-collation-options` — NO paginado, catálogo global. */
export function listCharsetCollationOptions(
  params?: { engine_family?: EngineFamily; only_enabled?: boolean },
  signal?: AbortSignal,
): Promise<CharsetCollationOptionOut[]> {
  return fetchList(BASE, charsetCollationOptionOutSchema, { query: params, signal })
}

/** `POST /charset-collation-options` — añade una combinación al catálogo. */
export function createCharsetCollationOption(
  body: CharsetCollationOptionCreate,
): Promise<CharsetCollationOptionOut> {
  return mutateData('POST', BASE, charsetCollationOptionOutSchema, { body })
}

/** `PATCH /charset-collation-options/{id}` — activa/desactiva o marca como sugerida. */
export function updateCharsetCollationOption(
  id: number,
  body: CharsetCollationOptionUpdate,
): Promise<CharsetCollationOptionOut> {
  return mutateData('PATCH', `${BASE}/${id}`, charsetCollationOptionOutSchema, { body })
}
