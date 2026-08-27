import { useNavigate } from 'react-router-dom'
import { Badge, EmptyState, ErrorState, RadioCardGroup, Spinner } from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import { engineLabel } from '@/lib/utils'
import type { ExportFormatCapability } from '@/lib/contracts'
import { Callout } from '@/components/ui'
import { PlainDataNotice } from '../../components/Callout'
import { ErrorRecoveryPanel } from '../ErrorRecoveryPanel'
import type { DatabaseExportWizard } from '../use-database-export-wizard'

/**
 * Qué transporta un formato, derivado de SUS banderas y nunca de su nombre. Un `if (format ===
 * 'csv')` acá sería un duplicado de la matriz del backend: si mañana aparece `parquet`, esta función
 * lo describe bien sin que nadie la toque.
 */
function formatTransportLabel(format: ExportFormatCapability): string {
  const parts: string[] = []
  if (format.supports_structure === true) parts.push('estructura y datos')
  else if (format.supports_structure === 'manifest_only')
    parts.push('datos; la estructura solo figura en el manifiesto')
  else parts.push('solo datos')
  if (format.one_file_per_table) parts.push('un archivo por tabla')
  return parts.join(' · ')
}

/** Fila de datos de solo lectura: el contexto no se elige, se muestra. */
function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-sm text-foreground">{value}</span>
    </div>
  )
}

/**
 * Paso 1 — **Origen y formato**. El servidor y la base NO se eligen acá: llegan del contexto de la
 * pantalla desde la que se abrió el asistente, así que se presentan como datos. Lo único que se
 * decide es el formato, y se decide primero porque es lo que determina qué opciones existen después
 * (la matriz de compatibilidad cuelga de él).
 */
export function OriginStep({ wizard }: { wizard: DatabaseExportWizard }) {
  const navigate = useNavigate()
  const { capabilities } = wizard
  const data = capabilities.data ?? null

  if (capabilities.isLoading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Spinner /> Consultando las capacidades de exportación…
      </div>
    )
  }

  if (capabilities.isError && !data) {
    const apiError = toApiError(capabilities.error)
    /**
     * `export.disabled` y `export.scope_not_allowed` no son fallos: son decisiones de configuración
     * del gateway. Pintarlas como error rojo invita a reintentar algo que nunca va a funcionar, así
     * que se explican como estado vacío.
     */
    if (apiError.code === 'export.disabled') {
      return (
        <EmptyState
          title="La exportación está deshabilitada en este gateway"
          description="El módulo está apagado en la configuración. Ver un job en curso y cancelarlo sigue funcionando, pero no se pueden crear planes nuevos."
        />
      )
    }
    if (apiError.code === 'export.scope_not_allowed') {
      return (
        <EmptyState
          title="No se puede exportar la propia base de metadatos del gateway"
          description="El destino es la base con la que el gateway se administra a sí mismo y queda fuera de alcance."
        />
      )
    }
    return (
      <ErrorState
        error={capabilities.error}
        title="No se pudieron cargar las capacidades de exportación"
      />
    )
  }

  if (!data) return null

  const selectedFormat = data.formats.find((format) => format.name === wizard.spec?.format) ?? null
  const formatOptions = data.formats.map((format) => ({
    value: format.name,
    label: format.name.toUpperCase(),
    hint: formatTransportLabel(format),
  }))

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">Origen y formato</h2>
        <p className="text-sm text-muted-foreground">
          Volcado configurable de la estructura y/o los datos de esta base. Elegí el formato: es lo
          que determina qué opciones tienen sentido en los pasos siguientes.
        </p>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Qué se exporta
        </p>
        <DataRow label="Servidor" value={`#${wizard.serverId}`} />
        <DataRow label="Base de datos" value={wizard.database} />
        <DataRow label="Motor" value={`${engineLabel(data.engine)} ${data.engine_version}`} />
        <DataRow label={data.scope.kind} value={data.scope.name} />
      </div>

      {/* El texto del backend se muestra tal cual: explica una limitación del motor (en PostgreSQL,
          que solo se cubre el schema `public`) y reescribirlo es arriesgarse a cambiarle el sentido. */}
      {data.scope.scope_note && (
        <Callout tone="info" title="Alcance del volcado">
          <p>{data.scope.scope_note}</p>
        </Callout>
      )}

      <RadioCardGroup<string>
        title="Formato"
        description="Cada formato transporta cosas distintas; lo que dice cada tarjeta sale de las capacidades que declara el gateway."
        options={formatOptions}
        value={wizard.spec?.format ?? null}
        onChange={wizard.setFormat}
        columns={2}
      />

      {/* Deriva de las banderas del formato, no de su nombre: cualquier formato que no transporte
          estructura apaga las opciones de estructura, hoy y cuando aparezca uno nuevo. */}
      {selectedFormat && selectedFormat.supports_structure !== true && (
        <Callout tone="warning" title="Este formato no transporta la estructura">
          <p>
            Al elegir <Badge tone="neutral">{selectedFormat.name.toUpperCase()}</Badge> las opciones
            de estructura (DDL de la base y de los objetos) se apagan y el artefacto sale{' '}
            {selectedFormat.supports_structure === 'manifest_only'
              ? 'solo con los datos; los objetos figuran únicamente en el manifiesto.'
              : 'solo con los datos.'}
          </p>
        </Callout>
      )}

      <PlainDataNotice />

      {wizard.createPlan.isError && (
        <ErrorRecoveryPanel
          error={wizard.createPlan.error}
          title="No se pudo crear el plan de exportación"
          onStartOver={wizard.reset}
          // La `idempotency_key` reutilizada con otro spec devuelve el id del plan original: llevarlo
          // ahí es lo único útil que se puede ofrecer, porque ese plan ya existe y sigue siendo válido.
          onGoToOriginalPlan={(jobId) => navigate({ search: `?jobId=${jobId}` })}
        />
      )}
    </div>
  )
}
