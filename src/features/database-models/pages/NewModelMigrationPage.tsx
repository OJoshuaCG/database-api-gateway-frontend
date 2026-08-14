import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button, Card, CardContent, ErrorState, FullPageSpinner, PageHeader } from '@/components/ui'
import type { ModelMigrationOut } from '@/lib/contracts'
import { useDatabaseModel } from '../hooks/use-database-models'
import { useCreateModelMigration, useUpdateModelMigration } from '../hooks/use-model-migrations'
import {
  ModelMigrationForm,
  toCreate,
  type ModelMigrationFormValues,
} from '../components/ModelMigrationForm'
import { MigrationSqlView } from '../components/MigrationSqlView'

/**
 * Alta de una versión (delta SQL) de un blueprint. No toca ningún motor.
 *
 * Era un modal, pero el formulario lo protagoniza un editor de SQL que necesita alto y ancho, y
 * al crear muestra además la traducción a los dos motores: demasiado para un diálogo. Como
 * página hereda la anchura completa, y el paso posterior a la creación deja de competir por
 * espacio con el propio formulario.
 *
 * El retorno es un enlace explícito y no historial del navegador, como en el resto de la app:
 * a esta ruta se puede llegar por enlace directo o tras recargar, y ahí `atrás` no tendría a
 * dónde volver.
 */
export function NewModelMigrationPage() {
  const params = useParams()
  const modelId = Number(params.modelId)
  const navigate = useNavigate()

  const model = useDatabaseModel(modelId)
  const create = useCreateModelMigration(modelId)
  const update = useUpdateModelMigration(modelId)
  const [created, setCreated] = useState<ModelMigrationOut | null>(null)

  const backTo = `/database-models/${modelId}/migrations`

  if (!Number.isFinite(modelId) || modelId <= 0) {
    return <ErrorState error={new Error('Identificador de blueprint inválido.')} />
  }
  if (model.isLoading) return <FullPageSpinner label="Cargando blueprint" />
  if (model.isError || !model.data) {
    return <ErrorState error={model.error} onRetry={() => void model.refetch()} />
  }

  const submit = (values: ModelMigrationFormValues) => {
    create.mutate(toCreate(values), { onSuccess: (migration) => setCreated(migration) })
  }

  // Tras crear, el backend sugiere un rollback pero no lo da por bueno: confirmarlo es una
  // decisión explícita del admin, y sin él el rollback responde 409.
  const canConfirmSuggested = created !== null && !created.down_sql && created.down_sql_suggested

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link to={backTo} className="text-sm text-muted-foreground hover:text-foreground">
          ← Versiones de {model.data.name}
        </Link>
        <PageHeader
          title={created ? `Versión ${created.version} creada` : 'Nueva versión'}
          description={
            created
              ? 'Revisa la traducción por motor y confirma el rollback antes de aplicarla.'
              : 'Define un delta SQL versionado para el blueprint. No toca ningún motor.'
          }
        />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4">
          {created ? (
            <>
              {created.capture_selects && created.reviewed === false && (
                <p className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs text-foreground">
                  ⚠️ Esta versión activa la <strong>captura de resultados de SELECT</strong> y nace
                  <strong> sin revisar</strong>: no podrá aplicarse ni revertirse hasta que la
                  apruebes desde la pantalla de versiones («Revisar y aprobar»).
                </p>
              )}
              <MigrationSqlView migration={created} />
              <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
                {canConfirmSuggested && (
                  <Button
                    variant="outline"
                    isLoading={update.isPending}
                    onClick={() =>
                      update.mutate(
                        {
                          version: created.version,
                          body: { down_sql: created.down_sql_suggested },
                        },
                        { onSuccess: (migration) => setCreated(migration) },
                      )
                    }
                  >
                    Confirmar rollback sugerido
                  </Button>
                )}
                <Button onClick={() => void navigate(backTo)}>Volver a las versiones</Button>
              </div>
            </>
          ) : (
            <ModelMigrationForm
              mode="create"
              isSubmitting={create.isPending}
              onSubmit={submit}
              onCancel={() => void navigate(backTo)}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
