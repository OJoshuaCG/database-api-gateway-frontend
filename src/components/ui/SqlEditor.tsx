import { useRef, type ComponentPropsWithRef, type UIEvent } from 'react'
import { cn } from '@/lib/utils'
import { useSqlWrap } from '@/lib/theme/use-sql-wrap'
import {
  countLines,
  gutterWidthStyle,
  splitTokenLines,
  SQL_TOKEN_CLASS,
  tokenizeSql,
} from '@/lib/syntax/sql-highlight'

/**
 * Se parte de `ComponentPropsWithRef` y no de `TextareaHTMLAttributes` para que `ref` forme
 * parte del contrato: el campo recibe el `{...register(...)}` de react-hook-form, cuya `ref` es
 * la que permite a la librería leer y escribir el DOM (p. ej. al restaurar un valor con
 * `setValue`). Con el tipo estrecho la `ref` viajaba igual, pero sin comprobación de tipos.
 */
export interface SqlEditorProps extends Omit<
  ComponentPropsWithRef<'textarea'>,
  'value' | 'children'
> {
  /** Valor actual: es lo que se resalta en la capa de abajo. */
  value: string
  /** Alto de partida —y mínimo— en líneas. */
  rows?: number
  /**
   * Si se indica, el editor **crece con el contenido** hasta este número de líneas (y a partir
   * de ahí desplaza). Sin él, el alto es fijo y siempre vale `rows`.
   */
  maxRows?: number
  hideLineNumbers?: boolean
}

/**
 * Editor de SQL **con resaltado**: se escribe con los colores puestos, sin tener que alternar
 * entre «editar» y «ver con formato».
 *
 * Cómo funciona: un `<pre>` resaltado debajo y el `<textarea>` real encima con el texto
 * transparente y solo el cursor visible. Se escribe en un textarea de verdad —conserva
 * deshacer, selección, IME, lectores de pantalla y la integración con el formulario—, pero lo
 * que se ve son los tokens coloreados de la capa inferior.
 *
 * Para que las dos capas no se desalineen tienen que compartir EXACTAMENTE tipografía, tamaño,
 * interlineado y ancho útil; si una parte una línea larga y la otra no, el cursor deja de
 * coincidir con el texto. De ahí tres decisiones:
 *
 *   - El `white-space` de ambas lo fija un único selector de `styles/code.css` a partir de
 *     `[data-sql-wrap]`, así que es imposible cambiar una capa y olvidar la otra.
 *   - Las dos llevan `scrollbar-gutter: stable`: sin él, al aparecer la barra de scroll vertical
 *     el textarea pierde ancho útil y envolvería una columna antes que el `<pre>`.
 *   - La numeración cambia de sitio según el modo. En **scroll** va en una columna hermana, fuera
 *     del textarea, y se sincroniza por `scrollTop`. En **ajuste** eso ya no vale —una línea
 *     envuelta ocupa más de un renglón y los números se descuadran—, y el textarea es una caja
 *     monolítica que no se puede partir en filas; así que los números pasan a la capa `<pre>`, con
 *     la misma estructura que `CodeBlock`, y el textarea recibe el ancho de esa columna como
 *     `padding-left`. Ese reparto deja a las dos capas exactamente el mismo ancho de código.
 *
 * El desplazamiento se replica a mano en cada scroll.
 */
