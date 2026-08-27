import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardContent,
  EnvironmentBadge,
  Spinner,
} from '@/components/ui'
import { formatBytes, formatDateTime } from '@/lib/utils'
import { resolveEnvironmentState, useEnvironmentMap } from '@/features/environments'
import type { MigrationBlockReason, ModelMigrationSummary } from '@/lib/contracts'
import { useModelDatabases } from '../hooks/use-database-models'
import { useModelMigration, useUpdateModelMigration } from '../hooks/use-model-migrations'
import { pendingAdoptionOfVersion } from '../version-adoption'
import { MigrationBadges } from './MigrationBadges'

interface VersionFactsCardProps {
  modelId: number
  /**
   * Resumen de la versión seleccionada. Pinta casi toda la ficha **sin esperar ninguna petición**:
   * insignias, política, checksum y fecha de creación ya vienen en el listado.
   */
  summary: ModelMigrationSummary
  /** `current_version` del blueprint, para marcar si esta es la vigente. */
  blueprintCurrentVersion?: string | null
  /** Collation de referencia del blueprint, para contrastar un COLLATE forzado que difiera. */
  blueprintCollation?: string | null
  /**
   * Versión punta del catálogo CARGADO, o `null` cuando no se puede afirmar cuál es (catálogo
   * recortado por el tope de página). Solo se usa para redactar la pista del borrado.
   */
  latestVersion: string | null
  onRequestDelete: (version: string) => void
}

/**
 * Por qué no se puede eliminar la versión, según el `block_reason` del backend. `not_tip` es el
 * único que no impide editarla.
 */
const DELETE_BLOCK_HINT: Record<
  MigrationBlockReason | 'none',
  (latestVersion: string | null) => string | undefined
> = {
  none: () => undefined,
  applied: () =>
    'Alguna base de datos está hoy en esta versión o en una posterior. Crea una migración compensatoria.',
  partial: () =>
    'Tiene una aplicación parcial sin resolver: reconcilia esa BD o completa el apply antes de eliminarla.',
  not_tip: (latestVersion) =>
    latestVersion
      ? `Solo se puede eliminar la última versión (${latestVersion}).`
      : 'Solo se puede eliminar la última versión.',
}

/**
 * Ficha de la versión seleccionada: **el único lugar** donde vive su estado.
 *
 * Sustituye al «card delgado» que abría el `ModelMigrationDetailPanel` y absorbe lo que ese card
 * mostraba. No es un cuarto sitio donde repetir insignias: el vocabulario está en
 * `migration-badges.ts` y lo comparte con el desplegable.
 *
 * ## Tres reglas de honestidad que este card encarna
 *
 * 1. **Ninguna fila aparece o desaparece según la carga.** En un card de hechos, la ausencia de una
 *    fila se lee como un hecho: si «editada» solo se pintara cuando `updated_at !== created_at`,
 *    mientras el detalle carga el operador leería «no se editó nunca» — que es justo lo contrario de
 *    lo que hay que decir cuando hay una insignia `SQL editado tras aplicarse` al lado. La fila
 *    existe siempre, con esqueleto de alto fijo y «sin ediciones» explícito.
 * 2. **Las insignias pueden vivir del resumen; las MUTACIONES no.** Una versión puede haber
 *    desaparecido —borrada en otra pestaña, o justo después del propio borrado— y el listado
 *    tardaría un round-trip en enterarse. Con el detalle en error, la ficha lo dice y **cierra**
 *    «Revisar y aprobar» y «Eliminar»: nada de ofrecer acciones sobre una versión fantasma.
 * 3. **El bloque de adopción nunca pinta un número si no lo pudo leer.** Un contador a cero por un
 *    502 es la peor mentira posible en esta pantalla.
 *
 * ## Por qué el borrado va al PIE
 *
 * El menú del `Combobox` del selector es `absolute`, `max-h-60` (240 px) y `z-30`: cubre la franja
 * inmediatamente inferior, y se cierra al seleccionar. Un doble clic rápido en el desplegable
 * aterrizaría en lo que hubiera debajo. Nada destructivo puede vivir ahí.
 */
