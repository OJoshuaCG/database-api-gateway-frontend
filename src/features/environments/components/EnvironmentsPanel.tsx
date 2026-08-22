import { Link } from 'react-router-dom'
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EnvironmentBadge,
  ErrorState,
  Spinner,
} from '@/components/ui'
import { useEnvironmentOptions } from '../hooks/use-environment-options'

/**
 * Catálogo de entornos, **de solo lectura**.
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Entornos de despliegue</CardTitle>
        <CardDescription>
          Clasifican cada base gestionada y definen qué se puede aplicar sobre ella. Es un conjunto
          fijo: se administra por API a propósito, no desde acá. Ojo, esto no tiene nada que ver
          con el <code>APP_ENV</code> del propio gateway que muestra <code>/health</code>.
        </CardDescription>
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
                      {env.blocks_destructive_migrations ? (
                        <span className="text-warning">
                          Bloquea migraciones destructivas (DROP / TRUNCATE / DELETE sin WHERE /
                          ALTER DROP COLUMN)
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Sin restricciones</span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      {env.database_count > 0 ? (
                        // Enlace al inventario SIN query param: los filtros de esa página viven
                        // en `useState`, no en la URL, así que un `?environment_id=` no se
                        // aplicaría y el link prometería un filtro que no ocurre. Cuando los
                        // filtros se sincronicen con la URL (ítem propio en TODO.md), acá se
                        // agrega el param y el título deja de hacer falta.
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
    </Card>
  )
}
