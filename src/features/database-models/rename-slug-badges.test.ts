import { describe, expect, it } from 'vitest'
import { renameSlugBadge, renameSlugBlocks, sortBlockersFirst } from './rename-slug-badges'

describe('renameSlugBadge', () => {
  it('cubre los cuatro valores del enum con etiqueta propia', () => {
    expect(renameSlugBadge('rename').label).toBe('Se renombra')
    expect(renameSlugBadge('skip').label).toBe('Sin tabla que renombrar')
    expect(renameSlugBadge('conflict').label).toBe('Ya existe el destino')
    expect(renameSlugBadge('unreachable').label).toBe('No se pudo leer')
  })

  it('solo `conflict` y `unreachable` abortan la operación entera', () => {
    // Es la regla que justifica que el veredicto del asistente sea binario y no por fila: el
    // gateway apunta a UN nombre de tabla, así que medio parque renombrado deja a la otra mitad
    // con su contabilidad huérfana.
    expect(renameSlugBlocks('conflict')).toBe(true)
    expect(renameSlugBlocks('unreachable')).toBe(true)
    expect(renameSlugBlocks('rename')).toBe(false)
    expect(renameSlugBlocks('skip')).toBe(false)
  })

  it('`unreachable` NO se pinta como error: es fail-closed, no un conflicto probado', () => {
    // «No se pudo comprobar que no la tenga» no es «la tiene». Pintarlo en rojo mandaría al
    // operador a buscar una tabla que puede no existir. Tampoco es `neutral`: bloquea igual, y un
    // blocker con pinta de dato inocuo no se lee.
    expect(renameSlugBadge('unreachable').tone).toBe('warning')
    expect(renameSlugBadge('conflict').tone).toBe('error')
    expect(renameSlugBadge('skip').tone).toBe('neutral')
  })

  it('una acción fuera del enum bloquea, que es el único default seguro', () => {
    // Las filas de los `public_context` no pasan por Zod (`action` es `string`), así que un valor
    // nuevo del backend llega hasta acá. Tratarlo como inocuo lo dejaría pasar sin que nadie lo lea.
    const unknown = renameSlugBadge('quantum_rename')
    expect(unknown.blocking).toBe(true)
    expect(unknown.label).toBe('Acción desconocida')
    expect(renameSlugBlocks('')).toBe(true)
  })
})

describe('sortBlockersFirst', () => {
  it('sube los bloqueantes y conserva el orden del backend dentro de cada grupo', () => {
    const rows = [
      { id: 1, action: 'rename' },
      { id: 2, action: 'conflict' },
      { id: 3, action: 'skip' },
      { id: 4, action: 'unreachable' },
      { id: 5, action: 'rename' },
    ]

    expect(sortBlockersFirst(rows).map((row) => row.id)).toEqual([2, 4, 1, 3, 5])
  })

  it('no muta la lista original', () => {
    // La tabla se pinta desde `plan.databases`, que es el objeto que vive en estado: ordenarlo en
    // sitio lo cambiaría por debajo de React y el siguiente render compararía contra sí mismo.
    const rows = [
      { id: 1, action: 'rename' },
      { id: 2, action: 'conflict' },
    ]
    sortBlockersFirst(rows)
    expect(rows.map((row) => row.id)).toEqual([1, 2])
  })

  it('deja intacta una lista sin bloqueantes', () => {
    const rows = [
      { id: 1, action: 'rename' },
      { id: 2, action: 'skip' },
      { id: 3, action: 'rename' },
    ]
    expect(sortBlockersFirst(rows).map((row) => row.id)).toEqual([1, 2, 3])
  })
})
