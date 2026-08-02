import { useRef, type ComponentPropsWithRef, type UIEvent } from 'react'
import { cn } from '@/lib/utils'
import { countLines, SQL_TOKEN_CLASS, tokenizeSql } from '@/lib/syntax/sql-highlight'

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
  rows?: number
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
 * interlineado y relleno. Además ambas van sin ajuste de línea (`wrap="off"` + `whitespace-pre`),
 * que es lo que elimina la principal fuente de desfase: si una capa parte una línea larga y la
 * otra no, el texto empieza a bailar. El desplazamiento se replica a mano en cada scroll.
 */
export function SqlEditor({
  value,
  rows = 6,
  hideLineNumbers,
  className,
  ...props
}: SqlEditorProps) {
  const preRef = useRef<HTMLPreElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const tokens = tokenizeSql(value)
  const lineCount = countLines(value)
  const showGutter = !hideLineNumbers && lineCount > 1

  // El textarea es el único elemento que scrollea de verdad; las otras dos capas lo siguen.
  const syncScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    const { scrollTop, scrollLeft } = event.currentTarget
    if (preRef.current) {
      preRef.current.scrollTop = scrollTop
      preRef.current.scrollLeft = scrollLeft
    }
    if (gutterRef.current) gutterRef.current.scrollTop = scrollTop
  }

  // Tipografía y caja compartidas por las dos capas: cualquier diferencia aquí las desalinea.
  const shared = 'font-mono text-xs leading-5 whitespace-pre px-3 py-3'

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
  const height = `calc(${rows} * 1.25rem + 1.5rem)`

  return (
    <div
      style={{ height }}
      className="flex overflow-hidden rounded-lg border border-border bg-syntax-bg focus-within:ring-2 focus-within:ring-ring"
    >
      {showGutter && (
        <div
          ref={gutterRef}
          aria-hidden
          className="h-full shrink-0 select-none overflow-hidden border-r border-border px-2 py-3 text-right font-mono text-xs leading-5 text-syntax-gutter"
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
          className={cn('pointer-events-none absolute inset-0 overflow-hidden', shared)}
        >
          <code className="text-syntax-plain">
            {tokens.map((token, index) => (
              <span key={index} className={SQL_TOKEN_CLASS[token.type]}>
                {token.content}
              </span>
            ))}
            {/* Sin este salto final, la última línea vacía no ocupa alto y el cursor se sale
                de la capa resaltada al pulsar Intro al final del texto. */}
            {'\n'}
          </code>
        </pre>

        <textarea
          wrap="off"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onScroll={syncScroll}
          className={cn(
            'relative block h-full w-full resize-none overflow-auto border-0 bg-transparent',
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
