import { useMemo, useState } from 'react'
import { Button, Callout, Combobox, Input, Modal, Textarea } from '@/components/ui'
import { CapabilityHint, useCapabilityGuard, useStepUp } from '@/features/auth'
import { toApiError } from '@/lib/api/errors'
import {
  CAPABILITIES,
  RELEASE_CHANNEL_ERROR_CODES,
  type ChannelResolutionOut,
} from '@/lib/contracts'
import { isBackwardPromotion } from '../blueprint-channels'
import { usePromoteBlueprintChannel } from '../hooks/use-blueprint-channels'
import { releaseChannelMessage } from '../messages'

/** Lo mínimo que el diálogo necesita saber de cada versión del blueprint. */
export interface PromotableVersion {
  version: string
  reviewed?: boolean
}

interface PromoteChannelDialogProps {
  modelId: number
  /** Canal a mover. El diálogo se monta con él (y se remonta con otro vía `key`). */
  channel: ChannelResolutionOut
  /** Catálogo del blueprint, ya ordenado ascendente. */
  versions: readonly PromotableVersion[]
  onClose: () => void
}

/**
 * Mueve el puntero de un canal manual a una versión REVISADA del blueprint.
 *
 * Promover es una decisión de liberación: cambia qué versión reciben, la próxima vez que lo pidan,
 * las integraciones que consumen el canal. **No toca ninguna base de datos** ni aplica nada: las
 * bases ya creadas no se mueven solas.
 *
 * Un RETROCESO (destino menor que el puntero actual) exige repetir el slug del canal, que se manda
 * como `confirm_slug`. La pantalla lo anticipa comparando versiones, y además atiende el 409
 * `promote_backward_requires_confirm` por si la comparación no alcanzó (versión no numérica, o el
 * puntero se movió mientras tanto): el servidor es quien decide.
 */
export function PromoteChannelDialog({
  modelId,
  channel,
  versions,
  onClose,
}: PromoteChannelDialogProps) {
  const [target, setTarget] = useState<PromotableVersion | null>(null)
  const [note, setNote] = useState('')
  const [confirmSlug, setConfirmSlug] = useState('')

  const promote = usePromoteBlueprintChannel(modelId)
  const stepUp = useStepUp()
  const guard = useCapabilityGuard(CAPABILITIES.blueprintsPromote, 'promover canales')

  // El servidor no deja promover una versión sin revisar. Se ofrecen solo las revisadas, de la más
  // reciente a la más antigua, y se dice cuántas quedaron fuera para que no parezca que faltan.
  const reviewedVersions = useMemo(
    () => versions.filter((item) => item.reviewed !== false).reverse(),
    [versions],
  )
  const excludedCount = versions.length - reviewedVersions.length

  const currentVersion = channel.version ?? null
  const rejection = promote.isError ? toApiError(promote.error) : null
  const serverAskedConfirmation =
    rejection?.code === RELEASE_CHANNEL_ERROR_CODES.promoteBackwardRequiresConfirm
  const needsConfirmation =
    isBackwardPromotion(currentVersion, target?.version) || serverAskedConfirmation
  const confirmationMatches = confirmSlug === channel.channel_slug
  const alreadyThere = target !== null && target.version === currentVersion

  const canSubmit =
    guard.allowed &&
    target !== null &&
    !alreadyThere &&
    (!needsConfirmation || confirmationMatches) &&
    !promote.isPending

  const submit = () => {
    if (target === null) return
    const trimmedNote = note.trim()
    stepUp.withFresh(CAPABILITIES.blueprintsPromote, () =>
      promote.mutate(
        {
          slug: channel.channel_slug,
          body: { version: target.version, note: trimmedNote === '' ? null : trimmedNote },
          // Solo viaja en un retroceso: mandarlo siempre vaciaría la confirmación de sentido.
          confirmSlug: needsConfirmation ? confirmSlug : undefined,
        },
        { onSuccess: onClose },
      ),
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Promover el canal «${channel.channel_name}»`}
      description="Cambia qué versión de este blueprint reciben quienes consumen el canal. No toca ninguna base de datos."
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={promote.isPending}>
            Cancelar
          </Button>
          <Button
            variant={needsConfirmation ? 'danger' : 'primary'}
            disabled={!canSubmit}
            isLoading={promote.isPending}
            aria-describedby={guard.describedBy}
            onClick={submit}
          >
            {needsConfirmation ? 'Retroceder el canal' : 'Promover'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Versión actual:{' '}
          {currentVersion ? (
            <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">{currentVersion}</code>
          ) : (
            <strong className="text-foreground">sin versión liberada</strong>
          )}
        </p>

        <Combobox<PromotableVersion>
          items={reviewedVersions}
          value={target}
          onChange={setTarget}
          itemToString={(item) => item.version}
          itemToKey={(item) => item.version}
          label="Versión destino"
          placeholder="Elegí una versión revisada"
          hint={
            excludedCount > 0
              ? `Solo versiones revisadas. ${excludedCount} versión(es) sin revisar no se pueden promover.`
              : 'Solo versiones revisadas.'
          }
        />

        {alreadyThere && (
          <p className="text-xs text-muted-foreground">
            El canal ya apunta a esa versión: no habría nada que cambiar.
          </p>
        )}

        <Textarea
          label="Motivo (opcional)"
          rows={2}
          maxLength={500}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          hint="Queda en el historial del canal."
        />

        {needsConfirmation && (
          <Callout tone="danger" title="Esto mueve el canal hacia atrás">
            <p>
              Las integraciones que piden <code>{channel.channel_slug}</code> empezarán a recibir
              {target ? ` ${target.version}` : ' una versión anterior'} en lugar de{' '}
              {currentVersion ?? 'la actual'}. Es una decisión de liberación: para confirmarla,
              escribí el identificador del canal.
            </p>
          </Callout>
        )}
        {needsConfirmation && (
          <Input
            label={`Escribí «${channel.channel_slug}» para confirmar`}
            value={confirmSlug}
            autoComplete="off"
            error={
              confirmSlug !== '' && !confirmationMatches
                ? `Debe ser exactamente «${channel.channel_slug}».`
                : undefined
            }
            onChange={(event) => setConfirmSlug(event.target.value)}
          />
        )}

        <CapabilityHint guard={guard} />

        {rejection && !serverAskedConfirmation && (
          <Callout tone="danger" title="No se pudo promover el canal">
            <p>{releaseChannelMessage(rejection.code) ?? rejection.message}</p>
          </Callout>
        )}
      </div>
    </Modal>
  )
}
