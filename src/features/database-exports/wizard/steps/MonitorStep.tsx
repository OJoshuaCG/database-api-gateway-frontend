import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Pagination,
  Spinner,
  type BadgeTone,
} from '@/components/ui'
import { cn, formatBytes, formatDuration, formatInteger, isClipboardAvailable } from '@/lib/utils'
import { formatCountdown } from '@/lib/utils/countdown'
import { useToast } from '@/lib/toast/use-toast'
import type { ExportItem, ExportItemStatus, ExportJobPhase, ExportJobStatus } from '@/lib/contracts'
import { Callout, WarningList, type CalloutTone } from '../../components/Callout'
import {
  EXPORT_ITEM_STATUS_LABELS,
  EXPORT_PHASE_LABELS,
  EXPORT_PHASE_ORDER,
  EXPORT_STATUS_HINTS,
  EXPORT_STATUS_LABELS,
  exportItemReasonLabel,
} from '../../messages'
import { ErrorRecoveryPanel } from '../ErrorRecoveryPanel'
import type { DatabaseExportWizard } from '../use-database-export-wizard'

/**
 * Vista de job: sigue la exportación por polling de `GET /{id}` y, al terminar, muestra el artefacto
 * (manifiesto, checksum, TTL, entrega de un solo uso) y el reporte por objeto.
 */

const STATUS_TONE: Record<ExportJobStatus, CalloutTone> = {
  pending: 'info',
  running: 'info',
  succeeded: 'success',
  failed: 'danger',
  canceled: 'warning',
  interrupted: 'warning',
}

const ITEM_STATUS_TONE: Record<ExportItemStatus, BadgeTone> = {
  ok: 'success',
  error: 'error',
  skipped: 'warning',
}

/**
 * Barra de fases. **Es indeterminada a propósito y no lleva porcentaje**: el total real de bytes no
 * se sabe de antemano, así que cualquier porcentaje sería inventado — y un porcentaje falso es peor
 * que ninguno, porque el operador decide cuánto esperar con él. Lo que sí es información real es el
 * nombre de la fase y su posición en el recorrido.
 */
function PhaseBar({ phase }: { phase: ExportJobPhase | null }) {
  const currentIndex = phase ? EXPORT_PHASE_ORDER.indexOf(phase) : -1
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs">
      {EXPORT_PHASE_ORDER.map((step, index) => (
        <li
          key={step}
          aria-current={index === currentIndex ? 'step' : undefined}
          className={cn(
            'rounded-full border px-3 py-1 font-medium',
            index === currentIndex
              ? 'border-primary bg-primary/10 text-primary'
              : index < currentIndex
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-border text-muted-foreground',
          )}
        >
          {EXPORT_PHASE_LABELS[step]}
        </li>
      ))}
    </ol>
  )
}

function Counter({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold text-foreground">{value}</span>
    </div>
  )
}

