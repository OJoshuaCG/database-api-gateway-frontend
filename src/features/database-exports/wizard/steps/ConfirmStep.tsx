import { Badge, Button, EmptyState, Input, Spinner } from '@/components/ui'
import { engineLabel, formatBytes, formatInteger } from '@/lib/utils'
import { Callout, PlainDataNotice, WarningList } from '../../components/Callout'
import { readSpecValue } from '../../logic'
import { ErrorRecoveryPanel } from '../ErrorRecoveryPanel'
import type { DatabaseExportWizard } from '../use-database-export-wizard'

/**
 * Paso 4 — Confirmar. Es el último punto donde el usuario puede decidir, así que **acá no se esconde
 * nada**: los avisos van todos, la lista de objetos va entera y en su orden, y la banda de extracción
 * en claro es permanente en vez de un tooltip que se descubre por accidente.
 */

const CONFIRM_SCOPE_DROP_PATH = 'structure.confirm_scope_drop'

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  )
}

export function ConfirmStep({ wizard }: { wizard: DatabaseExportWizard }) {
  const preview = wizard.confirmPreview
  const spec = wizard.spec

  // El campo del `DROP DATABASE` se exige en el paso de opciones; acá solo se comprueba que no quedó
  // vacío, porque desde esta pantalla no se vuelve a pedir un dato que ya tiene su sitio.
  const scopeDropRequired =
    wizard.evaluation?.constraints.get(CONFIRM_SCOPE_DROP_PATH)?.required === true
  const scopeDropValue = spec ? readSpecValue(spec, CONFIRM_SCOPE_DROP_PATH) : null
  const scopeDropMissing =
    scopeDropRequired && (typeof scopeDropValue !== 'string' || scopeDropValue.trim().length === 0)

  const nonDeterministic = preview?.objects.filter((object) => !object.deterministic) ?? []

  return (
    <div className="flex flex-col gap-5">
      {/* Banda permanente: el módulo no enmascara nada, y eso tiene que leerse ANTES de decidir. */}
      <PlainDataNotice />

      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">Revisá y confirmá</h2>
        <p className="text-sm text-muted-foreground">
          Al exportar, el gateway congela esta selección y encola el job. El plan es de un solo uso.
        </p>
      </div>

      {wizard.pendingReview != null && (
        <Callout tone="warning" title="El plan cambió desde que lo revisaste">
          <p>
            El catálogo se movió entre tu confirmación y la emisión del permiso de ejecución, así
            que el plan de abajo <strong>no es el que acabás de leer</strong>: es el nuevo. La
            exportación está parada a propósito.
          </p>
          <p>
            Revisá los objetos y los avisos otra vez. Ejecutar sin que lo mires sería hacerte
            confirmar algo que nunca viste.
          </p>
        </Callout>
      )}

      {preview == null ? (
        wizard.dryRun.isLoading || wizard.dryRun.isFetching ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Spinner /> Calculando el plan de exportación…
          </div>
        ) : (
          <EmptyState
            title="Todavía no hay un plan que revisar"
            description="Volvé al paso de opciones para que el gateway calcule las consecuencias de esta configuración."
            action={
              <Button variant="outline" onClick={() => wizard.goToStep('options')}>
                Volver a las opciones
              </Button>
            }
          />
        )
      ) : (
        <>
          <dl className="grid gap-2 rounded-card border border-border p-4 text-sm sm:grid-cols-2">
            <SummaryRow label="Motor" value={engineLabel(preview.engine)} />
            <SummaryRow label="Base de datos" value={preview.database} />
            <SummaryRow label="Formato" value={preview.format} />
            <SummaryRow
              label="Tablas con datos"
              value={formatInteger(preview.data_tables.length)}
            />
            <SummaryRow
              label="Filas estimadas"
              value={`~${formatInteger(preview.estimated_rows)}`}
            />
            <SummaryRow
              label="Tamaño estimado"
              value={`≈ ${formatBytes(preview.estimated_bytes)}`}
            />
          </dl>

          {preview.scope_note && (
            <Callout tone="info" title="Alcance del volcado">
              <p>{preview.scope_note}</p>
            </Callout>
          )}

          {/* Todos los avisos, no solo el primero: ahí vive el de consistencia asimétrica de
              MySQL/MariaDB (el punto único cubre los DATOS, no la ESTRUCTURA), las tablas sin PK y
              los `where` definidos para tablas que no están en la selección de datos. Esconder
              cualquiera de esos sería el peor bug de esta pantalla. */}
          <WarningList warnings={preview.warnings} title="Avisos de esta exportación" />

          {/* Varias reglas de la matriz comparten `code` (todas usan `export.incompatible_option`),
              así que la key necesita el índice para no duplicarse. */}
          {preview.advisories.map((advisory, index) => (
            <Callout
              key={`${index}:${advisory.code}`}
              tone="warning"
              title="Aviso de compatibilidad"
            >
              <p>{advisory.reason}</p>
            </Callout>
          ))}

          <section className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Objetos, en el orden en que van a salir
              </h3>
              {nonDeterministic.length > 0 && (
                <Badge tone="warning">
                  {nonDeterministic.length === 1
                    ? '1 tabla sin orden garantizado'
                    : `${formatInteger(nonDeterministic.length)} tablas sin orden garantizado`}
                </Badge>
              )}
            </div>
            {/*
              La lista se renderiza EXACTAMENTE en el orden en que llega. `step` es la fuente de
              verdad del orden de emisión y `phase` solo una etiqueta legible: el orden es una
              garantía del backend, no un detalle de presentación, así que no se reordena ni
              alfabéticamente ni por tipo. Por lo mismo no se usa `DataTable`, que ordena y filtra en
              cliente: aquí eso destruiría la única información que la lista transporta.
            */}
            <div className="overflow-x-auto rounded-card border border-border">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-3 py-2 font-semibold">#</th>
                    <th className="px-3 py-2 font-semibold">Fase</th>
                    <th className="px-3 py-2 font-semibold">Tipo</th>
                    <th className="px-3 py-2 font-semibold">Nombre</th>
                    <th className="px-3 py-2 font-semibold">Datos</th>
                    <th className="px-3 py-2 font-semibold">Filas</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.objects.map((object) => (
                    <tr
                      key={`${object.seq}:${object.object_type}:${object.name}`}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-3 py-2 text-muted-foreground">{object.seq}</td>
                      <td className="px-3 py-2 text-muted-foreground">{object.phase}</td>
                      <td className="px-3 py-2 text-muted-foreground">{object.object_type}</td>
                      <td className="px-3 py-2">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-foreground">{object.name}</span>
                          {!object.deterministic && (
                            <Badge tone="warning">⚠ sin orden garantizado</Badge>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {object.with_data ? 'Sí' : '—'}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {object.estimated_rows == null
                          ? '—'
                          : `~${formatInteger(object.estimated_rows)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {nonDeterministic.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Las tablas marcadas salen sin orden garantizado (no tienen clave primaria ni una
                tupla de columnas por la que ordenar): dos exportaciones seguidas pueden emitir sus
                filas en distinto orden.
              </p>
            )}
          </section>

          {preview.excluded_by_dependency.length > 0 && (
            <Callout tone="info" title="Objetos podados por dependencias">
              <ul className="flex list-disc flex-col gap-1 pl-5">
                {preview.excluded_by_dependency.map((ref) => (
                  <li key={`${ref.object_type}:${ref.name}`}>
                    {ref.object_type} · {ref.name}
                  </li>
                ))}
              </ul>
            </Callout>
          )}
        </>
      )}

      {scopeDropMissing && (
        <Callout
          tone="danger"
          title="Falta confirmar el DROP DATABASE"
          action={
            <Button variant="outline" onClick={() => wizard.goToStep('options')}>
              Volver a las opciones
            </Button>
          }
        >
          <p>
            El DDL de la base está en «DROP + CREATE», así que el artefacto va a contener un{' '}
            <code>DROP DATABASE</code>. Hay que teclear el nombre real de la base en el paso de
            opciones antes de poder exportar.
          </p>
        </Callout>
      )}

      <div className="flex flex-col gap-3 rounded-card border border-error/40 bg-error/5 p-4">
        <p className="text-sm font-semibold text-foreground">Confirmación de doble factor 🔌</p>
        <Input
          label={`Escribí «${wizard.database}» para confirmar`}
          value={wizard.confirmTargetName}
          onChange={(event) => wizard.setConfirmTargetName(event.target.value)}
          placeholder={wizard.database}
          autoComplete="off"
          required
          hint={
            wizard.nameMatches
              ? 'Coincide con la base de datos de origen.'
              : 'Todavía no coincide con el nombre de la base.'
          }
        />
        <p className="text-xs text-muted-foreground">
          {wizard.nameMatches
            ? '✅ El nombre coincide.'
            : '⌨ Nunca viene prerrellenado a propósito.'}
        </p>

        {wizard.hasBlockingViolations && (
          <Callout tone="danger" title="Hay opciones incompatibles sin resolver">
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {wizard.evaluation?.violations.map((violation) => (
                <li key={`${violation.rule.code}:${violation.kind}`}>{violation.rule.reason}</li>
              ))}
            </ul>
          </Callout>
        )}

        {wizard.actionCooldown && (
          <p className="text-sm text-muted-foreground">
            Hay que esperar un momento: el gateway limita estas acciones y el último intento agotó
            una ficha. No es un error de configuración — el mismo plan sirve dentro de unos
            segundos.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="danger"
            disabled={wizard.submitDisabled}
            isLoading={wizard.preview.isPending || wizard.execute.isPending}
            onClick={wizard.submitExport}
          >
            Exportar 🔌
          </Button>

          {/* Segundo botón EXPLÍCITO: el preview autoritativo devolvió algo distinto y la ejecución
              está parada. No se dispara sola — el usuario confirmó un plan concreto, no un cheque en
              blanco. */}
          {wizard.pendingReview != null && (
            <Button
              variant="danger"
              disabled={!wizard.nameMatches || wizard.actionCooldown}
              isLoading={wizard.execute.isPending}
              onClick={wizard.confirmAfterReview}
            >
              Revisado, exportar 🔌
            </Button>
          )}
        </div>
      </div>

      {wizard.preview.isError && (
        <ErrorRecoveryPanel
          error={wizard.preview.error}
          title="No se pudo confirmar la exportación"
          onStartOver={wizard.reset}
          onAddToStructure={wizard.adoptDataTablesIntoStructure}
          onResolveDependencies={wizard.resolveMissingDependencies}
          onSwitchToFileDelivery={wizard.switchToFileDelivery}
        />
      )}

      {/* El 409 `export.fingerprint_changed` se recupera volviendo a previsualizar, NUNCA con un
          reintento automático: el token viejo describe un catálogo que ya no existe. */}
      {wizard.execute.isError && (
        <ErrorRecoveryPanel
          error={wizard.execute.error}
          title="No se pudo ejecutar la exportación"
          onRepreview={wizard.submitExport}
          onStartOver={wizard.reset}
        />
      )}
    </div>
  )
}
