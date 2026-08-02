import type { ReactNode } from 'react'

/**
 * Set de iconos de la app. Todos comparten `viewBox` 20×20, trazo de 1.6 y extremos redondeados,
 * que es la familia que ya usaban `Modal`, `Combobox` y `CodeBlock`; el resto del repo tenía una
 * segunda familia de 24×24 con grosores distintos y la «✕» copiada en cuatro archivos.
 *
 * Son SIEMPRE decorativos (`aria-hidden`): el nombre accesible lo pone el control que los
 * contiene —normalmente `IconButton`, que lo exige—, nunca el icono. Un icono con nombre propio
 * duplicaría el anuncio del lector de pantalla.
 */

export interface IconProps {
  /** Por defecto `h-4 w-4`, que es lo que encaja en `Button size="icon-sm"`. */
  className?: string
}

function Glyph({ className = 'h-4 w-4', children }: { className?: string; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

export function PencilIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M12.9 3.7a1.5 1.5 0 012.1 0l1.3 1.3a1.5 1.5 0 010 2.1L7.6 15.8 4 16.6l.8-3.6z" />
      <path d="M11.8 4.8l3.4 3.4" />
    </Glyph>
  )
}

export function TrashIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M3.8 5.6h12.4" />
      <path d="M8.1 5.6V4.3a.9.9 0 01.9-.9h2a.9.9 0 01.9.9v1.3" />
      <path d="M5.6 5.6l.7 9.6a1.1 1.1 0 001.1 1h5.2a1.1 1.1 0 001.1-1l.7-9.6" />
      <path d="M8.6 8.6v5M11.4 8.6v5" />
    </Glyph>
  )
}

export function RefreshIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M16.2 10a6.2 6.2 0 11-1.9-4.5" />
      <path d="M16.6 3.2v3.4h-3.4" />
    </Glyph>
  )
}

export function CopyIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <rect x="7" y="7" width="9" height="9" rx="1.5" />
      <path d="M13 7V5.5A1.5 1.5 0 0011.5 4h-6A1.5 1.5 0 004 5.5v6A1.5 1.5 0 005.5 13H7" />
    </Glyph>
  )
}

export function EyeIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M2.4 10S5.2 5.4 10 5.4 17.6 10 17.6 10s-2.8 4.6-7.6 4.6S2.4 10 2.4 10z" />
      <circle cx="10" cy="10" r="2.1" />
    </Glyph>
  )
}

export function EyeOffIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M8.2 5.7A7.6 7.6 0 0110 5.4c4.8 0 7.6 4.6 7.6 4.6a14 14 0 01-2.5 3" />
      <path d="M5.1 6.9A13.6 13.6 0 002.4 10S5.2 14.6 10 14.6c1 0 1.9-.2 2.7-.5" />
      <path d="M8.5 8.5a2.1 2.1 0 003 3" />
      <path d="M3.6 3.6l12.8 12.8" />
    </Glyph>
  )
}

export function ChevronLeftIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M12.4 4.4L6.8 10l5.6 5.6" />
    </Glyph>
  )
}

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M7.6 4.4L13.2 10l-5.6 5.6" />
    </Glyph>
  )
}

export function XIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M5.6 5.6l8.8 8.8M14.4 5.6l-8.8 8.8" />
    </Glyph>
  )
}

export function CodeIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M7.4 6L3.4 10l4 4M12.6 6l4 4-4 4" />
    </Glyph>
  )
}

export function ArrowUpIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M10 16V4.4M5.2 9.2L10 4.4l4.8 4.8" />
    </Glyph>
  )
}

export function ArrowDownIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M10 4v11.6M5.2 10.8l4.8 4.8 4.8-4.8" />
    </Glyph>
  )
}

export function ExpandIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M8 3.4H3.4v4.6M12 3.4h4.6v4.6M8 16.6H3.4V12M12 16.6h4.6V12" />
    </Glyph>
  )
}
