import { Link } from 'react-router-dom'
import type { CapabilityDescriptor } from '@/lib/contracts'
import { cn } from '@/lib/utils'
import {
  diffCapabilities,
  isDestructive,
  lostEnforcementNote,
  roleCapabilityIds,
  sortByRisk,
  summarizeLabels,
} from '../authz-model'
import { DestructiveMarks } from './EffectiveAccessPanel'

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
  const labels = (ids: readonly string[]) => sortByRisk(ids, catalog).map((row) => row.label)
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
    if (diff.gained.length === 0 && diff.lost.length === 0) {
      return (
        <p id={id} className={textClass}>
          Igual que el rol base {compareTo}.{link}
        </p>
      )
    }
    return (
      <p id={id} className={textClass}>
        {/* Mismas marcas y colores que `EffectiveAccessPanel`: sumar una destructiva es rojo,
            quitarla es neutro. Y el «pierde» lleva la misma salvedad de qué se aplica hoy. */}
        <DestructiveMarks diff={diff} catalog={catalog} />{' '}
        {diff.gained.length > 0 && (
          <span className={gainsDestructive ? 'text-error' : 'text-warning'}>
            Respecto de {compareTo} suma {diff.gained.length}:{' '}
            {summarizeLabels(labels(diff.gained))}.{' '}
          </span>
        )}
        {diff.lost.length > 0 && (
          <span>
            Respecto de {compareTo} pierde {diff.lost.length}: {summarizeLabels(labels(diff.lost))}
            {lostEnforcementNote(diff.lost, labels, catalog)}.
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
