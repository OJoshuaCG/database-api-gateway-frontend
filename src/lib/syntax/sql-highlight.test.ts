import { describe, expect, it } from 'vitest'
import { countLines, SQL_TOKEN_CLASS, tokenizeSql, type SqlTokenType } from './sql-highlight'

/** Reconstruye el texto a partir de los tokens: la garantía que hace fiable al resaltador. */
function rebuild(code: string): string {
  return tokenizeSql(code)
    .map((token) => token.content)
    .join('')
}

/** Tipos asignados a los fragmentos que coinciden con `needle`. */
function typesOf(code: string, needle: string): SqlTokenType[] {
  return tokenizeSql(code)
    .filter((token) => token.content.trim() === needle)
    .map((token) => token.type)
}

describe('invariante de totalidad', () => {
  const samples: [string, string][] = [
    ['DDL simple', 'CREATE TABLE ventas (id INT PRIMARY KEY);'],
    ['con comentario de línea', "-- crea la tabla\nSELECT 1; # otro\nSELECT 'x';"],
    ['con comentario de bloque', 'SELECT 1; /* varias\nlíneas */ SELECT 2;'],
    ['cadena con comilla escapada', "INSERT INTO t VALUES ('O''Brien', 'a\\'b');"],
    ['identificadores citados', 'SELECT `mi campo`, "otro" FROM `mi-tabla`;'],
    ['cast de PostgreSQL', "SELECT '2026-01-01'::date, x::text FROM t;"],
    ['acentos y unicode', "INSERT INTO t VALUES ('camión', 'ñandú', '日本語');"],
    ['saltos y tabulación', 'SELECT\n\ta,\n\tb\nFROM t;\n\n'],
    ['sin punto y coma final', 'ALTER TABLE t ADD COLUMN c VARCHAR(10)'],
    ['comentario sin cerrar', 'SELECT 1; /* se quedó abierto'],
    ['cadena sin cerrar', "SELECT 'se quedó abierta"],
    ['solo espacios', '   \n\t  '],
    ['operadores encadenados', 'SELECT a <= b, c <> d, e || f FROM t;'],
  ]

  for (const [name, sql] of samples) {
    it(`no pierde ni inventa caracteres: ${name}`, () => {
      expect(rebuild(sql)).toBe(sql)
    })
  }

  it('devuelve una lista vacía con la cadena vacía', () => {
    expect(tokenizeSql('')).toEqual([])
  })

  it('nunca emite tokens de contenido vacío', () => {
    const tokens = tokenizeSql('SELECT * FROM t WHERE a = 1;')
    expect(tokens.every((token) => token.content.length > 0)).toBe(true)
  })

  it('resiste un DDL grande sin degradar el invariante', () => {
    const big = Array.from(
      { length: 500 },
      (_, i) => `CREATE INDEX idx_${i} ON tabla_${i} (columna_${i});`,
    ).join('\n')
    expect(rebuild(big)).toBe(big)
  })
})

describe('clasificación de tokens', () => {
  it('reconoce las palabras clave', () => {
    expect(typesOf('SELECT a FROM t', 'SELECT')).toContain('keyword')
    expect(typesOf('CREATE TABLE t (id INT)', 'CREATE')).toContain('keyword')
  })

  it('reconoce cadenas y números', () => {
    const tokens = tokenizeSql("INSERT INTO t VALUES ('hola', 42);")
    expect(tokens.some((t) => t.type === 'string' && t.content.includes('hola'))).toBe(true)
    expect(tokens.some((t) => t.type === 'number' && t.content === '42')).toBe(true)
  })

  it('reconoce los comentarios de las tres sintaxis de SQL', () => {
    for (const comment of ['-- uno', '# dos', '/* tres */']) {
      const tokens = tokenizeSql(`SELECT 1; ${comment}`)
      expect(tokens.some((t) => t.type === 'comment')).toBe(true)
    }
  })

  it('no clasifica como palabra clave un identificador que la contiene', () => {
    // `selection` empieza por SELECT: si la gramática usara prefijos sueltos, lo partiría.
    const tokens = tokenizeSql('SELECT selection FROM t')
    const keywords = tokens.filter((t) => t.type === 'keyword').map((t) => t.content)
    expect(keywords).not.toContain('selection')
  })

  it('el contenido de un comentario de bloque no se reclasifica', () => {
    // Dentro de un comentario no debe aparecer ningún token de palabra clave.
    const tokens = tokenizeSql('/* SELECT DROP TABLE */ SELECT 1;')
    const firstKeyword = tokens.findIndex((t) => t.type === 'keyword')
    const comment = tokens.findIndex((t) => t.type === 'comment')
    expect(comment).toBeGreaterThanOrEqual(0)
    expect(firstKeyword).toBeGreaterThan(comment)
  })
})

describe('mapa de clases', () => {
  it('cubre todos los tipos que puede emitir el tokenizador', () => {
    const emitted = new Set(
      tokenizeSql(
        "-- c\nSELECT COUNT(id), 'txt', 1, TRUE FROM `t` WHERE a <> @v AND b = 2;",
      ).map((token) => token.type),
    )
    for (const type of emitted) {
      expect(SQL_TOKEN_CLASS[type], `falta la clase de «${type}»`).toBeTruthy()
    }
  })

  it('usa tokens del tema y nunca colores literales', () => {
    for (const className of Object.values(SQL_TOKEN_CLASS)) {
      expect(className).not.toMatch(/#[0-9a-f]{3,8}|rgb\(/i)
      expect(className).toMatch(/text-syntax-/)
    }
  })
})

describe('countLines', () => {
  it('cuenta las líneas para dimensionar la numeración', () => {
    expect(countLines('')).toBe(0)
    expect(countLines('SELECT 1;')).toBe(1)
    expect(countLines('a\nb\nc')).toBe(3)
    // Un salto final abre una línea vacía, igual que en un editor.
    expect(countLines('a\n')).toBe(2)
  })
})