/** Lo que se ve mientras el job corre. */
function RunningView({ wizard }: { wizard: DatabaseExportWizard }) {
  const [cancelOpen, setCancelOpen] = useState(false)
  const job = wizard.job.data
  const progress = job?.progress ?? null
  const degradations = progress?.degradations ?? []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          {job ? EXPORT_STATUS_LABELS[job.status] : 'Exportando'}
          {progress ? ` · ${EXPORT_PHASE_LABELS[progress.phase]}` : null}
        </span>
        {/* El freno está visible durante TODA la corrida, no solo en una fase concreta. */}
        <Button variant="danger-soft" onClick={() => setCancelOpen(true)}>
          Cancelar exportación
        </Button>
      </div>

      <PhaseBar phase={job?.phase ?? progress?.phase ?? null} />

      {/*
        Los contadores se persisten THROTTLEADOS a ~3 s: dos lecturas seguidas del polling pueden
        traer exactamente los mismos números sin que nada esté detenido. Por eso no hay ningún
        indicador de «sin avance» — sería un falso positivo por diseño.
      */}
      {progress == null ? (
        <p className="text-sm text-muted-foreground">Esperando el primer avance del worker…</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Counter label="Objetos" value={formatInteger(progress.objects)} />
          <Counter label="Filas" value={formatInteger(progress.rows)} />
          <Counter label="Sentencias" value={formatInteger(progress.statements)} />
          <Counter label="Tablas con datos" value={formatInteger(progress.tables_with_data)} />
          <Counter label="Escrito" value={formatBytes(progress.bytes)} />
        </div>
      )}

      {degradations.length > 0 && (
        <Callout tone="warning" title="Garantías que no se pudieron aplicar">
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {degradations.map((degradation, index) => (
              <li key={`${index}:${degradation}`}>{degradation}</li>
            ))}
          </ul>
        </Callout>
      )}

      {progress && <WarningList warnings={progress.warnings} title="Avisos de la corrida" />}

      {/*
        NO hay tabla de incidencias en vivo, y es una trampa explícita del contrato: los ítems se
        escriben de una sola vez AL TERMINAR el job, así que durante la corrida `/items` devuelve
        lista vacía. Pintarla acá mostraría «0 incidencias» durante toda la exportación, que es lo
        contrario de la verdad. El reporte pertenece a la pantalla de resultado.
      */}
      <p className="text-xs text-muted-foreground">
        El reporte por objeto se publica de una sola vez cuando el job termina: durante la corrida
        no hay incidencias que mostrar todavía.
      </p>

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={() => {
          wizard.cancelExport()
          setCancelOpen(false)
        }}
        title="¿Cancelar la exportación?"
        confirmLabel="Cancelar exportación"
        tone="danger"
        isLoading={wizard.cancel.isPending}
      >
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>
            La cancelación es <strong>cooperativa</strong>: el worker no se mata, corta en el
            próximo punto seguro. Puede tardar unos segundos en reflejarse.
          </p>
          <p>
            Al cortar se <strong>descarta el artefacto parcial</strong>: no queda nada que descargar
            y hay que crear un plan nuevo para volver a intentarlo.
          </p>
        </div>
      </ConfirmDialog>
    </div>
  )
}

