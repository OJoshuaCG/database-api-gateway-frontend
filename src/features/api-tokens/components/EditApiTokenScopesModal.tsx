import { useState } from 'react'
import { Button, Callout, Modal } from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import {
  API_TOKEN_DATA_MAX_TTL_DAYS,
  API_TOKEN_ERROR_CODES,
  type ApiTokenOut,
} from '@/lib/contracts'
import { dataScopeTtlBlocked } from '../data-scopes'
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
  // El reloj se lee UNA vez (leerlo en render es impuro); el tope se mide en días.
  const [nowMs] = useState(() => Date.now())

  // Lista vacía = 422: un token sin permisos no sirve, se revoca. Y sin cambios no hay nada que
  // enviar (y evita un paso de step-up y una fila de auditoría vacíos).
  const unchanged =
    scopes.length === token.scopes.length && scopes.every((scope) => token.scopes.includes(scope))
  // Agregar datos a un token que todavía vive más del tope lo dejaría leyendo filas todo ese tiempo:
  // el servidor lo rechaza (422 `ttl_too_long`) y acá se avisa antes.
  const ttlBlocked = dataScopeTtlBlocked(scopes, token.expires_at, nowMs)
  const canSubmit = scopes.length > 0 && !unchanged && !ttlBlocked

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

        {ttlBlocked && (
          <Callout tone="danger" title="Este token vive demasiado para leer datos">
            Con permisos de datos un token vive como máximo {API_TOKEN_DATA_MAX_TTL_DAYS} días y a
            este le queda más. Emití uno nuevo con un vencimiento menor, o quitá los permisos de
            datos de la selección.
          </Callout>
        )}

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
