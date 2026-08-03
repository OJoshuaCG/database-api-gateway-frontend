import { AlertIcon, Badge, CodeBlock, CopyIcon, DownloadIcon, IconButton } from '@/components/ui'
import { type QueryErrorOut, type QueryStatementResultOut } from '@/lib/contracts'
import { useToast } from '@/lib/toast/use-toast'
import { cn, downloadBlob, formatDuration, formatInteger } from '@/lib/utils'
import {
  dangerCopy,
  formatCellValue,
  isNullCell,
  safeFilenamePart,
  statementOutcome,
  toCsv,
} from '../logic'

export interface StatementResultCardProps {
  statement: QueryStatementResultOut
  database: string
}

/**
 * Resultado de UNA sentencia del lote.
 *
 * El criterio de color es el del módulo entero: que el motor rechace una sentencia NO es un
 * error rojo —es el resultado de la prueba que el admin vino a hacer— y una sentencia que no
 * llegó a correr tampoco falló. El rojo queda para `policy_miss`, que es un bug del gateway.
 */
export function StatementResultCard({ statement, database }: StatementResultCardProps) {
  const toast = useToast()
  const outcome = statementOutcome(statement)
  const danger = dangerCopy(statement.danger)
  // Un `SELECT` sin filas igual trae columnas: son las columnas las que distinguen "consulta
  // que devuelve datos" de "sentencia que afecta filas". Pero también hay motores/drivers que
  // devuelven filas SIN nombres de columna, y descartarlas en silencio sería perder datos: con
  // filas presentes hay conjunto de resultados aunque `columns` venga vacío.
  const hasResultSet = statement.columns.length > 0 || statement.rows.length > 0

  // Sin nombres de columna se fabrican encabezados posicionales según la fila más ancha, y la
  // tabla y el CSV usan LOS MISMOS: exportar con encabezados distintos a los vistos confundiría.
  const columnsMissing = statement.columns.length === 0 && statement.rows.length > 0
  const columns = columnsMissing
    ? Array.from(
        { length: statement.rows.reduce((max, row) => Math.max(max, row.length), 0) },
        (_, index) => `Columna ${index + 1}`,
      )
    : statement.columns

  // El nombre de la base es eco de un motor ajeno: saneado antes de volverse nombre de archivo.
  const csvFilename = `${safeFilenamePart(database)}-sentencia-${statement.seq + 1}.csv`

  const handleCopyCsv = () => {
    const csv = toCsv(columns, statement.rows)
    // `navigator.clipboard` no existe fuera de un contexto seguro (HTTP sin TLS): se avisa en
    // vez de romper, y siempre queda la descarga como salida.
    if (!navigator.clipboard) {
      toast.error('El portapapeles no está disponible', 'Descargá el CSV en su lugar.')
      return
    }
    void navigator.clipboard
      .writeText(csv)
      .then(() => toast.success('Resultado copiado como CSV'))
      .catch(() => toast.error('No se pudo copiar al portapapeles'))
  }

  const handleDownloadCsv = () => {
    const csv = toCsv(columns, statement.rows)
    // El historial guarda metadatos, nunca filas: exportar es la única forma de conservar un
    // resultado sin volver a ejecutar la consulta. El BOM va SOLO en la descarga: sin él Excel
    // en Windows rompe los acentos, pero en el portapapeles sería basura visible.
    downloadBlob(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }), csvFilename)
  }

  return (
    <section
      className={cn(
        'flex flex-col gap-3 rounded-card border p-4',
        outcome === 'policy-miss' ? 'border-error/40 bg-error/5' : 'border-border bg-surface',
        // No ejecutada: se atenúa para que no compita con lo que sí corrió.
        outcome === 'skipped' && 'opacity-60',
      )}
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-foreground">Sentencia {statement.seq + 1}</span>
        <span className="font-mono text-xs uppercase text-muted-foreground">{statement.kind}</span>
        <Badge tone={danger.tone}>{danger.label}</Badge>
        {outcome === 'skipped' && (
          <Badge tone="neutral">No ejecutada — el lote se detuvo antes</Badge>
        )}
        {statement.truncated && (
          // Un resultado recortado en silencio lleva a conclusiones falsas: se anuncia siempre.
          <Badge tone="warning">
            Recortado — mostrando las primeras {formatInteger(statement.row_count)} filas, hay más
          </Badge>
        )}
      </header>

      {outcome === 'policy-miss' && (
        <div className="flex items-start gap-2 rounded-lg border border-error/30 bg-error/10 p-3">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-error" />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold text-error">
              El gateway clasificó mal esta consulta
            </p>
            <p className="text-sm text-foreground">
              La trató como lectura y en realidad escribe, así que la transacción de solo lectura
              del motor la abortó. Es un fallo del gateway, no de tu consulta — por favor reportala.
            </p>
            {statement.error && <EngineError error={statement.error} />}
          </div>
        </div>
      )}

      {outcome === 'rejected' && (
        // Tono NEUTRO, no rojo: si se estaba probando un permiso, este rechazo es justamente el
        // resultado buscado. El texto del motor va tal cual, sin traducir.
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-muted p-3">
          <p className="text-sm font-medium text-foreground">El motor rechazó esta sentencia</p>
          {statement.error ? (
            <EngineError error={statement.error} />
          ) : (
            <p className="text-sm text-muted-foreground">
              El motor no devolvió detalle del rechazo.
            </p>
          )}
        </div>
      )}

      {outcome === 'ok' && hasResultSet && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {formatInteger(statement.row_count)} fila(s) · {formatDuration(statement.duration_ms)}
            </span>
            <span className="ml-auto flex items-center gap-1">
              <IconButton
                label="Copiar como CSV"
                icon={<CopyIcon />}
                onClick={handleCopyCsv}
                disabled={statement.rows.length === 0}
              />
              <IconButton
                label="Descargar CSV"
                icon={<DownloadIcon />}
                onClick={handleDownloadCsv}
                disabled={statement.rows.length === 0}
              />
            </span>
          </div>

          {columnsMissing && (
            <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-foreground">
              El motor no informó los nombres de columna: los encabezados «Columna N» son
              posicionales, no los reales. El CSV exportado usa estos mismos encabezados.
            </p>
          )}

          {statement.rows.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface-muted p-3 text-sm text-muted-foreground">
              La consulta se ejecutó y no devolvió ninguna fila.
            </p>
          ) : (
            <div className="max-h-96 overflow-auto rounded-lg border border-border">
              <table className="w-full min-w-max border-collapse text-left text-xs">
                <thead>
                  <tr>
                    {columns.map((column, index) => (
                      // `sticky`: en un resultado largo, perder los nombres de columna al
                      // desplazarse obliga a leer las celdas a ciegas.
                      <th
                        key={index}
                        scope="col"
                        className="sticky top-0 z-10 whitespace-nowrap border-b border-border bg-surface-muted px-3 py-2 font-mono font-semibold text-foreground"
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {statement.rows.map((row, rowIndex) => (
                    // Las filas del motor no tienen identidad estable: la posición es la clave.
                    <tr key={rowIndex} className="border-b border-border last:border-b-0">
                      {row.map((cell, cellIndex) => (
                        <td
                          key={cellIndex}
                          className={cn(
                            'whitespace-pre px-3 py-1.5 font-mono text-foreground',
                            isNullCell(cell) && 'italic text-muted-foreground',
                          )}
                        >
                          {formatCellValue(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {outcome === 'ok' && !hasResultSet && (
        <p className="text-sm text-foreground">
          {statement.rows_affected == null
            ? 'Sin filas afectadas informadas'
            : `${formatInteger(statement.rows_affected)} fila(s) afectada(s)`}{' '}
          · <span className="text-muted-foreground">{formatDuration(statement.duration_ms)}</span>
        </p>
      )}

      {/* Siempre el SQL REALMENTE ejecutado: a un `SELECT` sin LIMIT propio el gateway le empuja
          uno, así que puede no coincidir con lo que se escribió en el editor. */}
      <CodeBlock
        code={statement.sql}
        title="SQL ejecutado"
        maxHeightClass="max-h-40"
        hideLineNumbers
      />
    </section>
  )
}

/** Error NATIVO del motor: se muestra tal cual, sin traducir, porque ese texto es el resultado. */
function EngineError({ error }: { error: QueryErrorOut }) {
  const code = error.code ?? error.sqlstate
  return (
    <div className="flex flex-col gap-1">
      {code && (
        <p className="font-mono text-xs text-muted-foreground">
          {error.code && <span>Código {error.code}</span>}
          {error.code && error.sqlstate && <span> · </span>}
          {error.sqlstate && <span>SQLSTATE {error.sqlstate}</span>}
        </p>
      )}
      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-muted p-3 font-mono text-xs text-foreground">
        {error.message}
      </pre>
    </div>
  )
}
