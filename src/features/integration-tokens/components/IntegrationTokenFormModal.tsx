import { useState } from 'react'
import { Button, Callout, Checkbox, Input, Modal, Textarea } from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import {
  INTEGRATION_TOKEN_NAME_MAX,
  INTEGRATION_TOKEN_NAME_MIN,
  type IntegrationTokenCreatedOut,
} from '@/lib/contracts'
import { useIntegrationScopeCeiling } from '../hooks/use-integration-scope-ceiling'
import { useCreateIntegrationToken } from '../hooks/use-integration-tokens'
import { hasDestructiveSelection, maxTtlDaysFor } from '../integration-token-model'
import { integrationTokenErrorMessage } from '../messages'
import { BlueprintAllowlistPicker } from './BlueprintAllowlistPicker'
import { IntegrationScopesPicker } from './IntegrationScopesPicker'
import { ServerAllowlistPicker } from './ServerAllowlistPicker'

interface IntegrationTokenFormModalProps {
  open: boolean
  onClose: () => void
  onCreated: (created: IntegrationTokenCreatedOut) => void
}

export function IntegrationTokenFormModal({
  open,
  onClose,
  onCreated,
}: IntegrationTokenFormModalProps) {
  const create = useCreateIntegrationToken()
  const ceilingQuery = useIntegrationScopeCeiling()
  const ceiling = ceilingQuery.data

  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>([])
  const [serverIds, setServerIds] = useState<number[]>([])
  const [blueprintIds, setBlueprintIds] = useState<number[]>([])
  const [acknowledged, setAcknowledged] = useState(false)
  // `null` significa «usar el tope del tier»: el valor se calcula en el render y sigue a la
  // selección sin efectos. Solo lo que el usuario tipea queda guardado.
  const [ttlOverride, setTtlOverride] = useState<string | null>(null)
  const [neverExpires, setNeverExpires] = useState(false)
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const ceilingScopes = ceiling?.scopes ?? []
  const apiEnabled = ceiling?.enabled === true
  const destructiveSelected =
    ceiling !== undefined && hasDestructiveSelection(scopes, ceiling.scopes)
  const maxTtlDays = ceiling === undefined ? 0 : maxTtlDaysFor(scopes, ceiling)
  // Un permiso destructivo siempre vence: si se elige uno después de marcar «sin vencimiento», la
  // opción se ignora (y el checkbox se oculta) en vez de mandarle al servidor un pedido que rechaza.
  const canNeverExpire = ceiling?.allow_non_expiring === true && !destructiveSelected
  const neverExpiresEffective = neverExpires && canNeverExpire
  const ttlText = ttlOverride ?? (maxTtlDays > 0 ? String(maxTtlDays) : '')
  const ttlNumber = Number(ttlText)
  const ttlInvalid =
    !neverExpiresEffective &&
    (ttlText.trim().length === 0 ||
      !Number.isInteger(ttlNumber) ||
      ttlNumber < 1 ||
      ttlNumber > maxTtlDays)

  const trimmedName = name.trim()
  const nameTooShort = trimmedName.length > 0 && trimmedName.length < INTEGRATION_TOKEN_NAME_MIN
  const blueprintsMissing = destructiveSelected && blueprintIds.length === 0
  const acknowledgementMissing = destructiveSelected && !acknowledged

  const canSubmit =
    apiEnabled &&
    trimmedName.length >= INTEGRATION_TOKEN_NAME_MIN &&
    scopes.length > 0 &&
    serverIds.length > 0 &&
    !blueprintsMissing &&
    !acknowledgementMissing &&
    !ttlInvalid

  const submit = () => {
    setFormError(null)
    const trimmedNote = note.trim()
    create.mutate(
      {
        name: trimmedName,
        scopes,
        server_ids: serverIds,
        blueprint_ids: blueprintIds,
        ...(neverExpiresEffective ? { never_expires: true } : { expires_in_days: ttlNumber }),
        ...(trimmedNote.length > 0 ? { note: trimmedNote } : {}),
      },
      {
        onSuccess: onCreated,
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
        if (!create.isPending) onClose()
      }}
      title="Emitir token de integración"
      description="Una credencial portadora para tu propio proyecto web: opera solo los permisos y servidores que elijas."
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

        {ceiling !== undefined && !ceiling.enabled && (
          <Callout tone="warning" title="API de integración apagada">
            La API de integración está apagada en este servidor: por ahora no se pueden emitir
            tokens.
          </Callout>
        )}

        <Input
          label="Nombre"
          required
          autoFocus
          maxLength={INTEGRATION_TOKEN_NAME_MAX}
          value={name}
          onChange={(event) => setName(event.target.value)}
          hint="Describí el proyecto web que lo va a usar: es lo que vas a leer cuando toque revocarlo."
          error={nameTooShort ? `Mínimo ${INTEGRATION_TOKEN_NAME_MIN} caracteres` : undefined}
        />

        <IntegrationScopesPicker
          ceilingScopes={ceilingScopes}
          maxDestructiveTtlDays={ceiling?.max_destructive_ttl_days ?? 0}
          value={scopes}
          onChange={setScopes}
          acknowledged={acknowledged}
          onAcknowledgedChange={setAcknowledged}
          description="Solo ves lo que tu rol puede dar hoy. Los permisos se pueden editar después de emitir el token."
        />

        <ServerAllowlistPicker value={serverIds} onChange={setServerIds} />

        <BlueprintAllowlistPicker
          value={blueprintIds}
          onChange={setBlueprintIds}
          required={destructiveSelected}
        />

        {canNeverExpire && (
          <Checkbox
            label="Sin vencimiento"
            checked={neverExpires}
            onChange={(event) => setNeverExpires(event.target.checked)}
          />
        )}

        <Input
          label="Vence en (días)"
          type="number"
          required
          disabled={neverExpiresEffective}
          min={1}
          max={maxTtlDays}
          value={ttlText}
          onChange={(event) => setTtlOverride(event.target.value)}
          // El default visible es un NÚMERO, no un campo vacío: un vacío se lee como «no vence». El
          // tope baja con el tier más estricto elegido y lo informa el servidor, no el cliente.
          hint={`Entre 1 y ${maxTtlDays} días según los permisos elegidos. El vencimiento no se puede cambiar después.${canNeverExpire ? ' Con «Sin vencimiento» el token vale hasta que lo revoques: tratalo como una credencial permanente.' : ''}`}
          error={ttlInvalid && ttlText.trim().length > 0 ? 'Fuera de rango' : undefined}
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
