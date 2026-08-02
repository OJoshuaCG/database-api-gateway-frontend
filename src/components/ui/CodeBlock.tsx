import { useMemo, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useToast } from '@/lib/toast/use-toast'
import { countLines, SQL_TOKEN_CLASS, tokenizeSql } from '@/lib/syntax/sql-highlight'
import { CopyIcon, ExpandIcon } from './icons'
import { Modal } from './Modal'

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
}

/**
 * Visor de SQL de solo lectura: resaltado por tokens del tema, numeración de líneas, copiado al
 * portapapeles y expansión a pantalla completa.
 *
 * Sustituye a los bloques `<pre>` que estaban duplicados por toda la app. El SQL que muestra el
 * gateway es DDL que el admin va a ejecutar contra un motor real, así que el criterio es que se
 * lea sin fricción: no se envuelven las líneas (se hace scroll horizontal) porque partir un
 * identificador SQL a mitad cambia lo que el ojo lee, y la numeración permite referirse a una
 * línea concreta al reportar un problema.
 */
export function CodeBlock({
  code,
  title,
  extra,
  maxHeightClass = 'max-h-80',
  hideLineNumbers,
  emptyLabel = 'Sin contenido.',
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
        onExpand={() => setExpanded(true)}
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
          <CodeSurface
            code={code}
            maxHeightClass="max-h-[calc(100dvh-14rem)]"
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
  const tokens = useMemo(() => tokenizeSql(code), [code])
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
          className={cn(
            'flex overflow-auto rounded-lg border border-border bg-syntax-bg font-mono text-xs leading-5',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            maxHeightClass,
          )}
        >
          {showGutter && (
            // `sticky left-0`: la numeración se queda a la vista al desplazarse en horizontal.
            <div
              aria-hidden
              className="sticky left-0 shrink-0 select-none border-r border-border bg-syntax-bg px-2 py-3 text-right text-syntax-gutter"
            >
              {Array.from({ length: lineCount }, (_, index) => (
                <div key={index}>{index + 1}</div>
              ))}
            </div>
          )}
          <pre className="min-w-0 flex-1 px-3 py-3 text-syntax-plain">
            <code>
              {tokens.map((token, index) => (
                <span key={index} className={SQL_TOKEN_CLASS[token.type]}>
                  {token.content}
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
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  )
}
