import { Fragment, useState, type ReactNode } from 'react'
import { Button, Callout, IconButton, Input, XIcon } from '@/components/ui'
import { dataScopesOf, hasDefinitionsScope, rowScopesOf } from '../data-scopes'
import type { AgentScopeCeiling } from '../hooks/use-agent-scope-ceiling'

interface ScopesPickerProps {
  value: string[]
  onChange: (next: string[]) => void
  ceiling: AgentScopeCeiling
  /** Texto de ayuda bajo «Permisos»: cada formulario explica su propia regla (alta vs. edición). */
  description: ReactNode
}

/**
 * Selector de scopes en chips, compartido por el alta y la edición de tokens de agente. Es
 * controlado: quien lo usa decide qué hacer con la lista vacía y con el 422.
 */
export function ScopesPicker({ value, onChange, ceiling, description }: ScopesPickerProps) {
  const [scopeDraft, setScopeDraft] = useState('')
  const dataScopes = dataScopesOf(value)
  const rowScopes = rowScopesOf(value)
  const definitionsRequested = hasDefinitionsScope(value)
  const offeredRowScopes = rowScopesOf(ceiling.offered ?? [])
  const offersDefinitions = hasDefinitionsScope(ceiling.offered ?? [])

  const addScope = (raw: string) => {
    const scope = raw.trim()
    if (!scope || value.includes(scope)) return
    onChange([...value, scope])
    setScopeDraft('')
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">Permisos</span>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>

      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((scope) => (
            <li
              key={scope}
              className="flex items-center gap-1 rounded-lg border border-border bg-surface-muted py-1 pl-2.5 pr-1 text-xs"
            >
              <code className="font-mono text-foreground">{scope}</code>
              <IconButton
                type="button"
                label={`Quitar ${scope}`}
                icon={<XIcon />}
                variant="ghost"
                size="icon-sm"
                onClick={() => onChange(value.filter((s) => s !== scope))}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            label="Añadir permiso"
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
            value={scopeDraft}
            onChange={(event) => setScopeDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              // Enter añade el chip, NO envía el formulario: guardar o emitir por un Enter de más
              // sería cambiar los accesos de un token sin querer.
              event.preventDefault()
              addScope(scopeDraft)
            }}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => addScope(scopeDraft)}
          disabled={scopeDraft.trim().length === 0}
        >
          Añadir
        </Button>
      </div>

      {dataScopes.length > 0 && (
        <Callout tone="warning" title="Estos permisos leen datos de terceros">
          {rowScopes.length > 0 && (
            <p className="mb-2">
              {rowScopes.join(' y ')} permite{rowScopes.length > 1 ? 'n' : ''} que el agente lea
              FILAS de las bases de su proyecto: lo que lee sale del gateway hacia el contexto de un
              modelo.
            </p>
          )}
          {definitionsRequested && (
            <p className="mb-2">
              <code className="font-mono">data.definitions</code> permite que el agente lea el
              CÓDIGO de las vistas, triggers, eventos y rutinas de las bases de su proyecto. Esos
              cuerpos son texto de terceros: pueden contener secretos (contraseñas, tokens, claves)
              y reglas de negocio, y son contenido NO confiable, porque pueden traer instrucciones
              pensadas para el modelo que los lee. Salen del gateway hacia su contexto.
            </p>
          )}
          <ul className="flex list-disc flex-col gap-1 pl-5">
            <li>Al guardar se te pide la contraseña: sos vos quien responde por este token.</li>
            <li>
              El token solo hereda lo que tu usuario puede hacer y lee hasta que venza: revocalo si
              deja de hacer falta.
            </li>
            {rowScopes.length > 0 && (
              <li>
                Cada base tiene que abrirse aparte (credencial de datos y opt-in), y mientras el
                gateway tenga la lectura de datos apagada el permiso queda guardado pero sin efecto.
              </li>
            )}
            {definitionsRequested && (
              <li>
                <code className="font-mono">data.definitions</code> tiene su propio interruptor en
                el gateway: mientras la lectura de definiciones esté apagada el permiso queda
                guardado pero sin efecto.
              </li>
            )}
          </ul>
        </Callout>
      )}

      {ceiling.offered && (
        <Callout
          tone="info"
          title={
            ceiling.discovered
              ? 'Techo de agente informado por el servidor'
              : 'Permisos disponibles para agentes'
          }
        >
          <p className="mb-2">
            Estos son los permisos que el servidor admite. Tocá uno para añadirlo:
          </p>
          <div className="flex flex-wrap gap-2">
            {ceiling.offered.map((scope) => (
              <Button
                key={scope}
                type="button"
                variant="outline"
                size="sm"
                disabled={value.includes(scope)}
                onClick={() => addScope(scope)}
              >
                {scope}
              </Button>
            ))}
          </div>
          {offeredRowScopes.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {offeredRowScopes.map((scope, index) => (
                <Fragment key={scope}>
                  {index > 0 && ' y '}
                  <code className="font-mono">{scope}</code>
                </Fragment>
              ))}{' '}
              leen filas de bases de terceros: al añadirlos vas a ver el aviso con sus condiciones.
            </p>
          )}
          {offersDefinitions && (
            <p className="mt-2 text-xs text-muted-foreground">
              <code className="font-mono">data.definitions</code> lee el código (cuerpos) de vistas,
              triggers, eventos y rutinas de bases de terceros, que puede contener secretos: al
              añadirlo vas a ver el aviso con sus condiciones.
            </p>
          )}
        </Callout>
      )}
    </div>
  )
}
