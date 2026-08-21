import { useMemo, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useToast } from '@/lib/toast/use-toast'
import { useSqlWrap } from '@/lib/theme/use-sql-wrap'
import {
  countLines,
  gutterWidthStyle,
  splitTokenLines,
  SQL_TOKEN_CLASS,
  tokenizeSql,
} from '@/lib/syntax/sql-highlight'
import { CopyIcon, ExpandIcon, WrapIcon } from './icons'
import { Modal } from './Modal'
import { SqlThemeSelect } from './SqlThemeSelect'

export interface CodeBlockProps {
  /** El SQL a mostrar. Se resalta con la gramática SQL de Prism. */
  code: string
  /** Título sobre el bloque. Si falta, la barra solo lleva las acciones. */
  title?: string
  /** Contenido junto al título, normalmente insignias de estado. */
  extra?: ReactNode
  /** Alto máximo del bloque embebido; en pantalla completa se ignora. */
  maxHeightClass?: string
  /** Oculta la numeración de líneas (útil en fragmentos de una sola línea). */
  hideLineNumbers?: boolean
  /** Texto alternativo cuando `code` está vacío. */
  emptyLabel?: string
  /** Oculta el botón de expandir: para cuando ya se está dentro de un visor a pantalla completa. */
  hideFullscreen?: boolean
}

/**
 * Visor de SQL de solo lectura: resaltado por tokens del tema, numeración de líneas, copiado al
 * portapapeles y expansión a pantalla completa.
 *
 * Sustituye a los bloques `<pre>` que estaban duplicados por toda la app. El SQL que muestra el
 * gateway es DDL que el admin va a ejecutar contra un motor real, así que el criterio es que se
 * lea sin fricción.
 *
 * Dos modos, con un botón en la barra y **preferencia global** (`SqlWrapProvider`), para que dos
 * SQL contiguos nunca se lean con reglas distintas:
 *
 *   - **Ajuste de línea (por omisión).** No hay que arrastrar en horizontal para leer una
 *     sentencia entera. Es seguro para DDL porque se mantiene la numeración por línea lógica y la
 *     continuación de una línea envuelta queda sangrada bajo el código, así que nunca se confunde
 *     con una sentencia nueva.
 *   - **Scroll horizontal.** Cada línea del origen es una línea en pantalla, sin excepción.
 *
 * En los dos modos se numera una fila por línea LÓGICA, lo que permite referirse a una línea
 * concreta al reportar un problema. Nunca se usa `break-all` sobre SQL: partir un identificador a
 * mitad cambia lo que el ojo lee, así que un literal larguísimo sin espacios sigue desbordando y
 * el scroll del bloque es su válvula de escape.
 */
export function CodeBlock({
  code,
  title,
  extra,
  maxHeightClass = 'max-h-80',
  hideLineNumbers,
  emptyLabel = 'Sin contenido.',
  hideFullscreen,
}: CodeBlockProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      <CodeSurface
        code={code}
        title={title}
        extra={extra}
        maxHeightClass={maxHeightClass}
        hideLineNumbers={hideLineNumbers}
        emptyLabel={emptyLabel}
        onExpand={hideFullscreen ? undefined : () => setExpanded(true)}
      />

      {/* Montaje condicional: al cerrar y reabrir, el visor nace limpio (posición de scroll
          incluida) sin necesidad de resetear nada con efectos. */}
      {expanded && (
        <Modal
          open
          onClose={() => setExpanded(false)}
          title={title ?? 'SQL'}
          description={`${countLines(code)} línea(s)`}
          size="full"
        >
          {/* La paleta se ofrece aquí y no en el bloque embebido: es donde de verdad se lee SQL
              a fondo, y repetir el control en cada bloque de la página sería puro ruido. */}
          <div className="mb-2 flex justify-end">
            <SqlThemeSelect />
          </div>
          <CodeSurface
            code={code}
            maxHeightClass="max-h-[calc(100dvh-16rem)]"
            hideLineNumbers={hideLineNumbers}
            emptyLabel={emptyLabel}
          />
        </Modal>
      )}
    </>
  )
}

