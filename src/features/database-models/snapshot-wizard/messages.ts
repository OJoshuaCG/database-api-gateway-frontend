import type { ManualLayoutViolation } from '@/lib/api/errors'
import type { SkippedTable } from '@/lib/contracts'

/**
 * Traducción de los códigos del backend a texto accionable en español (Plan 09 §3). Cubre los
 * motivos de `skipped_tables` (respuesta de creación) y las `violations` del layout manual (solo
 * en desarrollo del backend).
 */

const SKIPPED_REASON_TEXT: Record<string, string> = {
  no_primary_key: 'Sin clave primaria: los datos-semilla requieren PK (upsert + rollback).',
  no_rows: 'No tenía filas que sembrar (informativo).',
  oversize_rows: 'Superó el máximo de filas permitido para datos-semilla.',
  oversize_bytes: 'Superó el máximo de bytes permitido para datos-semilla.',
  invalid_identifier: 'El nombre no pasó la validación anti-inyección.',
}

/** Texto accionable para una tabla omitida. Maneja el sufijo dinámico `unsupported_type:<tipo>`. */
export function describeSkippedReason(reason: SkippedTable['reason']): string {
  if (reason.startsWith('unsupported_type:')) {
    const type = reason.slice('unsupported_type:'.length)
    return `Contiene un valor de tipo no soportado${type ? ` (${type})` : ''}. Se omitió.`
  }
  return SKIPPED_REASON_TEXT[reason] ?? reason
}

/** Texto accionable para una violación del layout manual, incorporando sus campos extra. */
export function describeViolation(violation: ManualLayoutViolation): string {
  const { reason } = violation
  switch (reason) {
    case 'mixed_schema_and_data':
      return 'El bucket mezcla esquema y datos. Sepáralos en versiones distintas.'
    case 'empty_bucket':
      return 'La versión está vacía. Añade objetos o elimínala.'
    case 'duplicate_assignment':
      return `El objeto está en dos versiones${
        violation.also_in_version ? ` (también en la v${violation.also_in_version})` : ''
      }. Déjalo en una sola.`
    case 'unassigned_object':
      return 'Objeto seleccionado sin asignar a ninguna versión. Asígnalo.'
    case 'unknown_object':
      return 'El objeto no existe en el snapshot. Quítalo.'
    case 'unassigned_data_table':
      return 'Tabla de datos sin asignar a un bucket de datos. Asígnala.'
    case 'unknown_data_table':
      return 'La tabla de datos no existe en el snapshot. Quítala.'
    case 'dependency_in_later_version':
      return `Depende de ${violation.depends_on ? `«${violation.depends_on}»` : 'un objeto'}${
        violation.dependency_version ? ` (v${violation.dependency_version})` : ''
      }, que está en una versión posterior. Muévelo después.`
    case 'prerequisite_after_a_table':
      return `Un prerrequisito quedó después de una tabla${
        violation.must_be_at_most ? ` (muévelo a la versión ≤ ${violation.must_be_at_most})` : ''
      }.`
    case 'must_be_after_all_tables':
      return `Debe ir después de todas las tablas${
        violation.must_be_at_least ? ` (versión ≥ ${violation.must_be_at_least})` : ''
      }.`
    case 'schema_after_data':
      return `Hay esquema después de datos. Los datos van al final${
        violation.first_data_version ? ` (después de la v${violation.first_data_version})` : ''
      }.`
    case 'data_table_structure_not_included':
      return 'La estructura de esta tabla de datos no está incluida en la selección. Inclúyela.'
    case 'data_before_table_structure':
      return `Los datos van antes que la estructura de su tabla${
        violation.table_structure_version ? ` (v${violation.table_structure_version})` : ''
      }. Muévelos después.`
    default:
      return reason
  }
}

/** Etiqueta corta del objeto/versión implicado en una violación, para anclar el mensaje. */
export function violationTarget(violation: ManualLayoutViolation): string | undefined {
  const parts: string[] = []
  if (violation.version) parts.push(`v${violation.version}`)
  if (violation.object) parts.push(violation.object)
  return parts.length > 0 ? parts.join(' · ') : undefined
}
