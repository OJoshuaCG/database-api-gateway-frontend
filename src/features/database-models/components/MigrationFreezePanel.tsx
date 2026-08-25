import { Button } from '@/components/ui'
import { BlockingDatabasesList } from './BlockingDatabasesList'

interface MigrationFreezePanelProps {
  modelId: number
  version: string
  /**
   * Filas del `public_context.blocking_databases` del 409. `reason` va como `string` porque llega
   * de `ApiError`, que no depende de `lib/contracts`; `BlockingDatabasesList` acepta la misma
   * forma ancha.
   */
  blockingDatabases: { managed_database_id: number; reason: string; current_version?: string }[]
  /**
   * `public_context.override_available` del 409. Se compara con `=== true`: si llega ausente o
   * `false` —un backend anterior a la v15— la segunda salida **no se renderiza**. Asumirla
   * disponible ofrecería un camino que el backend va a rechazar.
   */
  overrideAvailable: boolean
  requestId?: string
  /** Salida 1, recomendada: crear una versión correctiva al final de la cadena. */
  onFixForward: () => void
  /** Salida 2: abre el PASO 1 del flujo de dos pasos. No ejecuta nada por sí sola. */
  onOverride: () => void
  isPreviewing: boolean
  errorText?: string | null
}

/**
 * El 409 `model_migration.sql_frozen`, con sus dos salidas (api-reference-v15 §4).
 *
 * Se pinta **inline, debajo del formulario**, y no en un modal encima: el borrador con el SQL
 * tiene que seguir a la vista y, sobre todo, seguir montado. Ese es el requisito duro de toda la
 * pantalla.
 *
 * Las dos salidas **no tienen el mismo peso visual**: fix-forward es el botón primario y la vía
 * de excepción es secundaria. Dos botones iguales convertirían una decisión en un menú.
 *
 * La palabra «Forzar» no aparece, y no es cosmética: la etiqueta nombra la **consecuencia**
 * («asumiendo divergencia»), no la transgresión. Un «Forzar» invita a pulsarlo para quitarse de
 * encima un obstáculo; esto obliga a leer qué se está aceptando.
 */
export function MigrationFreezePanel({
  modelId,
  version,
  blockingDatabases,
  overrideAvailable,
  requestId,
  onFixForward,
  onOverride,
  isPreviewing,
  errorText,
}: MigrationFreezePanelProps) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-warning/50 bg-warning/5 p-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-foreground">
          No se puede guardar el SQL de esta versión
        </p>
        <p className="text-sm text-muted-foreground">
          {blockingDatabases.length} base(s) de datos están en la versión {version} o en una
          posterior. Editar el SQL no cambia nada en esas bases: conservan el esquema que ya se les
          aplicó.
        </p>
      </div>

      <BlockingDatabasesList
        modelId={modelId}
        rows={blockingDatabases}
        requestId={requestId}
      />

      {errorText && (
        <p
          role="alert"
          className="rounded-lg border border-error/40 bg-error/5 p-3 text-sm text-error"
        >
          {errorText}
        </p>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
          <span className="text-sm font-medium text-foreground">
            Crear versión correctiva (recomendado)
          </span>
          <p className="text-xs text-muted-foreground">
            Se crea una versión nueva al final de la cadena con tu corrección. Las bases existentes
            se corrigen aplicándola; ninguna queda divergente.
          </p>
          <div>
            <Button size="sm" onClick={onFixForward}>
              Crear versión correctiva
            </Button>
          </div>
        </div>

        {overrideAvailable && (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <span className="text-sm font-medium text-foreground">
              Editar igual, asumiendo divergencia
            </span>
            <p className="text-xs text-muted-foreground">
              Úsalo cuando el defecto está en el DDL de creación y una versión correctiva al final
              obligaría a cada base nueva a crearse mal y convertirse después (caso típico: un
              COLLATE hardcodeado). Requiere una confirmación explícita y queda registrado de forma
              permanente.
            </p>
            <div>
              <Button variant="outline" size="sm" isLoading={isPreviewing} onClick={onOverride}>
                Editar igual…
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
