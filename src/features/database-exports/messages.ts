import { type ApiError } from '@/lib/api/errors'
import type {
  ExportCapabilities,
  ExportItemStatus,
  ExportJobPhase,
  ExportJobStatus,
} from '@/lib/contracts'

/**
 * Traducción de los códigos, motivos y estados del módulo de exportación a texto accionable.
 *
 * A diferencia de `database-clones` —donde el backend no expone un código estructurado y hay que
 * reconocer fragmentos del mensaje con expresiones regulares— aquí **todo se clasifica por
 * `detail.public_context.code`**, que es estable y viaja también en producción. El texto del
 * mensaje no se usa nunca para decidir: solo para mostrar.
 */

// ── Estados y fases ─────────────────────────────────────────────────────────────
export const EXPORT_STATUS_LABELS: Record<ExportJobStatus, string> = {
  pending: 'Listo para exportar',
  running: 'Exportando',
  succeeded: 'Completada',
  failed: 'Con errores',
  canceled: 'Cancelada',
  interrupted: 'Interrumpida',
}

/** Qué significa cada estado terminal para el artefacto, que es lo que el operador va a preguntar. */
export const EXPORT_STATUS_HINTS: Partial<Record<ExportJobStatus, string>> = {
  failed:
    'Al menos un objeto falló o la corrida abortó. Puede haber un artefacto parcial: revisá el reporte antes de usarlo.',
  canceled: 'La cancelación descartó el artefacto parcial. No hay nada que descargar.',
  interrupted:
    'El proceso del gateway se reinició a mitad de la corrida. No hay artefacto; hay que volver a crear el plan.',
}

/**
 * Las fases en el orden en que el worker las recorre. **No hay porcentaje** —el total real de bytes
 * no se sabe de antemano—, así que la barra es indeterminada y esto es lo que le da sentido: el
 * nombre de la fase y su posición.
 */
export const EXPORT_PHASE_ORDER: ExportJobPhase[] = [
  'preamble',
  'scope',
  'prerequisites',
  'structure',
  'data',
  'constraints',
  'bodies',
  'epilogue',
  'done',
]

export const EXPORT_PHASE_LABELS: Record<ExportJobPhase, string> = {
  preamble: 'Preámbulo',
  scope: 'Base de datos',
  prerequisites: 'Prerrequisitos',
  structure: 'Estructura',
  data: 'Datos',
  constraints: 'Restricciones',
  bodies: 'Cuerpos',
  epilogue: 'Epílogo',
  done: 'Terminado',
}

export const EXPORT_ITEM_STATUS_LABELS: Record<ExportItemStatus, string> = {
  ok: 'Exportado',
  error: 'Error',
  skipped: 'Omitido',
}

// ── Motivos del reporte por objeto (`GET .../items`) ─────────────────────────────
/**
 * `reason` es de **vocabulario cerrado** y nunca el mensaje del driver (podría incrustar valores de
 * filas). `unsupported_type:<tipo>` lleva el tipo pegado detrás, así que se resuelve por prefijo.
 */
const ITEM_REASON_LABELS: Record<string, string> = {
  structure_disabled: 'No se exportó su definición porque el DDL de objetos está en «NONE».',
  no_ddl_rendered: 'El gateway no pudo generar el DDL de este objeto.',
  all_columns_generated: 'Todas sus columnas son generadas: no hay nada que insertar.',
  manifest_only: 'Este formato no transporta estructura; el objeto figura solo en el manifiesto.',
  format_data_only: 'Este formato solo transporta datos.',
}

/** Texto amigable del `reason` de un ítem. Un código desconocido se muestra tal cual, sin romper. */
export function exportItemReasonLabel(reason: string | null): string | null {
  if (!reason) return null
  const known = ITEM_REASON_LABELS[reason]
  if (known) return known
  if (reason.startsWith('unsupported_type:')) {
    const type = reason.slice('unsupported_type:'.length)
    return `Hay un valor de tipo \`${type}\` que no se puede serializar.`
  }
  return reason
}

// ── Motivos del filtro de filas rechazado ───────────────────────────────────────
/**
 * Los `reason` de `export.invalid_row_filter`. Se usan tanto para el 422 del backend como para la
 * validación de cortesía del cliente (`logic.ts`), así que el texto es el mismo venga de donde
 * venga — que es justo lo que evita que el usuario crea que son dos errores distintos.
 *
 * El backend **no devuelve el filtro** en el error (regla anti-reflexión): el texto que se muestra
 * junto al campo sale del estado del propio formulario.
 */
