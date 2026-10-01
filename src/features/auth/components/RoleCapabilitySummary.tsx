import { Link } from 'react-router-dom'
import { Badge, TrashIcon } from '@/components/ui'
import type { CapabilityDescriptor } from '@/lib/contracts'
import { cn } from '@/lib/utils'
import {
  diffCapabilities,
  isDestructive,
  roleCapabilityIds,
  sortByRisk,
  summarizeLabels,
} from '../authz-model'

/** Ruta de la matriz completa de roles y capacidades. */
export const ROLES_MATRIX_PATH = '/gateway-users?tab=roles'

interface RoleCapabilitySummaryProps {
  role: string
  /** `undefined` = el catálogo no está disponible (backend viejo o error al pedirlo). */
  catalog: readonly CapabilityDescriptor[] | undefined
  isLoading?: boolean
  /**
   * Rol contra el que comparar (en un permiso por alcance, el rol base): el resumen pasa a decir
   * qué suma o qué pierde respecto de ése, que es lo que cambia la decisión.
   */
  compareTo?: string
  /** Muestra el enlace «Ver todas las capacidades» a la matriz. */
  linkToMatrix?: boolean
  className?: string
  id?: string
}

/**
 * Qué otorga un rol, en una o dos líneas, debajo del selector de rol.
 *
 * Reemplaza a las descripciones escritas a mano que tenían los formularios, que llegaron a mentir
 * (decían que `operator` puede «aplicar», cuando `blueprints.apply` es de `owner`). Esto sale del
 * catálogo del servidor: si no hay catálogo, lo dice, y **no inventa nada**.
 */
export function RoleCapabilitySummary({
  role,
  catalog,
  isLoading = false,
  compareTo,
  linkToMatrix = false,
  className,
  id,
}: RoleCapabilitySummaryProps) {
  const textClass = cn('text-xs text-muted-foreground', className)

  if (!catalog) {
    return (
      <p id={id} className={textClass}>
        {isLoading ? 'Cargando qué incluye este rol…' : 'No se pudo cargar qué incluye este rol.'}
      </p>
    )
  }

  const granted = roleCapabilityIds(catalog, role)
  const labels = (ids: string[]) => sortByRisk(ids, catalog).map((row) => row.label)
  const link = linkToMatrix ? (
    <>
      {' '}
      <Link to={ROLES_MATRIX_PATH} className="font-medium text-primary hover:underline">
        Ver todas las capacidades
      </Link>
    </>
  ) : null

  if (compareTo !== undefined) {
    const diff = diffCapabilities(roleCapabilityIds(catalog, compareTo), granted)
    const gainsDestructive = sortByRisk(diff.gained, catalog).some(isDestructive)
    const losesDestructive = sortByRisk(diff.lost, catalog).some(isDestructive)
    if (diff.gained.length === 0 && diff.lost.length === 0) {
      return (
        <p id={id} className={textClass}>
          Igual que el rol base {compareTo}.{link}
        </p>
      )
    }
    return (
      <p id={id} className={textClass}>
        {/* El color solo no alcanza para avisar (WCAG 1.4.1): la marca lleva icono y texto, y
            cuenta tanto lo destructivo que se SUMA como lo que se pierde. */}
        {(gainsDestructive || losesDestructive) && (
          <>
            <Badge tone="error" className="px-2 py-0">
              <TrashIcon className="h-3 w-3" />
              Incluye destructivas
            </Badge>{' '}
          </>
        )}
        {diff.gained.length > 0 && (
          <span className={gainsDestructive ? 'text-warning' : undefined}>
            Respecto de {compareTo} suma {diff.gained.length}:{' '}
            {summarizeLabels(labels(diff.gained))}.{' '}
          </span>
        )}
        {diff.lost.length > 0 && (
          <span className={losesDestructive ? 'text-warning' : undefined}>
            Respecto de {compareTo} pierde {diff.lost.length}: {summarizeLabels(labels(diff.lost))}.
          </span>
        )}
        {link}
      </p>
    )
  }

  const excluded = catalog.filter((row) => !granted.includes(row.id)).map((row) => row.id)
  return (
    <p id={id} className={textClass}>
      Otorga {granted.length} de {catalog.length}.
      {excluded.length > 0 && <> No incluye: {summarizeLabels(labels(excluded))}.</>}
      {link}
    </p>
  )
}
