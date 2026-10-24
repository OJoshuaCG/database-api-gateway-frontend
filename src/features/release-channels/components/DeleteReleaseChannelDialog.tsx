import { Callout, ConfirmDialog } from '@/components/ui'
import { CapabilityHint, useCapabilityGuard, useStepUp } from '@/features/auth'
import { toApiError } from '@/lib/api/errors'
import { CAPABILITIES, type ReleaseChannelOut } from '@/lib/contracts'
import { useDeleteReleaseChannel } from '../hooks/use-release-channels'
import { releaseChannelMessage } from '../messages'

interface DeleteReleaseChannelDialogProps {
  /** `null` = cerrado. Se monta con el canal para que el diálogo nazca con datos frescos. */
  channel: ReleaseChannelOut | null
  onClose: () => void
}

/**
 * Confirmación del borrado de un canal.
 *
 * Un canal sin punteros se borra con una confirmación simple. Con punteros hay que repetir su
 * slug (`confirm_slug`): borrarlo pierde, para cada blueprint, qué versión servía y todo su
 * historial de movimientos. Los blueprints y sus versiones no se tocan, y ninguna base de datos
 * tampoco.
 */
export function DeleteReleaseChannelDialog({ channel, onClose }: DeleteReleaseChannelDialogProps) {
  const remove = useDeleteReleaseChannel()
  const stepUp = useStepUp()
  const guard = useCapabilityGuard(CAPABILITIES.releaseChannelsWrite, 'borrar el canal')
  if (!channel) return null

  const requiresSlug = channel.pointer_count > 0
  const rejection = remove.isError ? toApiError(remove.error) : null
  const rejectionMessage = rejection ? releaseChannelMessage(rejection.code) : null

  const handleClose = () => {
    remove.reset()
    onClose()
  }

  return (
    <ConfirmDialog
      open
      onClose={handleClose}
      onConfirm={() =>
        stepUp.withFresh(CAPABILITIES.releaseChannelsWrite, () =>
          remove.mutate(
            { id: channel.id, confirmSlug: requiresSlug ? channel.slug : undefined },
            { onSuccess: handleClose },
          ),
        )
      }
      title={`¿Borrar el canal «${channel.name}»?`}
      confirmWord={requiresSlug ? channel.slug : undefined}
      confirmLabel="Borrar canal"
      isLoading={remove.isPending}
      confirmDisabled={!guard.allowed}
      confirmDescribedBy={guard.describedBy}
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {requiresSlug
            ? `El canal tiene ${channel.pointer_count} puntero(s) de blueprint: se pierde qué versión servía cada uno y su historial. Los blueprints y sus versiones no se tocan. Para confirmar, escribí el identificador del canal.`
            : 'El canal no tiene punteros de blueprint. Las integraciones que lo citen dejarán de resolverlo.'}
        </p>
        <CapabilityHint guard={guard} />
        {rejection && (
          <Callout tone="danger" title="No se pudo borrar el canal">
            <p>{rejectionMessage ?? rejection.message}</p>
          </Callout>
        )}
      </div>
    </ConfirmDialog>
  )
}
