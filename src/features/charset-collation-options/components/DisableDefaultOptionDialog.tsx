import { useState } from 'react'
import { Button, Combobox, Modal } from '@/components/ui'
import type { CharsetCollationOptionOut, EngineFamily } from '@/lib/contracts'
import { formatOptionLabel } from '../logic'
import { useUpdateCharsetCollationOption } from '../hooks/use-charset-collation-options'

export interface DisableDefaultOptionDialogProps {
  /** La combinación que el operador intenta deshabilitar. `null` = diálogo cerrado. */
  option: CharsetCollationOptionOut | null
  /** Otras combinaciones habilitadas de la MISMA familia, candidatas a sugerida. */
  alternatives: CharsetCollationOptionOut[]
  onClose: () => void
}

const FAMILY_LABELS: Record<EngineFamily, string> = {
  mysql: 'MySQL / MariaDB',
  postgresql: 'PostgreSQL',
}

type PendingAction = 'choose-other' | 'disable-without-default' | null

/**
 * El backend exige que la combinación sugerida (`is_default`) esté habilitada: deshabilitar la
 * sugerida sin resolver esto primero da 422. Este diálogo se abre TANTO cuando el cliente
 * anticipa el conflicto (antes de enviar nada) como cuando el 422 llega igual (otro admin cambió
 * el estado mientras tanto).
 */
export function DisableDefaultOptionDialog({
  option,
  alternatives,
  onClose,
}: DisableDefaultOptionDialogProps) {
  const update = useUpdateCharsetCollationOption()
  const [selected, setSelected] = useState<CharsetCollationOptionOut | null>(null)
  const [action, setAction] = useState<PendingAction>(null)

  const handleClose = () => {
    setSelected(null)
    setAction(null)
    onClose()
  }

  const confirmChooseOther = () => {
    if (!option || !selected) return
    setAction('choose-other')
    // El backend desmarca la sugerida anterior en silencio al fijar una nueva: no hace falta
    // enviar `is_default:false` para `option` antes del segundo PATCH.
    update.mutate(
      { id: selected.id, body: { is_default: true } },
      {
        onSuccess: () => {
          update.mutate({ id: option.id, body: { enabled: false } }, { onSuccess: handleClose })
        },
      },
    )
  }

  const confirmDisableWithoutDefault = () => {
    if (!option) return
    setAction('disable-without-default')
    update.mutate(
      { id: option.id, body: { enabled: false, is_default: false } },
      { onSuccess: handleClose },
    )
  }

  const familyLabel = option ? FAMILY_LABELS[option.engine_family] : ''

  return (
    <Modal
      open={option !== null}
      onClose={update.isPending ? () => undefined : handleClose}
      title="No se puede deshabilitar la combinación sugerida"
      description={
        option
          ? `«${formatOptionLabel(option)}» es la combinación sugerida de ${familyLabel}. Una combinación marcada como sugerida debe estar habilitada.`
          : undefined
      }
      size="md"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <p className="text-sm font-medium text-foreground">
            Elegir otra combinación como sugerida primero
          </p>
          {alternatives.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No hay otra combinación habilitada en esta familia para marcar como sugerida.
            </p>
          ) : (
            <>
              <Combobox<CharsetCollationOptionOut>
                items={alternatives}
                value={selected}
                onChange={setSelected}
                itemToString={(item) => formatOptionLabel(item)}
                itemToKey={(item) => item.id}
                label="Nueva combinación sugerida"
                placeholder="Elegí una combinación habilitada"
                disabled={update.isPending}
              />
              <div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!selected || update.isPending}
                  isLoading={update.isPending && action === 'choose-other'}
                  onClick={confirmChooseOther}
                >
                  Elegir otra combinación como sugerida primero
                </Button>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <p className="text-sm font-medium text-foreground">
            Deshabilitarla y dejar la familia sin sugerencia
          </p>
          <p className="text-xs text-muted-foreground">
            El selector de creación de bases de {familyLabel || 'esta familia'} no preseleccionará
            ninguna combinación hasta que marques otra como sugerida.
          </p>
          <div>
            <Button
              type="button"
              variant="ghost"
              disabled={update.isPending}
              isLoading={update.isPending && action === 'disable-without-default'}
              onClick={confirmDisableWithoutDefault}
            >
              Deshabilitarla y dejar la familia sin sugerencia
            </Button>
          </div>
        </div>

        <div className="flex justify-end border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={handleClose} disabled={update.isPending}>
            Cancelar
          </Button>
        </div>
      </div>
    </Modal>
  )
}
