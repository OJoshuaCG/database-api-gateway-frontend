import { useState, type ReactNode } from 'react'
import { Button, Callout, IconButton, Input, XIcon } from '@/components/ui'
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
        </Callout>
      )}
    </div>
  )
}
