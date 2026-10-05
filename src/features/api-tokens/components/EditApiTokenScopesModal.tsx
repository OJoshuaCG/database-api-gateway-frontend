import { useState } from 'react'
import { Button, Callout, Modal } from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import { API_TOKEN_ERROR_CODES, type ApiTokenOut } from '@/lib/contracts'
import { useUpdateApiTokenScopes } from '../hooks/use-api-tokens'
import { apiTokenErrorMessage } from '../messages'
import { useAgentScopeCeiling } from '../hooks/use-agent-scope-ceiling'
import { ScopesPicker } from './ScopesPicker'

interface EditApiTokenScopesModalProps {
  open: boolean
  token: ApiTokenOut
  onClose: () => void
}

/**
 * Cambia los permisos de un token vivo sin reemitirlo: el bearer es el mismo y el cambio rige
 * desde la llamada siguiente. Se monta condicionalmente (uno por token), así que `useState` parte
 * de `token.scopes` sin necesidad de un efecto que sincronice.
 */
export function EditApiTokenScopesModal({ open, token, onClose }: EditApiTokenScopesModalProps) {
  const update = useUpdateApiTokenScopes()
  const ceiling = useAgentScopeCeiling()
  const [scopes, setScopes] = useState<string[]>(token.scopes)
  const [formError, setFormError] = useState<string | null>(null)

  // Lista vacía = 422: un token sin permisos no sirve, se revoca. Y sin cambios no hay nada que
  // enviar (y evita un paso de step-up y una fila de auditoría vacíos).
  const unchanged =
    scopes.length === token.scopes.length && scopes.every((scope) => token.scopes.includes(scope))
  // Si el backend fija un tope propio de vida para los permisos de datos y a este token le queda
  // más, el servidor lo rechaza (422 `ttl_too_long`) y `apiTokenErrorMessage` muestra el error con
  // el `max_days` real: el tope no viaja al cliente, así que no se anticipa con un número fijo.
  const canSubmit = scopes.length > 0 && !unchanged

  const submit = () => {
    setFormError(null)
    update.mutate(
      { tokenPk: token.id, body: { scopes } },
      {
        onSuccess: onClose,
        onError: (error) => {
          const apiError = toApiError(error)
          if (apiError.code === API_TOKEN_ERROR_CODES.scopeNotAllowed) {
            const allowed = apiError.apiTokenContext?.allowed
            if (allowed?.length) ceiling.discover(allowed)
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
        if (!update.isPending) onClose()
      }}
      title={`Permisos de «${token.name}»`}
      description="Reemplaza la lista completa de permisos. El token y su secreto no cambian."
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

        <ScopesPicker
          value={scopes}
          onChange={setScopes}
          ceiling={ceiling}
          description="Dejá al menos uno: un token sin permisos no sirve, y si ya no hace falta lo correcto es revocarlo. El servidor intersecta lo que pidas con el techo de agente, así que el token puede quedar con menos de lo que elijas."
        />

        <Callout tone="warning" title="Ampliar un token ya repartido">
          Quien tenga este token va a poder hacer lo nuevo desde su próxima llamada, sin cambiar
          nada de su lado. Y si quitás un permiso, lo que dependa de él va a empezar a fallar.
        </Callout>

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={update.isPending}>
            Cancelar
          </Button>
          <Button type="button" onClick={submit} isLoading={update.isPending} disabled={!canSubmit}>
            Guardar permisos
          </Button>
        </div>
      </div>
    </Modal>
  )
}
