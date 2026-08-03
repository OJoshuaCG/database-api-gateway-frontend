import { useCallback, useMemo, useState } from 'react'
import { toApiError, type ApiError } from '@/lib/api/errors'
import {
  QUERY_LIMITS,
  type EngineType,
  type QueryExecuteOut,
  type QueryHistoryOut,
  type QueryPreviewOut,
} from '@/lib/contracts'
import {
  blocksSystemDatabaseWrite,
  buildConnection,
  buildExecuteInput,
  decidePath,
  estimatedRowsTotal,
  exceedsSqlLimit,
  identityFromHistory,
  isPreviewStale,
  requestFingerprint,
  sqlByteLength,
  validateIdentity,
  EMPTY_IDENTITY,
  type ExecutionPath,
  type IdentityDraft,
  type PreviewSnapshot,
} from '../logic'
import { useCountdown } from '@/lib/utils/use-countdown'
import { classifyQueryError, isAutoRecoverable, type QueryErrorAction } from '../messages'
import { useExecuteQuery, usePreviewQuery } from './use-sql-console-mutations'

/**
 * Enfriamiento tras un 429. El backend limita a 30 llamadas por minuto y no manda
 * `Retry-After`, así que la pantalla se impone una pausa: sin ella, el botón vuelve a estar
 * disponible al instante y encadenar 429s es lo más fácil del mundo.
 */
const RATE_LIMIT_COOLDOWN_MS = 20_000

/**
 * Orquestador de la Consola SQL: es el único sitio donde vive el ciclo de vida del
 * `confirm_token`, que es la parte del contrato que más fácil se rompe.
 *
 * Decisión central: el token NO se invalida con efectos ni con handlers de cambio, sino por
 * comparación de HUELLA en cada render. `requestFingerprint` cubre exactamente lo que el
 * backend ata al token (SQL, base, modo, usuario, host, rol), así que cualquier edición
 * —del SQL o del selector de identidad— hace que `preview` valga `null` sin que nadie tenga
 * que acordarse de limpiarlo. Es también lo que evita el `setState` dentro de `useEffect`
 * que la configuración de este repo trata como error.
 */

export interface SqlConsoleOptions {
  dryRun: boolean
  /** `null` = usar el tope del despliegue. Solo puede BAJARLO, nunca subirlo. */
  maxRows: number | null
  timeoutMs: number
}

const DEFAULT_OPTIONS: SqlConsoleOptions = {
  dryRun: false,
  maxRows: null,
  timeoutMs: QUERY_LIMITS.defaultTimeoutMs,
}

export interface SqlConsoleController {
  // Entradas
  database: string
  setDatabase: (database: string) => void
  sql: string
  setSql: (sql: string) => void
  identity: IdentityDraft
  setIdentity: (identity: IdentityDraft) => void
  options: SqlConsoleOptions
  setOptions: (options: SqlConsoleOptions) => void

  // Derivados de render (nada de estado duplicado)
  /** Preview VIGENTE; `null` en cuanto el SQL o la identidad dejan de corresponderle. */
  preview: QueryPreviewOut | null
  path: ExecutionPath | null
  identityError: string | null
  sqlBytes: number
  sqlTooLarge: boolean
  /** Escritura sobre una BD de sistema: el execute respondería 403 aunque el preview no lo vea. */
  systemDatabaseBlocked: boolean
  canAnalyze: boolean

  // Estado de red
  isAnalyzing: boolean
  isExecuting: boolean
  error: ApiError | null
  errorAction: QueryErrorAction | null
  result: QueryExecuteOut | null
  /** Aviso discreto no bloqueante (p. ej. "se renovó la confirmación"). */
  notice: string | null
  dismissNotice: () => void
  /** Milisegundos que faltan para poder volver a llamar tras un 429; `0` si no hay pausa. */
  rateLimitCooldownMs: number

  // Diálogo de confirmación
  confirmOpen: boolean
  closeConfirm: () => void

  // Acciones
  analyze: () => Promise<void>
  analyzeAndRun: () => Promise<void>
  /** Abre la confirmación con el preview ya vigente, sin volver a clasificar. */
  openConfirm: () => void
  /** Ejecuta con el preview ya vigente (solo tiene sentido en el camino `direct`). */
  runCurrent: () => Promise<void>
  confirmAndExecute: (typedName: string) => Promise<void>
  dismissError: () => void
  switchToProvided: () => void
  loadFromHistory: (entry: QueryHistoryOut) => void
}

