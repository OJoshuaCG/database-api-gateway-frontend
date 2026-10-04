import { useState } from 'react'
import { Button, Callout, Combobox, Input, Modal, Textarea } from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import { useProjects } from '@/features/projects/hooks/use-projects'
import {
  API_TOKEN_DEFAULT_SCOPE,
  API_TOKEN_DATA_MAX_TTL_DAYS,
  API_TOKEN_DEFAULT_TTL_DAYS,
  API_TOKEN_ERROR_CODES,
  API_TOKEN_MAX_TTL_DAYS,
  API_TOKEN_NAME_MAX,
  API_TOKEN_NAME_MIN,
  hasDataScope,
  PAGINATION,
  PROJECT_ERROR_CODES,
  type ApiTokenCreatedOut,
  type ProjectOut,
} from '@/lib/contracts'
import { useCreateApiToken } from '../hooks/use-api-tokens'
import { apiTokenErrorMessage } from '../messages'
import { useAgentScopeCeiling } from '../hooks/use-agent-scope-ceiling'
import { ScopesPicker } from './ScopesPicker'

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
  const [ttlDays, setTtlDays] = useState(String(API_TOKEN_DEFAULT_TTL_DAYS))
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const ceiling = useAgentScopeCeiling()

  const nameTooShort = name.trim().length > 0 && name.trim().length < API_TOKEN_NAME_MIN
  const ttlNumber = Number(ttlDays)
  // Con un scope de datos el tope baja (el servidor responde 422 `ttl_too_long` si no): se aplica
  // acá para que el operador lo vea en el campo y no por el error. El default (90) no se achica
  // solo: cambiar un vencimiento sin que se note sería peor que pedirlo.
  const maxTtl = hasDataScope(scopes) ? API_TOKEN_DATA_MAX_TTL_DAYS : API_TOKEN_MAX_TTL_DAYS
  const ttlInvalid =
    ttlDays.trim().length === 0 ||
    !Number.isInteger(ttlNumber) ||
    ttlNumber < 1 ||
    ttlNumber > maxTtl
  const canSubmit = name.trim().length >= API_TOKEN_NAME_MIN && project !== null && !ttlInvalid

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
            if (allowed?.length) ceiling.discover(allowed)
          }
          // El proyecto elegido ya no existe: se suelta para que no se reenvíe el mismo id. El
          // hook ya invalidó el listado, así que el selector se refresca solo.
          if (apiError.code === PROJECT_ERROR_CODES.notFound) setProject(null)
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
          hint="Describí la máquina o el repositorio destino: es lo que vas a leer cuando toque revocarlo."
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

        <ScopesPicker
          value={scopes}
          onChange={setScopes}
          ceiling={ceiling}
          description={
            <>
              Si lo dejás vacío, el token se emite con{' '}
              <code className="font-mono">{API_TOKEN_DEFAULT_SCOPE}</code> — que NO es «sin
              permisos». El servidor además intersecta lo que pidas con el techo de agente, así que
              el token puede quedar con menos de lo que elijas.
            </>
          }
        />

        <Input
          label="Vence en (días)"
          type="number"
          required
          min={1}
          max={maxTtl}
          value={ttlDays}
          onChange={(event) => setTtlDays(event.target.value)}
          // El default visible es un NÚMERO, no un campo vacío: un vacío se lee como «no vence», y
          // el backend lo interpretaría como 90 días sin decirlo.
          hint={
            hasDataScope(scopes)
              ? `Entre 1 y ${maxTtl} días: con permisos de datos el máximo es menor.`
              : `Entre 1 y ${maxTtl} días. No existen tokens sin vencimiento.`
          }
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
