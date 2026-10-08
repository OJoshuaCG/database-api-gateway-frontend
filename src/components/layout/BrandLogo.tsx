import { cn } from '@/lib/utils'

/*
 * Los PNG viven en `public/` (se sirven tal cual, sin hash). Convención de nombres: el sufijo es el
 * tema de la APP en el que se usan, no el color del dibujo — `-dark` lleva colores claros para
 * verse sobre fondo oscuro.
 */
const BASE_URL = import.meta.env.BASE_URL

const LOGO_SOURCES = {
  full: {
    light: `${BASE_URL}datum-text-light.png`,
    dark: `${BASE_URL}datum-text-dark.png`,
  },
  icon: {
    light: `${BASE_URL}datum-logo-icon-light.png`,
    dark: `${BASE_URL}datum-logo-icon-dark.png`,
  },
} as const

interface BrandLogoProps {
  /** `full`: isotipo + palabra «Datum». `icon`: solo el isotipo (menú comprimido). */
  variant?: keyof typeof LOGO_SOURCES
  /** Define el alto (p. ej. `h-8`); el ancho sale solo de la proporción de la imagen. */
  className?: string
}

/**
 * Logo de Datum que sigue el tema de la app.
 *
 * Renderiza las dos versiones y deja que CSS (`dark:` ligado a `data-theme`) muestre una. Así no
 * depende de `useTheme` y no parpadea: el script anti-FOUC de `index.html` fija `data-theme`
 * antes del primer pintado.
 */
export function BrandLogo({ variant = 'full', className }: BrandLogoProps) {
  const sources = LOGO_SOURCES[variant]
  return (
    <span role="img" aria-label="Datum" className="inline-flex shrink-0">
      <img
        src={sources.light}
        alt=""
        aria-hidden
        draggable={false}
        className={cn('block w-auto dark:hidden', className)}
      />
      <img
        src={sources.dark}
        alt=""
        aria-hidden
        draggable={false}
        className={cn('hidden w-auto dark:block', className)}
      />
    </span>
  )
}
