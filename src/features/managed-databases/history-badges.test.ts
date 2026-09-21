import { describe, expect, it } from 'vitest'
import {
  hasUnknownDirection,
  historyActorLabel,
  historyDirectionSpec,
  historyStatusSpec,
  historyVersionSpec,
  type HistoryBadgeFacts,
} from './history-badges'

/** Fila «antigua»: la que existía antes de v25, con TODOS los campos nuevos en `null`. */
const legacy: HistoryBadgeFacts = {
  status: 'applied',
  direction: null,
  version: null,
  model_migration_id: null,
  actor_type: null,
  actor_id: null,
  actor_username: null,
}

describe('historyStatusSpec', () => {
  it('traduce el enum y NO reutiliza la palabra de la dirección', () => {
    // «Aplicada» ya es la etiqueta de `direction: 'up'`. Un rollback correcto llega acá como
    // `status: 'applied'` + `direction: 'down'`: si las dos columnas dijeran «Aplicada» habría
    // que leerlas juntas para saber qué pasó, que es el error que v25 vino a cerrar.
    expect(historyStatusSpec('applied').label).toBe('Exitosa')
    expect(historyStatusSpec('failed').label).toBe('Fallida')
    expect(historyStatusSpec('applied').label).not.toBe(historyDirectionSpec('up').label)
  })

  it('mantiene el color: verde el éxito, rojo el fallo', () => {
    expect(historyStatusSpec('applied').tone).toBe('success')
    expect(historyStatusSpec('failed').tone).toBe('error')
  })
})

describe('historyDirectionSpec', () => {
  it('distingue apply de rollback', () => {
    expect(historyDirectionSpec('up').label).toBe('Aplicada')
    expect(historyDirectionSpec('down').label).toBe('Revertida')
  })

  it('🔴 NO infiere `up` cuando la dirección no está registrada', () => {
    // Es el motivo por el que este módulo existe. Antes de v25 apply y rollback escribían los dos
    // `status: "applied"`, así que ese `null` significa literalmente «no sabemos si esto sigue
    // vigente». Traducirlo a «Aplicada» devuelve la UI al estado anterior al incidente.
    const spec = historyDirectionSpec(null)
    expect(spec.label).toBe('Sin registrar')
    expect(spec.label).not.toBe(historyDirectionSpec('up').label)
    expect(spec.key).toBe('unknown')
    // Y se pinta: un hueco en la celda se leería como «no aplica».
    expect(spec.label.length).toBeGreaterThan(0)
  })

  it('`undefined` se trata igual que `null`: el campo es opcional en el contrato', () => {
    expect(historyDirectionSpec(undefined).key).toBe('unknown')
  })
})

describe('historyVersionSpec', () => {
  it('marca la versión huérfana sin ocultar ni atenuar la fila, y sin enlace', () => {
    // Con la FK en `null` (`ON DELETE SET NULL`), `version` y `applied_checksum` son lo ÚNICO que
    // queda del evento: es justo la fila que hay que poder leer.
    const spec = historyVersionSpec({
      status: 'applied',
      version: '0007',
      model_migration_id: null,
    })
    expect(spec.text).toBe('0007')
    expect(spec.badge?.label).toBe('Versión borrada del blueprint')
    expect(spec.linkable).toBe(false)
  })

  it('con versión indeterminable muestra «—» y lo dice', () => {
    const spec = historyVersionSpec({ status: 'applied', version: null, model_migration_id: 12 })
    expect(spec.text).toBe('—')
    expect(spec.note).toBe('La versión de este evento no se pudo determinar')
    expect(spec.badge).toBeNull()
  })

  it('una fila antigua junta las dos carencias sin romperse', () => {
    const spec = historyVersionSpec(legacy)
    expect(spec.text).toBe('—')
    expect(spec.badge?.label).toBe('Versión borrada del blueprint')
    expect(spec.note).toBe('La versión de este evento no se pudo determinar')
    expect(spec.linkable).toBe(false)
  })

  it('la versión viva es enlazable y no lleva insignia', () => {
    const spec = historyVersionSpec({ status: 'applied', version: '0012', model_migration_id: 12 })
    expect(spec).toEqual({ text: '0012', badge: null, note: null, linkable: true })
  })
})

describe('historyActorLabel', () => {
  it('prefiere el nombre de usuario', () => {
    expect(
      historyActorLabel({
        status: 'applied',
        actor_username: 'ana',
        actor_type: 'admin',
        actor_id: 3,
      }),
    ).toBe('ana')
  })

  it('compone `tipo#id` cuando no hay nombre', () => {
    expect(historyActorLabel({ status: 'applied', actor_type: 'agent', actor_id: 9 })).toBe(
      'agent#9',
    )
  })

  it('no tira el dato que SÍ está cuando el actor viene a medias', () => {
    // Un `actor_type` suelto sigue diciendo algo («agent», «admin»); descartarlo por no poder
    // componer `tipo#id` pierde información que estaba disponible.
    expect(historyActorLabel({ status: 'applied', actor_type: 'agent' })).toBe('agent')
    expect(historyActorLabel({ status: 'applied', actor_id: 9 })).toBe('#9')
  })

  it('cae a «—» en una fila antigua, sin explotar', () => {
    expect(historyActorLabel(legacy)).toBe('—')
  })
})

describe('hasUnknownDirection', () => {
  it('detecta una sola fila sin dirección entre muchas', () => {
    // El aviso es de lectura GLOBAL: mientras haya un evento sin dirección, el historial entero
    // deja de ser prueba de vigencia.
    expect(
      hasUnknownDirection([
        { status: 'applied', direction: 'up' },
        { status: 'applied', direction: 'down' },
        legacy,
      ]),
    ).toBe(true)
  })

  it('no avisa cuando todas están registradas', () => {
    expect(
      hasUnknownDirection([
        { status: 'applied', direction: 'up' },
        { status: 'failed', direction: 'down' },
      ]),
    ).toBe(false)
    expect(hasUnknownDirection([])).toBe(false)
  })

  it('el campo ausente cuenta como desconocido', () => {
    expect(hasUnknownDirection([{ status: 'applied' }])).toBe(true)
  })
})