const ROW_FILTER_REASON_LABELS: Record<string, string> = {
  empty_filter: 'El filtro está vacío.',
  too_long: 'El filtro supera la longitud máxima.',
  unparseable: 'No se pudo interpretar la condición.',
  multiple_statements: 'Escribí una sola condición, sin «;».',
  not_read_only: 'La condición no es de solo lectura.',
  subquery_not_allowed: 'No se admiten subconsultas, CTEs ni UNION.',
  foreign_table_reference: 'La condición solo puede referirse a esta tabla.',
  foreign_column_qualifier: 'Hay columnas calificadas con otra tabla o base.',
  comment_not_allowed:
    'El filtro no puede contener comentarios (`--`, `/* */`, y `#` en MySQL/MariaDB).',
}

/** Texto del motivo por el que un filtro `where` fue rechazado. `limit`, si viene, se interpola. */
export function rowFilterReasonLabel(reason: string, limit?: number): string {
  if (reason === 'too_long' && limit != null) {
    return `El filtro supera los ${limit} caracteres.`
  }
  return ROW_FILTER_REASON_LABELS[reason] ?? reason
}

// ── Clasificación de errores ────────────────────────────────────────────────────
export type ExportErrorAction =
  /** El plan o el artefacto ya no sirven: hay que arrancar de nuevo. */
  | 'startOver'
  /** El catálogo cambió: hay que volver a previsualizar con el mismo spec. */
  | 'repreview'
  /** Se intentó ejecutar sin haber previsualizado. */
  | 'previewFirst'
  /** Faltan dependencias: reintentar con `auto_resolve_dependencies`. */
  | 'resolveDependencies'
  /** Hay tablas con datos cuya estructura quedó fuera. */
  | 'addToStructure'
  /** La entrega en línea no cabe: pasar a descarga como archivo. */
  | 'switchToFileDelivery'
  /** La clave de idempotencia ya se usó: llevar al plan original. */
  | 'goToOriginalPlan'
  /** Hay un campo concreto que corregir en el formulario. */
  | 'fixField'
  /** Cuota o rate limit: esperar y reintentar. */
  | 'retryLater'
  /** El módulo está apagado en este gateway. */
  | 'moduleDisabled'
  | 'none'

const CODE_ACTIONS: Record<string, ExportErrorAction> = {
  'export.incompatible_option': 'fixField',
  'export.invalid_row_filter': 'fixField',
  'export.data_without_structure': 'addToStructure',
  'export.missing_dependencies': 'resolveDependencies',
  'export.inline_too_large': 'switchToFileDelivery',
  'export.fingerprint_changed': 'repreview',
  'export.artifact_expired': 'startOver',
  'export.artifact_consumed': 'startOver',
  'export.already_executed': 'startOver',
  'export.no_artifact': 'startOver',
  'export.not_previewed': 'previewFirst',
  'export.not_ready': 'none',
  'export.not_cancellable': 'none',
  'export.quota_exceeded': 'retryLater',
  'export.idempotency_conflict': 'goToOriginalPlan',
  'export.disabled': 'moduleDisabled',
  'export.scope_not_allowed': 'none',
  'export.not_owner': 'none',
}

/**
 * Decide el CTA de recuperación. **El `code` manda sobre el status y sobre el texto**: el mismo 409
 * puede ser una cuota agotada (esperar), un plan ya usado (empezar de nuevo) o una huella cambiada
 * (volver a previsualizar), y confundirlos manda al usuario a hacer lo contrario de lo que toca.
 */
export function classifyExportError(error: ApiError): ExportErrorAction {
  if (error.code) {
    const action = CODE_ACTIONS[error.code]
    if (action) return action
  }
  if (error.status === 429) return 'retryLater'
  // Sin código no se puede distinguir un plan vencido de un artefacto vencido: empezar de nuevo
  // cubre los dos y no promete nada que no se pueda cumplir.
  if (error.status === 410) return 'startOver'
  return 'none'
}

/** Etiqueta del botón de recuperación. `null` = este fallo no tiene ninguna acción que ofrecer. */
export const EXPORT_ACTION_LABELS: Record<ExportErrorAction, string | null> = {
  startOver: 'Volver a exportar',
  repreview: 'Volver a previsualizar',
  previewFirst: 'Previsualizar',
  resolveDependencies: 'Agregar las dependencias',
  addToStructure: 'Agregar esas tablas a la estructura',
  switchToFileDelivery: 'Cambiar a descarga como archivo',
  goToOriginalPlan: 'Ir al plan original',
  fixField: null,
  retryLater: null,
  moduleDisabled: null,
  none: null,
}