/** Metadatos del artefacto, TTL y las dos entregas de un solo uso. */
function ArtifactPanel({ wizard }: { wizard: DatabaseExportWizard }) {
  const toast = useToast()
  const manifest = wizard.manifest.data

  if (wizard.manifest.isLoading && !manifest) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" /> Cargando el manifiesto del artefacto…
      </div>
    )
  }
  if (!manifest) return null

  // El TTL del ARTEFACTO (30 min desde que el job termina) es un plazo distinto del PLAN (24 h) y sale
  // del `expires_at` del manifiesto, no de un temporizador local: empieza a correr en el servidor.
  // `artifactExpired` ya aplica la regla en el hook (un contador en 0 sin fecha NO es un artefacto
  // purgado); se consume de ahí para no mantener una segunda copia esperando a divergir.
  const hasDeadline = manifest.expires_at != null
  const purged = wizard.artifactExpired

  /**
   * `inline_delivery_viable` viene del preview, que en esta pantalla puede no estar cargado (el panel
   * vivo solo corre en los pasos del formulario). Si no lo tenemos, no se deshabilita nada: el
   * backend responde 409 y el error se explica ahí — mejor que bloquear una acción legítima.
   */
  const inlineNotViable = wizard.confirmPreview?.inline_delivery_viable === false
  const deliveryBlocked = purged || wizard.actionCooldown

  /**
   * Sin portapapeles, «Copiar contenido» no es una acción que falla: es una que **gasta**. El
   * `GET /content` consume el artefacto de un solo uso ANTES de llegar al `writeText`, así que el
   * admin se queda sin exportación y sin texto, y la única salida es crear un plan nuevo. Por eso
   * se deshabilita en vez de dejar que lo intente.
   */
  const clipboardAvailable = isClipboardAvailable()

  const sha256 = manifest.sha256

  async function copyChecksum() {
    if (!sha256) return
    // Sin portapapeles el diagnóstico es otro —no lo denegó nadie, la API no existe— y decirlo mal
    // manda al admin a revisar permisos del navegador que no tienen nada que ver.
    if (!clipboardAvailable) {
      toast.error(
        'El portapapeles no está disponible',
        'Copiá el checksum a mano; está a la vista.',
      )
      return
    }
    // El `try/catch` sigue haciendo falta: en un contexto seguro el permiso todavía puede negarse,
    // y un «copiado» que no copió nada es peor que un error.
    try {
      await navigator.clipboard.writeText(sha256)
      toast.success('Checksum copiado', 'Comparalo con el sha256 del archivo que bajaste.')
    } catch {
      toast.error('No se pudo copiar', 'El navegador denegó el acceso al portapapeles.')
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-card border border-border p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Artefacto
      </h3>

      {/*
        Se usa `wizard.partialArtifact` y no `manifest.complete` a secas porque `/manifest` responde
        también sobre un job en curso, y ahí `complete` es `false` simplemente porque todavía no hay
        nada completo. Leerlo a secas pintaría una banda roja de «artefacto parcial» sobre una
        exportación que va perfectamente. La regla real es: terminal Y `complete === false`.
        Va ANTES del botón de descarga: el aviso solo sirve si se lee antes de bajar el archivo.
      */}
      {wizard.partialArtifact && (
        <Callout tone="danger" title="El artefacto es PARCIAL">
          <p>
            La corrida no completó todos los objetos. El archivo existe, pero no describe la base
            entera: revisá el reporte por objeto antes de ejecutarlo en ningún sitio.
          </p>
        </Callout>
      )}

      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">Tamaño</dt>
          <dd className="font-medium text-foreground">{formatBytes(manifest.byte_size)}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">Partes</dt>
          <dd className="font-medium text-foreground">
            {manifest.part_count == null ? '—' : formatInteger(manifest.part_count)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">Filas totales</dt>
          <dd className="font-medium text-foreground">
            {manifest.total_rows == null ? '—' : formatInteger(manifest.total_rows)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">Vigencia</dt>
          <dd className="font-medium text-foreground">
            {!hasDeadline ? '—' : purged ? 'Purgado' : formatCountdown(wizard.artifactRemainingMs)}
          </dd>
        </div>
      </dl>

      {sha256 && (
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 break-all rounded-lg border border-border bg-surface-muted px-2 py-1 text-xs text-foreground">
            {sha256}
          </code>
          <Button variant="ghost" size="sm" onClick={() => void copyChecksum()}>
            Copiar checksum
          </Button>
        </div>
      )}

      {purged && (
        <Callout tone="warning" title="El artefacto se purgó">
          <p>
            El plazo del artefacto se cumplió y el gateway lo borró. El manifiesto sobrevive —así
            que sigue constando qué se llevó—, pero el archivo ya no se puede descargar: hay que
            crear un plan nuevo.
          </p>
        </Callout>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          La entrega es de <strong>un solo uso</strong>: al completarse, el artefacto queda
          consumido y un segundo intento responde 410.
          {hasDeadline && !purged
            ? ` Quedan ${formatCountdown(wizard.artifactRemainingMs)} antes de que se purgue.`
            : ''}{' '}
          Cada descarga <strong>queda registrada en la auditoría</strong> del gateway.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={deliveryBlocked || wizard.download.isPending || wizard.copyContent.isPending}
            isLoading={wizard.download.isPending}
            onClick={wizard.downloadArtifact}
          >
            Descargar artefacto
          </Button>
          <Button
            variant="outline"
            disabled={
              deliveryBlocked ||
              inlineNotViable ||
              !clipboardAvailable ||
              wizard.copyContent.isPending ||
              wizard.download.isPending
            }
            isLoading={wizard.copyContent.isPending}
            onClick={wizard.copyArtifact}
          >
            Copiar contenido
          </Button>
        </div>
        {inlineNotViable && (
          <p className="text-xs text-muted-foreground">
            Copiar el contenido está deshabilitado porque el plan marcó la entrega en línea como no
            viable: el artefacto supera el máximo y nunca se trunca.
          </p>
        )}
        {!clipboardAvailable && !inlineNotViable && (
          <p className="text-xs text-muted-foreground">
            Copiar el contenido está deshabilitado porque este navegador no expone el portapapeles:
            el gateway se está sirviendo sobre HTTP sin TLS. Usá «Descargar artefacto», que sí
            funciona; intentar copiar consumiría la entrega sin darte el texto.
          </p>
        )}
        {wizard.actionCooldown && (
          <p className="text-xs text-muted-foreground">
            Esperá unos segundos: estas entregas están limitadas a 3 por minuto y dos clics gastan
            dos.
          </p>
        )}
      </div>

      {wizard.download.data?.complete === false && (
        <Callout tone="danger" title="Lo que se descargó es PARCIAL">
          <p>
            La entrega vino marcada como incompleta. No ejecutes ese archivo contra ningún motor sin
            revisar antes el reporte por objeto.
          </p>
        </Callout>
      )}

      {wizard.copyContent.data?.copied === false && (
        <Callout tone="warning" title="El contenido no llegó al portapapeles">
          <p>
            El navegador denegó el acceso, pero el artefacto <strong>ya quedó consumido</strong>: no
            se puede volver a pedir. Hay que crear un plan nuevo.
          </p>
        </Callout>
      )}
    </section>
  )
}

/** Reporte por objeto, disponible solo cuando el job terminó. */
function ItemsReport({ wizard }: { wizard: DatabaseExportWizard }) {
  const { items } = wizard

  const columns = useMemo<ColumnDef<ExportItem>[]>(
    () => [
      { accessorKey: 'seq', header: '#' },
      { accessorKey: 'object_type', header: 'Tipo' },
      {
        accessorKey: 'object_name',
        header: 'Objeto',
        cell: ({ row }) => <span className="text-foreground">{row.original.object_name}</span>,
      },
      { accessorKey: 'phase', header: 'Fase' },
      {
        id: 'status',
        header: 'Estado',
        accessorFn: (row) => EXPORT_ITEM_STATUS_LABELS[row.status],
        cell: ({ row }) => (
          <Badge tone={ITEM_STATUS_TONE[row.original.status]}>
            {EXPORT_ITEM_STATUS_LABELS[row.original.status]}
          </Badge>
        ),
      },
      {
        id: 'reason',
        header: 'Motivo',
        // Nunca el código crudo: `reason` es de vocabulario cerrado y `messages.ts` lo traduce.
        accessorFn: (row) => exportItemReasonLabel(row.reason) ?? '—',
        cell: ({ getValue }) => <span className="text-muted-foreground">{getValue<string>()}</span>,
      },
      {
        id: 'rows_exported',
        header: 'Filas',
        accessorFn: (row) => (row.rows_exported == null ? '—' : formatInteger(row.rows_exported)),
      },
      {
        id: 'bytes_written',
        header: 'Bytes',
        accessorFn: (row) => formatBytes(row.bytes_written),
      },
      {
        id: 'deterministic',
        header: 'Orden',
        accessorFn: (row) =>
          row.deterministic == null ? '—' : row.deterministic ? 'Garantizado' : 'Sin garantía',
        cell: ({ row }) =>
          row.original.deterministic === false ? (
            <Badge tone="warning">⚠ sin garantía</Badge>
          ) : (
            <span className="text-muted-foreground">
              {row.original.deterministic == null ? '—' : 'Garantizado'}
            </span>
          ),
      },
      {
        id: 'execution_ms',
        header: 'Duración',
        accessorFn: (row) => (row.execution_ms == null ? '—' : formatDuration(row.execution_ms)),
      },
    ],
    [],
  )

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Reporte por objeto
      </h3>
      <DataTable
        data={items.data?.items ?? []}
        columns={columns}
        isLoading={items.isLoading}
        isFetching={items.isFetching}
        getRowId={(item) => String(item.id)}
        searchPlaceholder="Buscar un objeto…"
        emptyState={
          <EmptyState
            title="Sin objetos en el reporte"
            description="La corrida no registró ningún objeto."
          />
        }
      />
      {items.data && (
        <Pagination
          page={items.data.pagination.page}
          pages={items.data.pagination.pages}
          total={items.data.pagination.total}
          size={items.data.pagination.size}
          hasNext={items.data.pagination.has_next}
          hasPrev={items.data.pagination.has_prev}
          onPageChange={wizard.setItemsPage}
          isFetching={items.isFetching}
        />
      )}
    </section>
  )
}

export function MonitorStep({ wizard }: { wizard: DatabaseExportWizard }) {
  const { job } = wizard

  if (wizard.jobId == null) {
    return (
      <EmptyState
        title="No hay ninguna exportación que seguir"
        description="Creá un plan desde el primer paso del asistente."
        action={
          <Button variant="outline" onClick={wizard.reset}>
            Empezar de nuevo
          </Button>
        }
      />
    )
  }

  // Las guardas llevan `&& !job.data` para que el polling no deje la pantalla en blanco: un refetch
  // en vuelo pone `isFetching`/`isError` sin invalidar los datos que ya se están mostrando.
  if (job.isLoading && !job.data) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Spinner /> Cargando el estado de la exportación…
      </div>
    )
  }
  if (job.isError && !job.data) {
    /*
      Ojo con el módulo apagado: si `export.disabled` llega en OTRA llamada, esta vista NO se
      desmonta. Con el módulo apagado los endpoints de observación y de freno —leer el job, los
      ítems, el manifiesto y cancelar— siguen respondiendo a propósito, porque si alguien apaga el
      módulo mientras hay un job corriendo el operador tiene que poder verlo y detenerlo.
    */
    return (
      <ErrorRecoveryPanel
        error={job.error}
        title="No se pudo cargar el estado de la exportación"
        onStartOver={wizard.reset}
      />
    )
  }

  const data = job.data
  if (!data) return null

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-foreground">
          Exportación #{data.id} · {data.database_name}
        </h2>
        <Badge
          tone={
            data.status === 'succeeded' ? 'success' : data.status === 'failed' ? 'error' : 'neutral'
          }
        >
          {EXPORT_STATUS_LABELS[data.status]}
        </Badge>
      </div>

      {!wizard.jobIsTerminal ? (
        <RunningView wizard={wizard} />
      ) : (
        <>
          <Callout tone={STATUS_TONE[data.status]} title={EXPORT_STATUS_LABELS[data.status]}>
            {EXPORT_STATUS_HINTS[data.status] ? <p>{EXPORT_STATUS_HINTS[data.status]}</p> : null}
            {data.error ? <p>{data.error}</p> : null}
          </Callout>

          {/* El esquema cambió DURANTE la corrida. No invalida el artefacto —los datos siguen siendo
              consistentes— pero el operador tiene que enterarse, y por eso va junto a la descarga. */}
          {data.structure_drift_detected && (
            <Callout tone="warning" title="El esquema cambió durante la exportación">
              <p>
                Alguien modificó la estructura mientras el volcado corría. Los datos siguen siendo
                consistentes entre sí, pero la estructura del artefacto puede no coincidir con la
                que tiene la base ahora mismo.
              </p>
            </Callout>
          )}

          {data.progress?.degradations && data.progress.degradations.length > 0 && (
            <Callout tone="warning" title="Garantías que no se pudieron aplicar">
              <ul className="flex list-disc flex-col gap-1 pl-5">
                {data.progress.degradations.map((degradation, index) => (
                  <li key={`${index}:${degradation}`}>{degradation}</li>
                ))}
              </ul>
            </Callout>
          )}

          {data.progress && (
            <WarningList warnings={data.progress.warnings} title="Avisos de la corrida" />
          )}

          <ArtifactPanel wizard={wizard} />
          <ItemsReport wizard={wizard} />

          <div className="flex flex-wrap gap-2">
            {/* Un plan es de un solo uso: para repetir la exportación hay que crear otro. */}
            <Button variant="outline" onClick={wizard.reset}>
              Volver a exportar
            </Button>
          </div>
        </>
      )}

      {job.isError && job.data && (
        <ErrorRecoveryPanel
          error={job.error}
          title="El último refresco del estado falló"
          onStartOver={wizard.reset}
        />
      )}
    </div>
  )
}
