import { useState } from 'react'
import { Button, Callout, Checkbox, CopyIcon, IconButton } from '@/components/ui'
import { isClipboardAvailable } from '@/lib/utils'
import { useToast } from '@/lib/toast/use-toast'

interface OneTimeSecretPanelProps {
  /** Qué es el secreto, en palabras del dominio: «token de invitación», «token de agente». */
  secretLabel: string
  /** El secreto en claro. Viaja una sola vez: este componente es su ÚNICA oportunidad de salir. */
  secret: string
  /** Texto ya formateado del vencimiento, o `null` si el secreto no vence. */
  expiresLabel: string | null
  /** Qué pasa si se pierde. Concreto y en términos de consecuencia, no de mecanismo. */
  consequence: string
  /** Instrucción de entrega: a quién y por qué canal. */
  handoffHint: string
  confirmLabel: string
  onDone: () => void
}

/**
 * Entrega de un secreto de UN SOLO USO (token de invitación §2.3, bearer de agente §3).
 *
 * Las tres decisiones de diseño que lo separan de un panel informativo cualquiera:
 *
 * 1. **El botón de cerrar está detrás de una casilla explícita.** No es ceremonia: el gateway no
 *    tiene sustrato de notificación —ni SMTP, ni webhook, ni cola—, el secreto no se envía por
 *    ningún canal y no existe endpoint que lo vuelva a mostrar. Cerrar esto por reflejo deja una
 *    cuenta o un token emitidos, ocupando su fila en el listado, y completamente inservibles.
 * 2. **Se muestra en claro, sin máscara ni botón de «mostrar».** Ocultar un secreto que el
 *    operador TIENE que transmitir solo agrega un clic entre él y lo único que vino a hacer. La
 *    máscara protege contra miradas de costado en un secreto persistente; acá el secreto es
 *    efímero y esta es su única aparición.
 * 3. **La disponibilidad del portapapeles se comprueba ANTES**, no en un `catch`. Si no hay
 *    portapapeles, el botón queda deshabilitado y con el motivo a la vista, en vez de fallar
 *    después de que el usuario creyó haber copiado.
 */
export function OneTimeSecretPanel({
  secretLabel,
  secret,
  expiresLabel,
  consequence,
  handoffHint,
  confirmLabel,
  onDone,
}: OneTimeSecretPanelProps) {
  const toast = useToast()
  const [acknowledged, setAcknowledged] = useState(false)
  const clipboardReady = isClipboardAvailable()

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(secret)
      toast.success(`${secretLabel} copiado al portapapeles`)
    } catch {
      toast.error('No se pudo copiar al portapapeles', 'Selecciónalo y cópialo a mano.')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Callout tone="warning" title={`Este ${secretLabel} se muestra UNA sola vez`}>
        <p>{consequence}</p>
        <p className="mt-1">
          El gateway no lo envía por correo ni por ningún otro canal, y no hay forma de volver a
          consultarlo.
        </p>
      </Callout>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">{secretLabel}</span>
        <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2">
          <code className="flex-1 select-all break-all font-mono text-sm text-foreground">
            {secret}
          </code>
          <IconButton
            type="button"
            label={`Copiar el ${secretLabel}`}
            icon={<CopyIcon />}
            variant="outline"
            size="icon-sm"
            disabled={!clipboardReady}
            onClick={() => void handleCopy()}
          />
        </div>
        {!clipboardReady && (
          <p className="text-xs text-muted-foreground">
            El portapapeles no está disponible en este navegador: selecciónalo y cópialo a mano.
          </p>
        )}
      </div>

      {expiresLabel && (
        <p className="text-xs text-muted-foreground">
          Vence el <span className="font-medium text-foreground">{expiresLabel}</span>.
        </p>
      )}

      <p className="text-sm text-muted-foreground">{handoffHint}</p>

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <Checkbox
          label="Ya lo copié y lo entregué"
          hint="Al cerrar, este valor desaparece para siempre."
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
        <div className="flex justify-end">
          <Button type="button" onClick={onDone} disabled={!acknowledged}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
