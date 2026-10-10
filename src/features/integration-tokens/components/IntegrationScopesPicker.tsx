import { useState, type ReactNode } from 'react'
import { AlertIcon, Badge, Callout, ChevronRightIcon, Checkbox } from '@/components/ui'
import { cn } from '@/lib/utils'
import { hasDestructiveSelection, groupCeilingScopesByTier } from '../integration-token-model'
import {
  DESTRUCTIVE_ACKNOWLEDGEMENT_LABEL,
  DESTRUCTIVE_GROUP_TITLE,
  SUSPENDED_BADGE_LABEL,
  destructiveWarning,
} from '../messages'
import type { IntegrationScopeCeilingEntry } from '@/lib/contracts'

interface IntegrationScopesPickerProps {
  /** Los scopes que el servidor deja ofrecer HOY. Lo que no viene acá no se dibuja. */
  ceilingScopes: IntegrationScopeCeilingEntry[]
  /** Tope de vida de un token destructivo (`max_destructive_ttl_days`), para el aviso. */
  maxDestructiveTtlDays: number
  value: string[]
  onChange: (next: string[]) => void
  /** Guardados que el emisor ya no tiene: se muestran como «suspendido» y no se pueden elegir. */
  suspendedScopes?: string[]
  /** Confirmación explícita del riesgo destructivo. Solo habilita el envío; el servidor decide. */
  acknowledged: boolean
  onAcknowledgedChange: (next: boolean) => void
  /** Texto de ayuda bajo «Permisos»: cada formulario explica su propia regla (alta vs. edición). */
  description: ReactNode
}

/**
 * Selector de scopes de integración, compartido por el alta y la edición. Es controlado.
 *
 * Distinto a propósito del `ScopesPicker` de agente: acá no hay campo libre ni techo por
 * capacidad. Se agrupa por el `tier` que informa el servidor y solo se dibuja lo que el techo
 * devuelve; un scope que el usuario no tiene NO aparece ni deshabilitado, porque un chip apagado
 * diría qué capacidades existen más allá de su rol.
 *
 * El grupo destructivo nace plegado: revertir migraciones no debería ser a un clic de distancia
 * de marcar un permiso de lectura. Al elegir cualquiera de sus scopes se muestra el aviso y una
 * confirmación que el formulario usa para habilitar el envío (control de cliente, no de seguridad:
 * el servidor exige step-up, lista de blueprints y tope de vida).
 */
export function IntegrationScopesPicker({
  ceilingScopes,
  maxDestructiveTtlDays,
  value,
  onChange,
  suspendedScopes = [],
  acknowledged,
  onAcknowledgedChange,
  description,
}: IntegrationScopesPickerProps) {
  const groups = groupCeilingScopesByTier(ceilingScopes)
  const destructiveSelected = hasDestructiveSelection(value, ceilingScopes)

  // `null` = el usuario no tocó el grupo. Entonces se abre solo si ya hay un scope destructivo
  // elegido (edición de un token que lo tiene): ocultar algo que el token ya puede hacer sería
  // esconder justo lo que hay que revisar. Se deriva en el render y no se copia a un estado porque
  // el techo llega de forma asíncrona, después del primer render.
  const [destructiveGroupToggled, setDestructiveGroupToggled] = useState<boolean | null>(null)
  const destructiveGroupOpen = destructiveGroupToggled ?? destructiveSelected

  const toggleScope = (scope: string, checked: boolean) => {
    const next = checked ? [...value, scope] : value.filter((selected) => selected !== scope)
    onChange(next)
    // La confirmación no se arrastra: si deja de haber scopes destructivos y vuelve a elegir uno,
    // tiene que aceptar de nuevo.
    if (!hasDestructiveSelection(next, ceilingScopes)) onAcknowledgedChange(false)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">Permisos</span>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>

      {groups.length === 0 && (
        <p className="text-xs italic text-muted-foreground">
          Tu rol no puede dar ningún permiso de integración.
        </p>
      )}

      {groups.map((group) => {
        const isDestructiveGroup = group.tier === 'destructive'
        const groupContent = (
          <ul className="flex flex-col gap-2">
            {group.entries.map((entry) => (
              <li key={entry.scope}>
                <Checkbox
                  label={entry.label}
                  caption={
                    <code className="font-mono text-xs text-muted-foreground">{entry.scope}</code>
                  }
                  checked={value.includes(entry.scope)}
                  onChange={(event) => toggleScope(entry.scope, event.target.checked)}
                />
              </li>
            ))}
          </ul>
        )

        if (!isDestructiveGroup) {
          return (
            <section
              key={group.tier}
              className="flex flex-col gap-2 rounded-lg border border-border p-3"
            >
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.title}
              </h3>
              {groupContent}
            </section>
          )
        }

        return (
          <section
            key={group.tier}
            className="flex flex-col gap-2 rounded-lg border border-error/40 p-3"
          >
            <button
              type="button"
              aria-expanded={destructiveGroupOpen}
              onClick={() => setDestructiveGroupToggled(!destructiveGroupOpen)}
              className="flex items-center gap-2 text-left text-xs font-semibold uppercase tracking-wide text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronRightIcon
                className={cn('h-4 w-4 transition-transform', destructiveGroupOpen && 'rotate-90')}
              />
              <AlertIcon className="h-4 w-4" />
              {group.title}
            </button>
            {destructiveGroupOpen && groupContent}
          </section>
        )
      })}

      {destructiveSelected && (
        <Callout tone="danger" title={DESTRUCTIVE_GROUP_TITLE}>
          <p>{destructiveWarning(maxDestructiveTtlDays)}</p>
          <div className="mt-3">
            <Checkbox
              label={DESTRUCTIVE_ACKNOWLEDGEMENT_LABEL}
              checked={acknowledged}
              onChange={(event) => onAcknowledgedChange(event.target.checked)}
            />
          </div>
        </Callout>
      )}

      {suspendedScopes.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-dashed border-border p-3">
          <p className="text-xs text-muted-foreground">
            Tu rol ya no tiene estos permisos, así que hoy no hacen nada. No se pueden volver a
            elegir; si cambiás la selección de permisos, al guardar se quitan del token.
          </p>
          <ul className="flex flex-wrap gap-2">
            {suspendedScopes.map((scope) => (
              <li key={scope} className="flex items-center gap-1.5">
                <code className="font-mono text-xs text-muted-foreground">{scope}</code>
                <Badge tone="warning">{SUSPENDED_BADGE_LABEL}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
