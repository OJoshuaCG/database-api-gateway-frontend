import { useState } from 'react'
import { Button, Callout, Input, Modal, Textarea } from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import {
  INTEGRATION_TOKEN_NAME_MAX,
  INTEGRATION_TOKEN_NAME_MIN,
  type IntegrationTokenOut,
} from '@/lib/contracts'
import { useIntegrationScopeCeiling } from '../hooks/use-integration-scope-ceiling'
import { useUpdateIntegrationToken } from '../hooks/use-integration-tokens'
import { buildUpdateBody, hasDestructiveSelection } from '../integration-token-model'
import { integrationTokenErrorMessage } from '../messages'
import { BlueprintAllowlistPicker } from './BlueprintAllowlistPicker'
import { IntegrationScopesPicker } from './IntegrationScopesPicker'
import { ServerAllowlistPicker } from './ServerAllowlistPicker'

interface EditIntegrationTokenModalProps {
  open: boolean
  token: IntegrationTokenOut
  onClose: () => void
}

/**
 * Edita un token vivo sin reemitirlo: el bearer es el mismo y el cambio rige desde la llamada
 * siguiente. Solo el dueño puede editar (el servidor responde 404 a los demás). Se monta
 * condicionalmente (uno por token), así que `useState` parte del token sin efectos que sincronicen.
 */
export function EditIntegrationTokenModal({
  open,
  token,
  onClose,
}: EditIntegrationTokenModalProps) {
  const update = useUpdateIntegrationToken()
  const ceilingQuery = useIntegrationScopeCeiling()
  const ceiling = ceilingQuery.data

  const [name, setName] = useState(token.name)
  const [scopes, setScopes] = useState<string[]>(token.scopes)
  const [serverIds, setServerIds] = useState<number[]>(token.server_ids)
  const [blueprintIds, setBlueprintIds] = useState<number[]>(token.blueprint_ids)
  const [note, setNote] = useState(token.note ?? '')
  const [acknowledged, setAcknowledged] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const updateBody = buildUpdateBody(token, { name, scopes, serverIds, blueprintIds, note })
  const hasChanges = Object.keys(updateBody).length > 0

  const trimmedName = name.trim()
  const nameTooShort = trimmedName.length > 0 && trimmedName.length < INTEGRATION_TOKEN_NAME_MIN
  const destructiveSelected =
    ceiling !== undefined && hasDestructiveSelection(scopes, ceiling.scopes)
  // Un token destructivo exige blueprints y un token sin scopes o sin servidores no sirve: el
  // servidor lo rechaza igual, pero se evita el viaje y el paso de step-up.
  const canSubmit =
    ceiling?.enabled === true &&
    hasChanges &&
    trimmedName.length >= INTEGRATION_TOKEN_NAME_MIN &&
    scopes.length > 0 &&
    serverIds.length > 0 &&
    !(destructiveSelected && blueprintIds.length === 0) &&
    !(destructiveSelected && !acknowledged)

  const submit = () => {
    setFormError(null)
    update.mutate(
      { tokenPk: token.id, body: updateBody },
      {
        onSuccess: onClose,
        onError: (error) => {
          const apiError = toApiError(error)
          setFormError(integrationTokenErrorMessage(apiError) ?? apiError.message)
        },
      },
    )
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!update.isPending) onClose()
      }}
      title={`Editar «${token.name}»`}
      description="El token y su secreto no cambian: se actualizan permisos, listas permitidas, nombre y nota."
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
          maxLength={INTEGRATION_TOKEN_NAME_MAX}
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={nameTooShort ? `Mínimo ${INTEGRATION_TOKEN_NAME_MIN} caracteres` : undefined}
        />

        <IntegrationScopesPicker
          ceilingScopes={ceiling?.scopes ?? []}
          maxDestructiveTtlDays={ceiling?.max_destructive_ttl_days ?? 0}
          value={scopes}
          onChange={setScopes}
          suspendedScopes={token.suspended_scopes}
          acknowledged={acknowledged}
          onAcknowledgedChange={setAcknowledged}
          description="Reemplaza la lista completa. Dejá al menos uno: si el token ya no hace falta, lo correcto es revocarlo."
        />

        <ServerAllowlistPicker value={serverIds} onChange={setServerIds} />

        <BlueprintAllowlistPicker
          value={blueprintIds}
          onChange={setBlueprintIds}
          required={destructiveSelected}
        />

        <Textarea
          label="Nota (opcional)"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />

        <Callout tone="warning" title="El vencimiento no cambia">
          El vencimiento no se puede cambiar. Si el token vive más que el máximo del nivel que
          querés darle (30 días con escritura, 7 con destructivos), el servidor rechaza ampliar sus
          permisos y hay que emitir uno nuevo.
        </Callout>

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={update.isPending}>
            Cancelar
          </Button>
          <Button type="button" onClick={submit} isLoading={update.isPending} disabled={!canSubmit}>
            Guardar cambios
          </Button>
        </div>
      </div>
    </Modal>
  )
}