export function VersionFactsCard({
  modelId,
  summary,
  blueprintCurrentVersion,
  blueprintCollation,
  latestVersion,
  onRequestDelete,
}: VersionFactsCardProps) {
  // Misma clave que el panel de detalle: los dos observadores se deduplican en un solo fetch. De
  // aquí salen los ÚNICOS dos datos que el resumen no trae: `updated_at` y el tamaño del SQL.
  const detail = useModelMigration(modelId, summary.version, true)
  const databases = useModelDatabases(modelId, true)
  const environmentMap = useEnvironmentMap()
  const update = useUpdateModelMigration(modelId)

  const adoption = pendingAdoptionOfVersion(summary.version, databases.data ?? [])

  // `reviewed` del detalle antes que el del resumen: al aprobar, `useUpdateModelMigration` escribe
  // el detalle con `setQueryData` e INVALIDA el listado. Leyéndolo solo del resumen, la insignia
  // seguiría diciendo «sin revisar» un round-trip después de que el botón dejara de girar.
  const reviewed = detail.data?.reviewed ?? summary.reviewed
  const needsReview = reviewed === false
  const capturesSelects = summary.capture_selects === true
  const isCurrent = blueprintCurrentVersion === summary.version

  // La versión existe en el listado pero el detalle no la encuentra: se borró por debajo. No es un
  // error de red que convenga reintentar en silencio.
  const vanished = detail.isError
  const canMutate = detail.isSuccess && !vanished

  const deleteHint = DELETE_BLOCK_HINT[summary.block_reason ?? 'none'](latestVersion)
  const collationDiffers =
    blueprintCollation != null &&
    summary.forced_collations.some(
      (collation) => collation.toLowerCase() !== blueprintCollation.toLowerCase(),
    )

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4">
        {/* 1 — Identidad. Una línea, y nada más: es lo que el operador confirma antes de actuar. */}
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">{summary.version}</code>
          <span className="font-medium text-foreground">{summary.name}</span>
          {isCurrent && <Badge tone="info">versión actual del blueprint</Badge>}
        </div>

        {/* 2 — Qué hace y en qué estado está, con el vocabulario compartido. */}
        <MigrationBadges
          migration={summary}
          density="full"
          sourceEngine={detail.data?.source_engine ?? null}
          className="flex flex-wrap items-center gap-1.5"
        />

        {/* 3 — Adopción registrada. NO dice «aplicada»: ver el JSDoc de `version-adoption.ts`. */}
        <AdoptionRow
          modelId={modelId}
          version={summary.version}
          adoption={adoption}
          isLoading={databases.isLoading}
          isError={databases.isError}
          onRetry={() => void databases.refetch()}
          environmentMap={environmentMap}
          blockReason={summary.block_reason ?? null}
        />

        {/* 4 — Fechas y huella. Alto fijo: al cambiar de versión nada salta. */}
        <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <Fact label="Creada">{formatDateTime(summary.created_at)}</Fact>
          <Fact label="Editada">
            {detail.isLoading ? (
              <Skeleton />
            ) : detail.data && detail.data.updated_at !== summary.created_at ? (
              formatDateTime(detail.data.updated_at)
            ) : detail.data ? (
              'sin ediciones'
            ) : (
              '—'
            )}
          </Fact>
          <Fact label="SQL base">
            {detail.isLoading ? (
              <Skeleton />
            ) : detail.data ? (
              formatBytes(new TextEncoder().encode(detail.data.up_sql).length)
            ) : (
              '—'
            )}
          </Fact>
          {/* `break-all`: un checksum es hex sin puntos de corte, y partirlo no cambia lo que se
              lee. El valor completo va en el `title` porque acá se muestra recortado. */}
          <Fact label="Checksum">
            <span className="break-all font-mono" title={summary.checksum}>
              {summary.checksum.slice(0, 12)}…
            </span>
          </Fact>
        </dl>

        {/* 5 — Bandas: lo que tiene consecuencia y necesita explicarse. Nunca en un `title` — el de
            `Badge` va en un `<span>` no interactivo, así que no es nombre accesible y en táctil no
            existe. Es la regla que el propio `Callout` lleva escrita. */}
        {vanished && (
          <Callout
            tone="danger"
            title="Esta versión ya no existe en el servidor"
            action={
              <Button size="sm" variant="outline" onClick={() => void detail.refetch()}>
                Volver a comprobar
              </Button>
            }
          >
            <p>
              El listado todavía la incluye, pero su detalle responde con error. Puede haberse
              eliminado desde otra pestaña. Las acciones de esta versión quedan deshabilitadas.
            </p>
          </Callout>
        )}

        {summary.sql_diverged && (
          <Callout tone="warning" title="El SQL se editó después de que alguna base lo aplicara">
            <p>
              Esas bases conservan el esquema anterior: esta versión ya no describe el plano de
              todas sus bases. No restringe nada —el SQL nuevo es el que se aplica de aquí en
              más—, pero para alinearlas hace falta una versión compensatoria.
            </p>
          </Callout>
        )}

        {summary.sql_frozen && (
          <Callout tone="info" title="El SQL base de esta versión está congelado">
            <p>
              {summary.block_reason === 'partial'
                ? 'Tiene una aplicación parcial sin resolver.'
                : 'Alguna base está hoy en esta versión o en una posterior.'}{' '}
              Al editar podrás cambiar el nombre, el rollback y los overrides por motor; el SQL base
              solo por la vía de excepción, que pide confirmación explícita.
            </p>
          </Callout>
        )}

        {collationDiffers && (
          <Callout tone="warning" title="Esta versión fuerza un COLLATE distinto al del blueprint">
            <p>
              El blueprint declara <code>{blueprintCollation}</code> y el SQL fuerza{' '}
              <code>{summary.forced_collations.join(', ')}</code>. Las bases que la apliquen quedan
              con el collation del SQL, no con el de referencia.
            </p>
          </Callout>
        )}

        {needsReview && (
          <Callout
            tone="warning"
            title={
              capturesSelects
                ? 'Captura de SELECT sin revisar'
                : 'Este baseline todavía no se revisó'
            }
            action={
              <Button
                size="sm"
                isLoading={update.isPending}
                disabled={!canMutate}
                onClick={() => update.mutate({ version: summary.version, body: { reviewed: true } })}
              >
                Revisar y aprobar
              </Button>
            }
          >
            <p>
              {capturesSelects
                ? 'El SQL de esta versión guardará filas de la BD destino (cifradas) en el gateway. No se podrá aplicar, revertir ni stampear —el backend responde 409— hasta aprobarla.'
                : 'Se capturó del motor y nace sin revisar: no se podrá aplicar a ninguna BD (el backend responde 409) hasta aprobarlo.'}
            </p>
          </Callout>
        )}

        {/* 6 — Acciones de la versión, al pie y fuera de la franja que cubre el desplegable. */}
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          {capturesSelects && (databases.data?.length ?? 0) > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">
                Resultados capturados (solo la corrida más reciente por BD, y caduca sola):
              </span>
              {(databases.data ?? []).map((database) => (
                <Link
                  key={database.id}
                  to={`/managed-databases/${database.id}/migrations/${summary.version}/select-results`}
                  className="rounded-md border border-border px-2 py-1 text-xs text-primary hover:bg-primary/10"
                >
                  {database.name} →
                </Link>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* El motivo del bloqueo, VISIBLE. Antes era el `title` de un `<span>` envolviendo un
                botón deshabilitado: no llega por teclado ni en táctil, y es la única forma de saber
                cuál de las tres reglas se incumplió. */}
            {deleteHint && <p className="mr-auto text-xs text-muted-foreground">{deleteHint}</p>}
            <Button
              variant="danger-soft"
              size="sm"
              disabled={!summary.deletable || !canMutate}
              onClick={() => onRequestDelete(summary.version)}
            >
              Eliminar la versión {summary.version}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/** Alto fijo y ancho reservado: el esqueleto mide lo mismo que el valor que va a reemplazarlo. */
function Skeleton() {
  return (
    <span className="inline-block h-3 w-24 animate-pulse rounded bg-surface-muted align-middle" />
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <dt className="text-muted-foreground">{label}:</dt>
      <dd className="tabular-nums text-foreground">{children}</dd>
    </div>
  )
}

interface AdoptionRowProps {
  modelId: number
  version: string
  adoption: ReturnType<typeof pendingAdoptionOfVersion>
  isLoading: boolean
  isError: boolean
  onRetry: () => void
  environmentMap: ReturnType<typeof useEnvironmentMap>
  blockReason: MigrationBlockReason | null
}

/**
 * «Pendiente en N de M BDs», más los dos booleanos por versión que sí decide el backend.
 *
 * El número grande es el de **pendientes** y no un «aplicada en N»: es el único directo del
 * backend y el único que lleva a una acción. El porqué largo está en `version-adoption.ts`.
 */
function AdoptionRow({
  modelId,
  version,
  adoption,
  isLoading,
  isError,
  onRetry,
  environmentMap,
  blockReason,
}: AdoptionRowProps) {
  const statusUrl = `/database-models/${modelId}/migrations?tab=estado`

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-foreground">Adopción registrada</span>
        {isError ? (
          // Ni un número: un contador a cero por un 502 se lee como «ya está en todas partes».
          <>
            <span className="text-muted-foreground">No se pudo leer el estado en las BDs.</span>
            <Button size="sm" variant="ghost" onClick={onRetry}>
              Reintentar
            </Button>
          </>
        ) : isLoading ? (
          <span className="flex items-center gap-2 text-muted-foreground">
            <Spinner className="h-4 w-4" /> Cargando…
          </span>
        ) : adoption.total === 0 ? (
          <span className="text-muted-foreground">
            Ninguna BD activa usa este blueprint todavía.
          </span>
        ) : (
          <span className="text-foreground">
            <code>{version}</code> figura{' '}
            <strong className="tabular-nums">
              pendiente en {adoption.pending} de {adoption.total}
            </strong>{' '}
            BD(s).
          </span>
        )}
      </div>

      {!isError && !isLoading && adoption.byEnvironment.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {/* «con pendientes» y no «desglose»: esta lista NO suma al total, solo enumera dónde hay
              trabajo por hacer. */}
          <span>Entornos con pendientes:</span>
          {adoption.byEnvironment.map((entry) => (
            <span key={entry.environmentId ?? 'sin-clasificar'} className="flex items-center gap-1">
              <EnvironmentBadge state={resolveEnvironmentState(entry.environmentId, environmentMap)} />
              <span className="tabular-nums">({entry.pending})</span>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {blockReason === 'applied' && (
          <Badge tone="info" title="Por eso su SQL base está congelado y no se puede eliminar.">
            vigente en alguna BD
          </Badge>
        )}
        {blockReason === 'partial' && (
          <Badge tone="warning" title="Reconcilia esa BD o completa el apply.">
            aplicación parcial sin resolver
          </Badge>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Es la copia local del gateway, no una lectura del motor: una BD stampeada, adoptada o dada de
        alta declarando su versión aparece al día <strong>sin haber ejecutado este SQL</strong>.
        {adoption.excluded > 0 &&
          ` ${adoption.excluded} BD(s) quedan fuera del conteo por no estar activas.`}{' '}
        <Link to={statusUrl} className="text-primary hover:underline">
          Ver estado por BD →
        </Link>
      </p>
    </div>
  )
}
