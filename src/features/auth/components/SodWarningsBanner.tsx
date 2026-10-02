import { Callout } from '@/components/ui'
import { useSession } from '../hooks/use-session'
import { SOD_RULE_EXPLANATION, sodWarningCopy } from '../separation-of-duties'

/**
 * Aviso PERSISTENTE de separación de deberes para la persona de la sesión
 * (`/auth/me.sod_warnings`, v29 §8.5). Lo monta el layout, así que se ve en toda la app —«Mi
 * cuenta» incluida— mientras la cuenta combine funciones que deberían estar separadas.
 *
 * No se puede cerrar a propósito: no es una notificación sino un estado de la cuenta, y la única
 * forma de que desaparezca es resolverlo (separar las funciones). Un aviso descartable se descarta
 * una vez y nunca más se lee.
 *
 * Sin avisos (el caso normal, o un backend anterior que no manda el campo) no pinta nada.
 */
export function SodWarningsBanner() {
  const { admin } = useSession()
  const warnings = admin?.sod_warnings ?? []
  if (warnings.length === 0) return null

  return (
    <div className="mb-6 flex flex-col gap-3">
      {warnings.map((warning) => {
        const copy = sodWarningCopy(warning)
        return (
          <Callout key={`${warning.rule}:${warning.status}`} tone={copy.tone} title={copy.title}>
            <p>{copy.body}</p>
            <p className="mt-1 text-muted-foreground">{SOD_RULE_EXPLANATION}</p>
          </Callout>
        )
      })}
    </div>
  )
}