export function useSqlConsole(serverId: number, engine: EngineType | null): SqlConsoleController {
  const [database, setDatabaseState] = useState('')
  const [sql, setSqlState] = useState('')
  const [identity, setIdentityState] = useState<IdentityDraft>(EMPTY_IDENTITY)
  const [options, setOptions] = useState<SqlConsoleOptions>(DEFAULT_OPTIONS)

  const [snapshot, setSnapshot] = useState<PreviewSnapshot | null>(null)
  const [result, setResult] = useState<QueryExecuteOut | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [errorAction, setErrorAction] = useState<QueryErrorAction | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [cooldownUntil, setCooldownUntil] = useState<string | null>(null)

  const previewMutation = usePreviewQuery(serverId)
  const executeMutation = useExecuteQuery(serverId)

  const rateLimitCooldownMs = useCountdown(cooldownUntil)

  const connection = useMemo(() => buildConnection(identity, engine), [identity, engine])
  const fingerprint = useMemo(
    () => requestFingerprint(sql, database, connection),
    [sql, database, connection],
  )

  // El preview solo existe mientras le corresponda al SQL y la identidad actuales.
  const currentPreview =
    snapshot && !isPreviewStale(snapshot, fingerprint) ? snapshot.preview : null
  const path = currentPreview ? decidePath(currentPreview) : null

  const identityError = validateIdentity(identity, engine)
  const sqlBytes = sqlByteLength(sql)
  const sqlTooLarge = exceedsSqlLimit(sql)
  const systemDatabaseBlocked = currentPreview
    ? blocksSystemDatabaseWrite(engine, database, currentPreview.danger)
    : false

  const canAnalyze =
    database.trim().length > 0 &&
    sql.trim().length > 0 &&
    identityError === null &&
    !sqlTooLarge &&
    rateLimitCooldownMs === 0 &&
    !previewMutation.isPending &&
    !executeMutation.isPending

  const clearTransient = useCallback(() => {
    setError(null)
    setErrorAction(null)
    setNotice(null)
  }, [])

  // Los setters limpian los avisos porque un banner de la ejecución anterior, junto a un SQL
  // ya editado, describe algo que dejó de existir. El preview se invalida solo, por huella.
  const setDatabase = useCallback(
    (next: string) => {
      setDatabaseState(next)
      clearTransient()
    },
    [clearTransient],
  )

  const setSql = useCallback(
    (next: string) => {
      setSqlState(next)
      clearTransient()
    },
    [clearTransient],
  )

  const setIdentity = useCallback(
    (next: IdentityDraft) => {
      setIdentityState(next)
      clearTransient()
    },
    [clearTransient],
  )

  const reportError = useCallback((raw: unknown) => {
    const apiError = toApiError(raw)
    setError(apiError)
    setErrorAction(classifyQueryError(apiError))
    if (apiError.isRateLimited) {
      // `Date.now()` en un handler, nunca en render (`react-hooks/purity`).
      setCooldownUntil(new Date(Date.now() + RATE_LIMIT_COOLDOWN_MS).toISOString())
    }
  }, [])

  /**
   * Pide el preview y lo guarda junto a la huella con la que se pidió.
   *
   * El `reset()` del `finally` no es cosmético: React Query conserva las `variables` de la
   * última mutación en su caché en memoria, y esas variables incluyen la contraseña del modo
   * `provided`. Sin esto seguiría siendo legible desde el `MutationCache` mientras la
   * pantalla esté montada y hasta cinco minutos después de desmontarla.
   */
  const runPreview = useCallback(async (): Promise<PreviewSnapshot> => {
    try {
      const fresh = await previewMutation.mutateAsync({ database, sql, connection })
      const next: PreviewSnapshot = { preview: fresh, fingerprint }
      setSnapshot(next)
      return next
    } finally {
      previewMutation.reset()
    }
  }, [connection, database, fingerprint, previewMutation, sql])

  const analyze = useCallback(async () => {
    clearTransient()
    try {
      await runPreview()
    } catch (raw) {
      setSnapshot(null)
      reportError(raw)
    }
  }, [clearTransient, reportError, runPreview])

  /**
   * Ejecuta con el token de `active`. Ante un token caducado o que dejó de corresponder
   * (410 / 422), re-clasifica y reintenta UNA sola vez — pero solo si la estimación de
   * impacto no cambió: el admin confirmó una cifra concreta, no un cheque en blanco.
   */
  const runExecute = useCallback(
    async (active: PreviewSnapshot | null, typedName: string | null, allowRetry: boolean) => {
      // Mismo motivo que en `runPreview`: el body lleva la contraseña y React Query la
      // guardaría en `mutation.state.variables` hasta que alguien haga `reset()`.
      const attempt = async (snap: PreviewSnapshot | null) => {
        try {
          return await executeMutation.mutateAsync(
            buildExecuteInput({
              database,
              sql,
              connection,
              preview: snap?.preview ?? null,
              confirmTargetName: typedName,
              dryRun: options.dryRun,
              maxRows: options.maxRows,
              timeoutMs: options.timeoutMs,
            }),
          )
        } finally {
          executeMutation.reset()
        }
      }

      let firstFailure: unknown
      try {
        setResult(await attempt(active))
        setConfirmOpen(false)
        return
      } catch (raw) {
        firstFailure = raw
      }

      const apiError = toApiError(firstFailure)
      if (!allowRetry || !isAutoRecoverable(classifyQueryError(apiError))) {
        reportError(apiError)
        return
      }

      // Recuperación transparente: la confirmación caducó, y eso no es culpa del usuario.
      let renewed: PreviewSnapshot
      try {
        renewed = await runPreview()
      } catch (previewFailure) {
        reportError(previewFailure)
        return
      }

      const nextPath = decidePath(renewed.preview)
      if (nextPath === 'blocked') {
        setConfirmOpen(false)
        setNotice(
          'Al volver a clasificar la consulta, la política la marcó como prohibida. No se ejecutó nada.',
        )
        return
      }

      const before = active ? estimatedRowsTotal(active.preview) : null
      if (nextPath === 'confirm' && before !== estimatedRowsTotal(renewed.preview)) {
        setNotice(
          'La confirmación caducó y la estimación de impacto cambió al recalcularla. Revisá la cifra nueva y confirmá otra vez.',
        )
        return
      }

      try {
        setResult(await attempt(renewed))
        setConfirmOpen(false)
        setNotice('La confirmación había caducado: se renovó automáticamente.')
      } catch (retryFailure) {
        reportError(retryFailure)
      }
    },
    [connection, database, executeMutation, options, reportError, runPreview, sql],
  )

  /**
   * Botón principal. Clasifica y actúa en un solo gesto: una lectura se ejecuta directo
   * (que es lo que el contrato pide para `read`), una escritura abre la confirmación con un
   * token recién emitido —lo que vuelve raro el 410 en vez de habitual— y un lote prohibido
   * no ofrece ninguna salida de ejecución.
   */
  const analyzeAndRun = useCallback(async () => {
    clearTransient()
    let fresh: PreviewSnapshot
    try {
      fresh = await runPreview()
    } catch (raw) {
      setSnapshot(null)
      reportError(raw)
      return
    }

    switch (decidePath(fresh.preview)) {
      case 'blocked':
        return
      case 'confirm':
        setConfirmOpen(true)
        return
      default:
        await runExecute(fresh, null, true)
    }
  }, [clearTransient, reportError, runExecute, runPreview])

  /**
   * Cuando ya hay un preview vigente no se vuelve a clasificar: el rate limit es de 30/min y
   * el preview puede abrir conexión al motor para estimar impacto. Si el token caducó
   * mientras tanto, `runExecute` lo renueva solo.
   */
  const openConfirm = useCallback(() => {
    clearTransient()
    setConfirmOpen(true)
  }, [clearTransient])

  const runCurrent = useCallback(async () => {
    clearTransient()
    await runExecute(snapshot, null, true)
  }, [clearTransient, runExecute, snapshot])

  const confirmAndExecute = useCallback(
    async (typedName: string) => {
      setError(null)
      setErrorAction(null)
      await runExecute(snapshot, typedName, true)
    },
    [runExecute, snapshot],
  )

  const closeConfirm = useCallback(() => setConfirmOpen(false), [])
  const dismissNotice = useCallback(() => setNotice(null), [])

  const dismissError = useCallback(() => {
    setError(null)
    setErrorAction(null)
  }, [])

  /** Salida del 404/409 de `stored`: conservar el usuario tipeado y pedir la contraseña. */
  const switchToProvided = useCallback(() => {
    setIdentityState((current) => ({ ...current, mode: 'provided', password: '' }))
    clearTransient()
  }, [clearTransient])

  const loadFromHistory = useCallback(
    (entry: QueryHistoryOut) => {
      setSqlState(entry.sql_text)
      setDatabaseState(entry.database_name)
      setIdentityState(identityFromHistory(entry))
      setSnapshot(null)
      setResult(null)
      clearTransient()
      if (entry.connection_mode === 'provided') {
        // El backend tampoco la tiene: se descarta en cuanto termina el request.
        setNotice(
          'La contraseña no se guarda en ningún lado: volvé a escribirla para repetir esta consulta.',
        )
      }
    },
    [clearTransient],
  )

  return {
    database,
    setDatabase,
    sql,
    setSql,
    identity,
    setIdentity,
    options,
    setOptions,

    preview: currentPreview,
    path,
    identityError,
    sqlBytes,
    sqlTooLarge,
    systemDatabaseBlocked,
    canAnalyze,

    isAnalyzing: previewMutation.isPending,
    isExecuting: executeMutation.isPending,
    error,
    errorAction,
    result,
    notice,
    dismissNotice,
    rateLimitCooldownMs,

    // El diálogo solo existe en el camino de confirmación: si al re-clasificar el lote pasa
    // a estar prohibido, no puede quedarse abierto ofreciendo un botón que no hará nada.
    confirmOpen: confirmOpen && currentPreview !== null && path === 'confirm',
    closeConfirm,

    analyze,
    analyzeAndRun,
    openConfirm,
    runCurrent,
    confirmAndExecute,
    dismissError,
    switchToProvided,
    loadFromHistory,
  }
}
