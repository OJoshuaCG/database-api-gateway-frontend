import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import type { DatabaseModelOut } from '@/lib/contracts'
import { listDatabaseModels } from '../api/database-models.api'

/** Blueprints para poblar selects. */
export function useDatabaseModelOptions() {
  return useQuery({
    queryKey: queryKeys.databaseModels.list({ options: 'all' }),
    queryFn: ({ signal }) => listDatabaseModels({ page: 1, size: 200 }, signal),
    staleTime: 60_000,
    select: (page): DatabaseModelOut[] => page.items,
  })
}