/**
 * La superficie de código en sí. Se extrae para que el modo embebido y el de pantalla completa
 * sean literalmente el mismo render y no se desincronicen.
 */
function CodeSurface({
  code,
  title,
  extra,
  maxHeightClass,
  hideLineNumbers,
  emptyLabel,
  onExpand,
}: {
  code: string
  title?: string
  extra?: ReactNode
  maxHeightClass: string
  hideLineNumbers?: boolean
  emptyLabel: string
  /** Si falta, no se ofrece expandir (ya se está en pantalla completa). */
  onExpand?: () => void
}) {
  const toast = useToast()
  const { wrap, toggleWrap } = useSqlWrap()
  const lines = useMemo(() => splitTokenLines(tokenizeSql(code)), [code])
  const lineCount = countLines(code)
  const showGutter = !hideLineNumbers && lineCount > 1

  const handleCopy = () => {
    // `navigator.clipboard` no existe fuera de un contexto seguro (HTTP sin TLS): se avisa en
    // vez de romper, y el texto sigue siendo seleccionable a mano.
    if (!navigator.clipboard) {
      toast.error('El portapapeles no está disponible', 'Copiá el SQL manualmente.')
      return
    }
    void navigator.clipboard
      .writeText(code)
      .then(() => toast.success('SQL copiado al portapapeles'))
      .catch(() => toast.error('No se pudo copiar al portapapeles'))
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        {title && <span className="text-sm font-medium text-foreground">{title}</span>}
        {extra}
        <span className="ml-auto flex items-center gap-1">
          {lineCount > 0 && (
            <span className="mr-1 text-xs text-muted-foreground">{lineCount} línea(s)</span>
          )}
          {/* Etiqueta FIJA + `aria-pressed`: si además cambiara el texto, el lector de pantalla
              anunciaría el estado dos veces y en sentidos opuestos. */}
          <ToolbarButton label="Ajustar líneas" pressed={wrap} onClick={toggleWrap}>
            <WrapIcon />
          </ToolbarButton>
          <ToolbarButton label="Copiar SQL" onClick={handleCopy}>
            <CopyIcon />
          </ToolbarButton>
          {onExpand && (
            <ToolbarButton label="Ver a pantalla completa" onClick={onExpand}>
              <ExpandIcon />
            </ToolbarButton>
          )}
        </span>
      </div>

      {code.length === 0 ? (
        <p className="rounded-lg border border-border bg-syntax-bg p-3 text-xs text-muted-foreground">
          {emptyLabel}
        </p>
      ) : (
        <div
          // `tabIndex` para que se pueda desplazar con el teclado: es una región con scroll.
          tabIndex={0}
          role="group"
          aria-label={title ? `SQL: ${title}` : 'SQL'}
          style={gutterWidthStyle(lineCount)}
          className={cn(
            'overflow-auto rounded-lg border border-border bg-syntax-bg font-mono text-xs leading-5',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            maxHeightClass,
          )}
        >
          {/* Una fila por línea lógica (ver `styles/code.css`): es lo que permite numerar y
              envolver a la vez. El número lo pinta un pseudo-elemento a partir de `data-line`,
              así que no se lo lleva la selección al copiar con el ratón. */}
          {/* El relleno vertical va aquí y no en el contenedor con scroll: si fuera del contenedor
              se quedaría fijo y el texto se vería pasar por debajo al desplazarse. */}
          <pre
            className={cn(
              'code-lines py-3 text-syntax-plain',
              showGutter && 'code-lines--numbered',
            )}
          >
            <code>
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
        </div>
      )}
    </div>
  )
}

function ToolbarButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string
  /** Marca el control como conmutador: aporta `aria-pressed` y el tinte de estado activo. */
  pressed?: boolean
  onClick: () => void
  children: ReactNode
}) {
  // Se resalta con tinte de ACENTO, no neutro, como el resto de controles: ver la regla y su
  // porqué en `Button.tsx`.
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      className={cn(
        'rounded-md p-1.5 transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        pressed ? 'bg-primary/10 text-primary' : 'text-muted-foreground',
      )}
    >
      {children}
    </button>
  )
}
