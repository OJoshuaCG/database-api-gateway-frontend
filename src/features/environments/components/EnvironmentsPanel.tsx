import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EnvironmentBadge,
  ErrorState,
  Spinner,
} from '@/components/ui'
import { CapabilityHint, useCapabilityGuard, useStepUp } from '@/features/auth'
import { toApiError } from '@/lib/api/errors'
import { CAPABILITIES, type EnvironmentOut } from '@/lib/contracts'
import { ENVIRONMENTS_WRITE_UNBLOCK, environmentMessage } from '../messages'
import { useEnvironmentOptions } from '../hooks/use-environment-options'
import { useUpdateEnvironment } from '../hooks/use-update-environment'

/**
 * Catálogo de entornos. Es de lectura salvo por UNA escritura: la puerta de agentes
 * (`allows_agent_access`) de cada entorno, con `environments.write` + step-up. El resto de la
 * política (nombre, color, migraciones destructivas) se sigue administrando por API.
 *
 * Encender la puerta pide reescribir el slug del entorno (`confirm_slug` en el backend) porque
 * debilita su política; apagarla no pide nada, porque cerrar es el camino seguro. Y encenderla
 * NO abre ninguna base: cada una necesita su propio opt-in desde su fila o su ficha.
 *
 * Por qué existe aunque no haya CRUD: un badge de entorno *sin su política* deja la barrera
 * etiquetada e igual de invisible — `production` pasaría a ser un color, y el operador inferiría
 * que `staging` también protege (**no protege**: solo `production` trae el flag encendido). Esta
 * tabla de 4 filas responde "¿qué bloquea cada entorno?" de una vez, sin una sola mutación.
 *
 * Va como pestaña de Administración porque la app **ya entrenó** al operador a buscar los
 * catálogos globales ahí (privilegios y charsets/collations fueron absorbidos como pestañas):
 * dejar Entornos afuera no sería "menos superficie", sería un hueco donde ya aprendió a mirar.
 *
 * REGLA: nada de esto hardcodea "production bloquea". Todo el texto sale del flag, porque la
 * política se cambia por API sin desplegar y una UI que la asume seguiría prometiendo protección
 * después de que alguien la apague.
 */
