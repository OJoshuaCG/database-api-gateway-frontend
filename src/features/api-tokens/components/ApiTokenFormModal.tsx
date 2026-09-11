import { useState } from 'react'
import {
  Button,
  Callout,
  Combobox,
  IconButton,
  Input,
  Modal,
  Textarea,
  XIcon,
} from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import { useProjects } from '@/features/projects/hooks/use-projects'
import {
  API_TOKEN_DEFAULT_SCOPE,
  API_TOKEN_DEFAULT_TTL_DAYS,
  API_TOKEN_ERROR_CODES,
  API_TOKEN_MAX_TTL_DAYS,
  API_TOKEN_NAME_MAX,
  API_TOKEN_NAME_MIN,
  PAGINATION,
  type ApiTokenCreatedOut,
  type ProjectOut,
} from '@/lib/contracts'
import { useCreateApiToken } from '../hooks/use-api-tokens'
import { apiTokenErrorMessage } from '../messages'

interface ApiTokenFormModalProps {
  open: boolean
  onClose: () => void
  onCreated: (created: ApiTokenCreatedOut) => void
}

export function ApiTokenFormModal({ open, onClose, onCreated }: ApiTokenFormModalProps) {
  const create = useCreateApiToken()
  const projects = useProjects({ page: 1, size: PAGINATION.maxSize })

  const [name, setName] = useState('')
  const [project, setProject] = useState<ProjectOut | null>(null)
  const [scopes, setScopes] = useState<string[]>([])
  const [scopeDraft, setScopeDraft] = useState('')
  const [ttlDays, setTtlDays] = useState(String(API_TOKEN_DEFAULT_TTL_DAYS))
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  /**
   * Techo de agente, descubierto a partir de un 422 `scope_not_allowed`. Es la única vía para
   * conocerlo hoy: el catálogo de capacidades vive en v23, que este frontend todavía no consume.
   * Cuando llega, sus valores pasan a ofrecerse como opciones de un clic.
   */
  const [discoveredCeiling, setDiscoveredCeiling] = useState<string[] | null>(null)

  const nameTooShort = name.trim().length > 0 && name.trim().length < API_TOKEN_NAME_MIN
  const ttlNumber = Number(ttlDays)
  const ttlInvalid =
    ttlDays.trim().length === 0 ||
    !Number.isInteger(ttlNumber) ||
    ttlNumber < 1 ||
    ttlNumber > API_TOKEN_MAX_TTL_DAYS
  const canSubmit = name.trim().length >= API_TOKEN_NAME_MIN && project !== null && !ttlInvalid

  const addScope = (value: string) => {
    const scope = value.trim()
    if (!scope || scopes.includes(scope)) return
    setScopes((current) => [...current, scope])
    setScopeDraft('')
  }

  const submit = () => {
    setFormError(null)
    create.mutate(
      {
        name: name.trim(),
        project_id: project?.id ?? 0,
        scopes: scopes.length > 0 ? scopes : undefined,
        expires_in_days: ttlNumber,
        note: note.trim() || undefined,
      },
      {
        onSuccess: onCreated,
        onError: (error) => {
          const apiError = toApiError(error)
          if (apiError.code === API_TOKEN_ERROR_CODES.scopeNotAllowed) {
            const allowed = apiError.apiTokenContext?.allowed
            if (allowed?.length) setDiscoveredCeiling(allowed)
          }
          setFormError(apiTokenErrorMessage(apiError) ?? apiError.message)
        },
      },
    )
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!create.isPending) onClose()
      }}
      title="Emitir token de agente"
      description="Una credencial portadora para un proceso automático: un pipeline de CI, un agente MCP."
      size="lg"
    >
      <div className="flex flex-col gap-4">
        {formError && (
          <p
            role="alert"
            className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-sm text-error"
          >
            {formError}
          </p>
        )}

        <Input
          label="Nombre"
          required
          autoFocus
          maxLength={API_TOKEN_NAME_MAX}
          value={name}
          onChange={(event) => setName(event.target.value)}
          hint="Describe la máquina o el repositorio destino: es lo que vas a leer cuando toque revocarlo."
          error={nameTooShort ? `Mínimo ${API_TOKEN_NAME_MIN} caracteres` : undefined}
        />

        <Combobox<ProjectOut>
          items={projects.data?.items ?? []}
          value={project}
          onChange={setProject}
          itemToString={(item) => item.name}
          itemToKey={(item) => item.id}
          label="Proyecto"
          required
          isLoading={projects.isPending}
          hint="Obligatorio: un token sin proyecto no alcanzaría ninguna base de datos."
        />

        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">Permisos</span>
            <p className="text-xs text-muted-foreground">
              Si lo dejás vacío, el token se emite con{' '}
              <code className="font-mono">{API_TOKEN_DEFAULT_SCOPE}</code> — que NO es «sin
              permisos». El servidor además intersecta lo que pidas con el techo de agente, así que
              el token puede quedar con menos de lo que elijas.
            </p>
          </div>

          {scopes.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {scopes.map((scope) => (
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
                    onClick={() => setScopes((current) => current.filter((s) => s !== scope))}
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
                  // Enter añade el chip, NO envía el formulario: emitir un token por un Enter de
                  // más sería emitir un secreto de un solo uso sin querer.
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

          {discoveredCeiling && (
            <Callout tone="info" title="Techo de agente informado por el servidor">
              <p className="mb-2">
                Estos son los permisos que el servidor admite. Tocá uno para añadirlo:
              </p>
              <div className="flex flex-wrap gap-2">
                {discoveredCeiling.map((scope) => (
                  <Button
                    key={scope}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={scopes.includes(scope)}
                    onClick={() => addScope(scope)}
                  >
                    {scope}
                  </Button>
                ))}
              </div>
            </Callout>
          )}
        </div>

        <Input
          label="Vence en (días)"
          type="number"
          required
          min={1}
          max={API_TOKEN_MAX_TTL_DAYS}
          value={ttlDays}
          onChange={(event) => setTtlDays(event.target.value)}
          // El default visible es un NÚMERO, no un campo vacío: un vacío se lee como «no vence», y
          // el backend lo interpretaría como 90 días sin decirlo.
          hint={`Entre 1 y ${API_TOKEN_MAX_TTL_DAYS} días. No existen tokens sin vencimiento.`}
          error={ttlInvalid && ttlDays.trim().length > 0 ? 'Fuera de rango' : undefined}
        />

        <Textarea
          label="Nota (opcional)"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          hint="Para qué es. Se ve en el listado."
        />

        <Callout tone="warning" title="El token se muestra una sola vez">
          Al emitirlo vas a ver el valor completo. No se puede volver a consultar: si no lo copiás
          ahí mismo, hay que emitir otro y revocar este.
        </Callout>

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={create.isPending}>
            Cancelar
          </Button>
          <Button type="button" onClick={submit} isLoading={create.isPending} disabled={!canSubmit}>
            Emitir token
          </Button>
        </div>
      </div>
    </Modal>
  )
}
