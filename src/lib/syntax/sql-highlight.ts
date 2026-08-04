import Prism from 'prismjs'
// Registra `Prism.languages.sql` por efecto secundario sobre el Prism global. El componente de
// SQL no depende de ningún otro lenguaje, así que esto es lo único que hace falta importar.
import 'prismjs/components/prism-sql'

/**
 * Envoltura de Prism para resaltar SQL.
 *
 * Se usa `Prism.tokenize` y NO `Prism.highlight`: aquel devuelve un árbol de tokens que se
 * renderiza a elementos de React, mientras que este devuelve una cadena de HTML que obligaría a
 * `dangerouslySetInnerHTML`. Evitarlo quita de en medio toda una clase de problemas de inyección
 * sobre contenido que viene del backend, y permite mapear cada tipo de token a un token de color
 * del tema en vez de arrastrar la hoja de estilos de Prism (que trae colores hardcodeados y
 * violaría la regla de `theme.css`).
 */

/** Tipos que emite la gramática SQL de Prism, más `plain` para el texto sin clasificar. */
export type SqlTokenType =
  | 'plain'
  | 'boolean'
  | 'comment'
  | 'function'
  | 'identifier'
  | 'keyword'
  | 'number'
  | 'operator'
  | 'punctuation'
  | 'string'
  | 'variable'

export interface SqlToken {
  type: SqlTokenType
  content: string
}

/** Forma del árbol que devuelve `Prism.tokenize`, sin depender de los tipos internos. */
interface PrismTokenNode {
  type: string
  content: string | PrismTokenNode | (string | PrismTokenNode)[]
}

type PrismNode = string | PrismTokenNode

const KNOWN_TYPES = new Set<string>([
  'boolean',
  'comment',
  'function',
  'identifier',
  'keyword',
  'number',
  'operator',
  'punctuation',
  'string',
  'variable',
])

function normalizeType(type: string): SqlTokenType {
  return KNOWN_TYPES.has(type) ? (type as SqlTokenType) : 'plain'
}

/**
 * Aplana el árbol de Prism a una lista lineal. En los nodos anidados gana el tipo MÁS INTERNO,
 * que es el más específico (p. ej. la puntuación dentro de una función se pinta como puntuación).
 */
function flatten(nodes: PrismNode[], inherited: SqlTokenType, out: SqlToken[]): void {
  for (const node of nodes) {
    if (typeof node === 'string') {
      if (node.length > 0) out.push({ type: inherited, content: node })
      continue
    }
    const type = normalizeType(node.type)
    if (typeof node.content === 'string') {
      if (node.content.length > 0) out.push({ type, content: node.content })
    } else {
      flatten(Array.isArray(node.content) ? node.content : [node.content], type, out)
    }
  }
}

/**
 * Trocea SQL en tokens tipados.
 *
 * INVARIANTE: concatenar el `content` de todos los tokens devuelve el texto original carácter a
 * carácter. Un resaltador que se “come” texto es peor que no resaltar nada —sobre todo aquí,
 * donde lo que se muestra es DDL que el admin va a ejecutar contra un motor real—, así que está
 * cubierto por un test de totalidad.
 */
export function tokenizeSql(code: string): SqlToken[] {
  if (code.length === 0) return []
  const grammar = Prism.languages.sql
  // Si el componente de SQL no llegara a registrarse, se muestra el texto sin resaltar en vez de
  // fallar: el resaltado es una ayuda de lectura, nunca un requisito para ver el SQL.
  if (!grammar) return [{ type: 'plain', content: code }]
  const out: SqlToken[] = []
  flatten(Prism.tokenize(code, grammar), 'plain', out)
  return out
}

/** Clase de color por tipo de token. Los valores viven en `theme.css`, uno por tema. */
export const SQL_TOKEN_CLASS: Record<SqlTokenType, string> = {
  plain: 'text-syntax-plain',
  boolean: 'text-syntax-keyword',
  comment: 'text-syntax-comment italic',
  function: 'text-syntax-function',
  identifier: 'text-syntax-identifier',
  keyword: 'text-syntax-keyword',
  number: 'text-syntax-number',
  operator: 'text-syntax-operator',
  punctuation: 'text-syntax-punctuation',
  string: 'text-syntax-string',
  variable: 'text-syntax-identifier',
}

/** Número de líneas del fragmento, para dimensionar la columna de numeración. */
export function countLines(code: string): number {
  if (code.length === 0) return 0
  return code.split('\n').length
}