export function EnvironmentsPanel() {
  const environments = useEnvironmentOptions()
  // Entorno cuya puerta se está por ENCENDER y espera la confirmación por slug.
  const [confirming, setConfirming] = useState<EnvironmentOut | null>(null)
  const guard = useCapabilityGuard(
    CAPABILITIES.environmentsWrite,
    'cambiar el acceso de agentes de un entorno',
  )
  const update = useUpdateEnvironment()
  const stepUp = useStepUp()

  const setAgentAccess = (env: EnvironmentOut, allow: boolean, confirmSlug?: string) => {
    stepUp.withFresh(CAPABILITIES.environmentsWrite, () =>
      update.mutate(
        { id: env.id, body: { allows_agent_access: allow }, confirmSlug },
        { onSuccess: () => setConfirming(null) },
      ),
    )
  }

  // Si el backend rechaza la confirmación, se muestra su slug esperado y qué se debilita.
  const confirmError = confirming && update.isError ? toApiError(update.error) : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Entornos de despliegue</CardTitle>
        <CardDescription>
          Clasifican cada base gestionada y definen qué se puede aplicar sobre ella. Es un conjunto
          fijo: se administra por API a propósito; desde acá solo se abre o cierra el acceso de
          agentes. Ojo, esto no tiene nada que ver con el <code>APP_ENV</code> del propio gateway
          que muestra <code>/health</code>.
        </CardDescription>
        {/* Quién escribe y cómo desbloquearlo: la API los pide a `environments.write`. */}
        <p className="text-sm text-muted-foreground">{ENVIRONMENTS_WRITE_UNBLOCK}</p>
        <CapabilityHint guard={guard} />
      </CardHeader>
      <CardContent>
        {environments.isLoading && <Spinner />}
        {environments.isError && (
          <ErrorState
            error={environments.error}
            title="No se pudo cargar el catálogo de entornos"
            onRetry={() => void environments.refetch()}
          />
        )}
        {environments.data && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Entorno</th>
                  <th className="pb-2 pr-4 font-medium">Política aplicada</th>
                  <th className="pb-2 pr-4 font-medium">BDs asignadas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {environments.data.map((env) => (
                  <tr key={env.id}>
                    <td className="py-2 pr-4">
                      <span className="flex flex-wrap items-center gap-2">
                        <EnvironmentBadge
                          state={{
                            kind: 'assigned',
                            name: env.name,
                            color: env.color,
                            blocksDestructive: env.blocks_destructive_migrations,
                          }}
                        />
                        <code className="text-xs text-muted-foreground">{env.slug}</code>
                        {env.is_default && <Badge tone="info">por defecto</Badge>}
                        {!env.is_active && <Badge tone="neutral">inactivo</Badge>}
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      <span className="flex flex-col gap-1">
                        {env.blocks_destructive_migrations ? (
                          <span className="text-warning">
                            Bloquea migraciones destructivas (DROP / TRUNCATE / DELETE sin WHERE /
                            ALTER DROP COLUMN)
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Sin restricciones</span>
                        )}
                        {/*
                          Se muestra SIEMPRE, encendido o apagado, y no solo cuando está abierto:
                          es una superficie de lectura sobre bases de terceros, y «no dice nada»
                          se lee igual que «está cerrado». Que el estado sea explícito es la mitad
                          del valor de la fila.

                          Y se describe como condición PARCIAL a propósito: el flag del entorno es
                          una de las cinco del gate de agentes. Presentarlo como «los agentes
                          acceden» prometería un acceso que igual puede no existir, porque cada
                          base necesita además su propio opt-in.
                        */}
                        {env.allows_agent_access ? (
                          <span className="text-warning">
                            Permite acceso de agentes (falta además el opt-in de cada base)
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            Cerrado a agentes: ninguna de sus bases es alcanzable por un token
                          </span>
                        )}
                        {/*
                          Acción de dominio: va con texto, no con icono. Se ofrece siempre (con
                          la guarda de capacidad) y no solo a quien ya puede: deshabilitada y con
                          el motivo a la vista, igual que el resto de la pantalla.
                        */}
                        <span>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!guard.allowed || update.isPending}
                            aria-describedby={guard.describedBy}
                            aria-label={`${env.allows_agent_access ? 'Cerrar a agentes' : 'Permitir agentes'} en ${env.name}`}
                            onClick={() =>
                              env.allows_agent_access
                                ? setAgentAccess(env, false)
                                : setConfirming(env)
                            }
                          >
                            {env.allows_agent_access ? 'Cerrar a agentes' : 'Permitir agentes'}
                          </Button>
                        </span>
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      {env.database_count > 0 ? (
                        // Enlace al inventario SIN query param: los filtros de esa página viven
                        // en `useState`, no en la URL, así que un `?environment_id=` no se
                        // aplicaría y el link prometería un filtro que no ocurre. Cuando los
                        // filtros se sincronicen con la URL, acá se agrega el param y el título
                        // deja de hacer falta.
                        <Link
                          to="/managed-databases"
                          className="text-primary hover:underline"
                          title={`Filtrá por «${env.name}» en el inventario para verlas.`}
                        >
                          {env.database_count}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/*
              Alcance explícito. Un badge crea creencias más amplias que la barrera, y esta es la
              única pantalla donde se puede decir de una vez qué NO cubre.
            */}
            <p className="mt-4 text-xs text-muted-foreground">
              El bloqueo cubre <strong>aplicar migraciones</strong> (masivo y por BD). No cubre
              rollback, reconciliación parcial, <code>DROP DATABASE</code>, el clon que recrea el
              destino, la consola SQL, la conversión de collation ni la exportación: esos caminos
              tienen su propia confirmación por re-tipeo.
            </p>
          </div>
        )}
      </CardContent>
      {confirming && (
        <ConfirmDialog
          open
          onClose={() => {
            setConfirming(null)
            update.reset()
          }}
          onConfirm={() => setAgentAccess(confirming, true, confirming.slug)}
          title={`Permitir agentes en «${confirming.name}»`}
          description="Esto debilita la política del entorno: los tokens de agente podrán alcanzar sus bases."
          confirmWord={confirming.slug}
          confirmLabel="Permitir agentes"
          isLoading={update.isPending}
          confirmDisabled={!guard.allowed}
          confirmDescribedBy={guard.describedBy}
        >
          <p className="text-sm text-muted-foreground">
            Habilitar el entorno <strong>no abre ninguna base</strong>: cada base necesita además su
            propio opt-in. Para confirmar, escribí el identificador del entorno.
          </p>
          {confirmError && (
            <Callout tone="danger" title="No se pudo habilitar el entorno">
              <p>
                {environmentMessage(confirmError.code) ?? confirmError.message}
                {confirmError.environmentConfirmation &&
                  ` Identificador esperado: ${confirmError.environmentConfirmation.expectedSlug}.`}
              </p>
              {confirmError.environmentConfirmation &&
                confirmError.environmentConfirmation.weakened.length > 0 && (
                  <ul className="mt-1 list-disc pl-5">
                    {confirmError.environmentConfirmation.weakened.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
            </Callout>
          )}
        </ConfirmDialog>
      )}
    </Card>
  )
}