/** Texto de apoyo que explica POR QUÉ hay que hacer eso, cuando no es evidente. */
export const EXPORT_ACTION_HINTS: Partial<Record<ExportErrorAction, string>> = {
  startOver:
    'Un plan es de un solo uso y vence a las 24 h; el artefacto, 30 minutos después de terminar. Crear un plan nuevo es barato.',
  repreview:
    'El esquema cambió entre la confirmación y la ejecución, así que la selección congelada puede describir objetos que ya no existen. Un reintento sin volver a previsualizar da el mismo error.',
  retryLater:
    'No es un error de configuración: hay trabajo en curso o en cola. El mismo plan sirve dentro de un rato.',
  moduleDisabled: 'La exportación está deshabilitada en este gateway.',
}

/**
 * Explicación específica del código, para acompañar al `detail.msg` del backend con el contexto que
 * el mensaje no lleva. Se separa de los `HINTS` de la acción porque varios códigos distintos
 * comparten acción pero no explicación.
 */
const CODE_HINTS: Record<string, string> = {
  'export.artifact_consumed':
    'El artefacto ya se descargó una vez y se borró en el momento de la entrega. No se puede volver a bajar.',
  'export.artifact_expired':
    'El plazo se cumplió: los planes duran 24 h y los artefactos 30 minutos desde que el job termina.',
  'export.already_executed':
    'Este plan ya se usó. Volver a previsualizarlo reescribiría la selección congelada y el manifiesto dejaría de describir el archivo que se entregó.',
  'export.no_artifact': 'La corrida terminó sin producir ningún archivo.',
  'export.not_ready': 'La exportación todavía está en curso.',
  'export.not_cancellable': 'La exportación ya terminó: no hay nada que cancelar.',
  'export.not_owner': 'Esta exportación la creó otro administrador.',
  'export.scope_not_allowed':
    'El destino es la propia base de metadatos del gateway y no se puede exportar.',
  'export.inline_too_large':
    'El artefacto no se trunca nunca: un script cortado que alguien pega y ejecuta es peor que un fallo.',
  'export.disabled':
    'El módulo está apagado en la configuración del gateway. Ver un job en curso y cancelarlo sigue funcionando.',
}

/** Explicación adicional del fallo, o `null` si el mensaje del backend ya se explica solo. */
export function exportErrorHint(error: ApiError): string | null {
  return (error.code ? CODE_HINTS[error.code] : undefined) ?? null
}

// ── Diagnóstico ─────────────────────────────────────────────────────────────────
/**
 * Registra un fallo del módulo en consola con su `X-Request-ID`, que es **la única forma de que el
 * backend correlacione un job fallido con su traza**: el `error` del job es deliberadamente acotado
 * y nunca trae el mensaje del motor.
 *
 * Un `export.incompatible_option` recibe además un aviso aparte: el servidor evalúa exactamente la
 * misma matriz que el cliente, así que si ese 422 llega es porque el evaluador de `logic.ts` dejó
 * pasar una combinación — un bug propio, no un error del usuario.
 */
export function logExportFailure(error: ApiError, context: string): void {
  if (error.code === 'export.incompatible_option') {
    console.error(
      `[database-exports] La matriz del cliente dejó pasar una combinación que el servidor rechazó (${context}). Es un bug del evaluador, no del usuario.`,
      {
        field: error.exportContext?.field,
        allowed: error.exportContext?.allowed,
        requestId: error.requestId,
      },
    )
    return
  }
  console.error(`[database-exports] ${context}: ${error.message}`, {
    code: error.code,
    status: error.status,
    requestId: error.requestId,
  })
}

/**
 * Avisa en consola si el backend declara códigos de error que este archivo no traduce. El contrato
 * expone `capabilities.error_codes` justamente para esto: que el mapa de mensajes falle de forma
 * ruidosa —en el log, no en la cara del usuario— cuando el backend agrega uno nuevo.
 */
export function warnAboutUnhandledErrorCodes(capabilities: ExportCapabilities): string[] {
  const unhandled = capabilities.error_codes.filter((code) => !(code in CODE_ACTIONS))
  if (unhandled.length > 0) {
    console.error(
      '[database-exports] El backend declara códigos de error que la UI no traduce:',
      unhandled,
    )
  }
  return unhandled
}
