import type { BadgeTone, StatusLegendItem } from '@/components/ui'
import type { CapabilityDescriptor } from '@/lib/contracts'
import { isDestructive } from './authz-model'

/**
 * Las marcas de una capacidad y lo que significan. Vive aparte del componente para que la leyenda
 * (`CAPABILITY_FLAG_LEGEND`) y las pantallas compartan el MISMO texto.
 *
 * `mutates` y `discloses` son ejes INDEPENDIENTES (ver `capabilityDescriptorSchema`): una
 * capacidad que no modifica nada puede divulgar, y se marca.
 */
export type CapabilityFlagKey =
  | 'destructive'
  | 'mutates'
  | 'discloses'
  | 'stepUp'
  | 'agent'
  | 'readOnly'

export const CAPABILITY_FLAGS: Record<
  CapabilityFlagKey,
  { label: string; tone: BadgeTone; description: string }
> = {
  destructive: {
    label: 'Destructiva',
    tone: 'error',
    description: 'Borra o cambia algo en un motor real; no se deshace.',
  },
  mutates: {
    label: 'Modifica',
    tone: 'warning',
    description: 'Crea o cambia algo en el inventario o en un motor, sin borrar.',
  },
  discloses: {
    label: 'Divulga datos',
    tone: 'warning',
    description: 'Expone datos o credenciales aunque no modifique nada.',
  },
  stepUp: {
    label: 'Pedirá reautenticación',
    tone: 'info',
    description: 'Va a pedir tu contraseña otra vez; hoy todavía no se exige.',
  },
  agent: {
    label: 'Usable por agentes',
    tone: 'neutral',
    description: 'Puede incluirse en un token del servidor MCP.',
  },
  readOnly: {
    label: 'Solo lectura',
    tone: 'neutral',
    description: 'Solo consulta: no modifica ni expone datos de las bases.',
  },
}

/** Qué marcas lleva una capacidad. `compact` = solo las de riesgo. */
export function capabilityFlagKeys(
  capability: CapabilityDescriptor,
  compact = false,
): CapabilityFlagKey[] {
  const keys: CapabilityFlagKey[] = []
  if (isDestructive(capability)) keys.push('destructive')
  else if (capability.mutates) keys.push('mutates')
  if (capability.discloses) keys.push('discloses')
  if (compact) return keys
  if (!capability.mutates && !capability.discloses) keys.push('readOnly')
  if (capability.requires_step_up) keys.push('stepUp')
  if (capability.agent_allowed) keys.push('agent')
  return keys
}

/** La leyenda de las marcas, para una `StatusLegend` puesta una vez sobre la matriz. */
export const CAPABILITY_FLAG_LEGEND: StatusLegendItem[] = (
  ['destructive', 'mutates', 'discloses', 'readOnly', 'stepUp', 'agent'] as const
).map((key) => ({ key, ...CAPABILITY_FLAGS[key] }))