export function SqlEditor({
  value,
  rows = 6,
  maxRows,
  hideLineNumbers,
  className,
  ...props
}: SqlEditorProps) {
  const preRef = useRef<HTMLPreElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const { wrap } = useSqlWrap()
  const lineCount = countLines(value)
  const showGutter = !hideLineNumbers && lineCount > 1
  // En modo ajuste la numeración vive dentro de la capa resaltada; en modo scroll, en la columna
  // hermana de siempre.
  const numbersInLayer = wrap && showGutter

  // El textarea es el único elemento que scrollea de verdad; las otras dos capas lo siguen.
  const syncScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    const { scrollTop, scrollLeft } = event.currentTarget
    if (preRef.current) {
      preRef.current.scrollTop = scrollTop
      preRef.current.scrollLeft = scrollLeft
    }
    if (gutterRef.current) gutterRef.current.scrollTop = scrollTop
  }

  // Tipografía y caja compartidas por las dos capas: cualquier diferencia aquí las desalinea. El
  // `white-space` NO se pone aquí; lo decide `code.css` para las dos a la vez.
  const shared = 'sql-editor-layer font-mono text-xs leading-5 py-3'

  /*
   * La altura la fija el CONTENEDOR, no sus hijos.
   *
   * La columna de números va en el flujo normal y pinta un `div` por línea, así que con una
   * consulta larga medía lo que midiera el SQL entero y estiraba el contenedor flex a esa
   * altura: la capa resaltada (`absolute inset-0`) se estiraba con él y mostraba la consulta
   * completa, mientras el textarea conservaba su alto de `rows` y solo dejaba editar la parte
   * de arriba. Con el alto fijado aquí y `overflow-hidden`, ningún hijo puede desplegarlo.
   *
   * El cálculo sale de las mismas clases que ya usan las capas: `leading-5` = 1.25rem por
   * línea, `py-3` = 0.75rem arriba y abajo.
   */
  /*
   * Alto visible en líneas. Con `maxRows` el editor acompaña al contenido en vez de obligar a
   * escribir DDL por una mirilla de seis líneas: crece desde `rows` hasta el tope y ahí se queda
   * desplazando. Se cuenta una línea de más para que, al pulsar Intro en la última, el cursor
   * caiga en un renglón ya visible y no en uno que aparece de golpe empujando el scroll.
   *
   * Se mide por líneas LÓGICAS (`countLines`), lo mismo que numera la columna de la izquierda. En
   * modo ajuste una línea envuelta ocupa más de un renglón y esta cuenta se queda corta; el scroll
   * sigue ahí como válvula, y a cambio el alto no depende de medir el DOM en un efecto.
   */
  const visibleRows =
    maxRows === undefined ? rows : Math.min(Math.max(rows, lineCount + 1), Math.max(rows, maxRows))
  const height = `calc(${visibleRows} * 1.25rem + 1.5rem)`

  const lines = splitTokenLines(tokenizeSql(value))

  return (
    /*
     * El ancho lo manda el contenedor padre, nunca el SQL. Quien lo garantiza es el propio
     * `overflow-hidden` de esta caja: un ítem flex con `overflow` distinto de `visible` resuelve su
     * `min-width: auto` a 0, así que una línea larguísima no puede empujar la caja y sacarle scroll
     * horizontal a la página —el fallo que ya costó un arreglo en `AppShell`—. Si algún día se
     * quita el `overflow-hidden`, hay que poner `min-w-0` en su lugar.
     */
    <div
      style={{ height, ...gutterWidthStyle(lineCount) }}
      className="flex overflow-hidden rounded-lg border border-border bg-syntax-bg focus-within:ring-2 focus-within:ring-ring"
    >
      {showGutter && !numbersInLayer && (
        <div
          ref={gutterRef}
          aria-hidden
          className="h-full shrink-0 select-none overflow-hidden py-3 pl-2 pr-3 text-right font-mono text-xs leading-5 text-syntax-gutter"
        >
          {Array.from({ length: lineCount }, (_, index) => (
            <div key={index}>{index + 1}</div>
          ))}
        </div>
      )}

      <div className="relative h-full min-w-0 flex-1">
        <pre
          ref={preRef}
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 overflow-hidden code-lines',
            shared,
            numbersInLayer && 'code-lines--numbered',
          )}
        >
          {/* Misma estructura de fila por línea que `CodeBlock`, aquí también en modo scroll: así
              una línea en blanco al final conserva su alto (`min-height` en `code.css`) y el
              cursor no se sale de la capa resaltada al pulsar Intro. */}
          <code className="text-syntax-plain">
            {lines.map((lineTokens, lineIndex) => (
              <span key={lineIndex} className="code-line" data-line={lineIndex + 1}>
                <span className="code-text">
                  {lineTokens.map((token, index) => (
                    <span key={index} className={SQL_TOKEN_CLASS[token.type]}>
                      {token.content}
                    </span>
                  ))}
                </span>
              </span>
            ))}
          </code>
        </pre>

        <textarea
          // `wrap` es atributo HTML, no CSS: es lo único del modo que no se puede conmutar desde
          // la hoja de estilos, y por eso el editor consume el contexto.
          wrap={wrap ? 'soft' : 'off'}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onScroll={syncScroll}
          // El relleno izquierdo reserva exactamente la columna de números de la capa de abajo,
          // para que ambas envuelvan en la misma columna.
          style={{ paddingLeft: numbersInLayer ? 'var(--code-gutter-w)' : '0.75rem' }}
          className={cn(
            'relative block h-full w-full resize-none overflow-auto border-0 bg-transparent pr-3',
            'text-transparent caret-syntax-plain outline-none',
            shared,
            className,
          )}
          {...props}
        />
      </div>
    </div>
  )
}
