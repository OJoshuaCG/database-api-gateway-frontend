import { useState } from 'react'
import { Button, Input, Spinner, Switch } from '@/components/ui'
import { CharsetCollationSelector } from '@/features/charset-collation-options'
import type { CharsetCollationValue } from '@/features/charset-collation-options'
import { ApiError } from '@/lib/api/errors'
import type { CollationBatchCreate } from '@/lib/contracts'
import { collationMessage } from '../messages'

/**
 * Paso 1 del lote: elegir el objetivo y planificar.
 *
 * Planificar **toca el motor una vez por base** (crea y previsualiza un job por cada una), de ahí
 * el 🔌 y el rate limit de 10/min. No cambia nada todavía: deja N planes `pending` con su TTL.
 *
 * El objetivo se elige con el selector del catálogo (`CharsetCollationSelector`) y no con dos
 * campos de texto libres: el backend valida contra ese mismo catálogo, así que escribir a mano
 * solo habilita 422 evitables.
 *
 * Se fija la familia `mysql` porque el SQL del lote es de MySQL/MariaDB. Las bases PostgreSQL del
 * blueprint **no abortan el lote**: salen como ítem con `collation.engine_not_applicable`, y así
 * se muestran en el paso siguiente.
 */
export function BatchPlanStep({
  modelSlug,
  isPlanning,
  planError,
  onPlan,
}: {
  modelSlug: string | null
  isPlanning: boolean
  planError: unknown
  onPlan: (body: CollationBatchCreate) => void
}) {
  const [target, setTarget] = useState<CharsetCollationValue | null | undefined>(undefined)
  const [includeDatabaseDefault, setIncludeDatabaseDefault] = useState(true)
  const [convertObjects, setConvertObjects] = useState(true)
  const [maxDatabases, setMaxDatabases] = useState('10')

  const maxParsed = Number(maxDatabases)
  const maxValid = Number.isInteger(maxParsed) && maxParsed >= 1 && maxParsed <= 100
  // `collation` es lo único obligatorio: el charset puede quedar en el default del motor.
  const canPlan = !!target?.collation && maxValid && !isPlanning

  const apiError = planError instanceof ApiError ? planError : null
  const codeMessage = collationMessage(apiError?.code)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">
          Convertir todas las bases del blueprint
        </h2>
        <p className="text-sm text-muted-foreground">
          Se planifica <strong>una conversión real por base activa</strong>, cada una leyendo su
          propio inventario. No es una migración de blueprint: una versión estática no puede
          recrear los objetos de cada base con su collation congelada, y aplicarla dejaría las
          vistas y rutinas en la collation vieja — exactamente el <em>Illegal mix of collations</em>{' '}
          que esta herramienta existe para evitar.
        </p>
      </div>

      <CharsetCollationSelector
        engineFamily="mysql"
        value={target}
        onChange={setTarget}
        label="Charset y collation objetivo"
        hint="Se aplica a la base, sus tablas y columnas, y a los objetos programables que se recreen."
        disabled={isPlanning}
      />

      <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
        <Switch
          checked={includeDatabaseDefault}
          onCheckedChange={setIncludeDatabaseDefault}
          disabled={isPlanning}
          label="Cambiar también el default de cada base"
          hint="ALTER DATABASE: sin esto, las tablas nuevas seguirían naciendo con la collation vieja."
        />

        <Switch
          checked={convertObjects}
          onCheckedChange={setConvertObjects}
          disabled={isPlanning}
          label="Recrear los objetos programables"
          hint="Vistas, procedimientos, funciones, triggers y eventos guardan la collation con la que se crearon. Sin recrearlos quedan congelados en la vieja, que es el problema que esta herramienta ataca."
        />

        {!convertObjects && (
          <p className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
            Sin recrear los objetos, las tablas quedan convertidas y las vistas y rutinas no. Es la
            combinación que produce el <em>Illegal mix of collations</em>. El plan va a avisarlo por
            cada base.
          </p>
        )}

        <Input
          label="Máximo de bases"
          type="number"
          min={1}
          max={100}
          value={maxDatabases}
          onChange={(event) => setMaxDatabases(event.target.value)}
          disabled={isPlanning}
          error={maxValid ? undefined : 'Un número entre 1 y 100'}
          hint="Tope de seguridad. Si el blueprint tiene más bases activas, el plan lo avisa y no las convierte en silencio."
        />
      </div>

      {(codeMessage ?? apiError) && (
        <div className="rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error">
          {codeMessage ?? apiError?.message}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button
          onClick={() =>
            onPlan({
              target_charset: target?.charset ?? null,
              target_collation: target?.collation ?? '',
              scope: 'all_tables',
              tables: [],
              objects: convertObjects ? 'all' : 'none',
              include_database_default: includeDatabaseDefault,
              environment_id: null,
              max_databases: maxParsed,
            })
          }
          disabled={!canPlan}
        >
          {isPlanning && <Spinner />}
          Planificar el lote 🔌
        </Button>
        {modelSlug && (
          <span className="text-sm text-muted-foreground">
            Blueprint <span className="font-mono">{modelSlug}</span>
          </span>
        )}
      </div>
    </div>
  )
}
