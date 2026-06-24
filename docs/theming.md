# Theming

Todos los colores del sitio viven en **un único archivo**: `src/styles/theme.css`. El
objetivo de diseño es: **cambiar un color = editar una sola variable**, con tema claro y
oscuro. Decisión y trade-offs en [ADR-0004](adr/0004-theming-tailwind-v4.md).

## Cómo funciona (Tailwind v4, CSS-first)

Hay dos capas:

1. **Capa "raw"** — los valores reales, en variables sin el prefijo `--color-`
   (`--primary`, `--surface`, `--foreground`…). Se definen en `:root` (tema claro) y se
   **redefinen** en `[data-theme='dark']` (tema oscuro).
2. **Capa de tokens de Tailwind** — dentro de `@theme inline`, cada token
   (`--color-primary`, `--shadow-clay`…) apunta a su variable raw con `var(--primary)`.
   Al usar `@theme inline`, Tailwind genera utilidades que **referencian la variable en
   runtime** (`bg-primary` → `background-color: var(--color-primary)`), por lo que cambiar
   de tema actualiza todo al instante.

```css
:root            { --primary: #4f46e5; … }      /* claro */
[data-theme='dark'] { --primary: #6366f1; … }   /* oscuro: mismas variables, otros valores */

@theme inline {
  --color-primary: var(--primary);              /* genera bg-primary, text-primary, … */
}
```

## Tokens disponibles

Consúmelos siempre como utilidades de Tailwind (`bg-…`, `text-…`, `border-…`,
`shadow-…`). **Nunca** escribas hex/rgb en el JSX.

| Grupo | Tokens (utilidad) |
|---|---|
| Marca | `primary`, `secondary`, `accent` (+ `*-foreground` para el texto encima) |
| Estados | `success`, `error`, `warning` (+ `*-foreground`) |
| Superficies/neutros | `background`, `surface`, `surface-muted`, `foreground`, `muted-foreground`, `border`, `input`, `ring`, `overlay` |
| Sombras | `shadow-clay`, `shadow-clay-inset`, `shadow-elevated` |
| Otros | `radius-card`, `font-sans` |

Convención: `X` es el color de fondo y `X-foreground` el color de texto/icono que va
**encima** de `X` con contraste suficiente (p. ej. `bg-primary text-primary-foreground`).

## Cambiar un color

Edita **una** variable raw en `src/styles/theme.css`. Ejemplo: cambiar la marca a otro
índigo afecta a todos los `bg-primary`, `text-primary`, anillos de foco, etc.

```css
:root { --primary: #4338ca; }   /* claro */
[data-theme='dark'] { --primary: #818cf8; }  /* (opcional) ajustar para oscuro */
```

## Añadir un token nuevo

1. Define la variable raw en `:root` y en `[data-theme='dark']`.
2. Mapéala dentro de `@theme inline`:
   ```css
   :root { --info: #0284c7; --info-foreground: #ffffff; }
   [data-theme='dark'] { --info: #38bdf8; --info-foreground: #082f49; }
   @theme inline {
     --color-info: var(--info);
     --color-info-foreground: var(--info-foreground);
   }
   ```
3. Úsalo: `bg-info text-info-foreground`.

## Tema claro / oscuro

- El tema se aplica con el atributo `data-theme` en `<html>` (`light` | `dark`).
- `ThemeProvider` (`src/lib/theme/`) lo gestiona y **persiste la preferencia** en
  `localStorage` (`gw-theme`). Solo se guarda la preferencia de tema — **nunca**
  credenciales.
- Valor inicial: respeta `prefers-color-scheme`. Un **script anti-FOUC** en `index.html`
  aplica el tema antes del primer pintado para evitar parpadeo.
- El toggle es el componente `ThemeToggle` (en el `Topbar`).

```tsx
import { useTheme } from '@/lib/theme/use-theme'
const { theme, toggleTheme, setTheme } = useTheme()
```

## Accesibilidad

- Los colores interactivos (marca y estados) usan variantes con **contraste WCAG AA
  (≥ 4.5:1)** frente a su `*-foreground`. Si cambias un color, **verifica el contraste**
  (p. ej. con un comprobador WCAG) antes de mergear.
- El **claymorphism** (`shadow-clay`) se reserva a **superficies** (cards/contenedores),
  nunca a controles, porque el bajo contraste rompería la legibilidad.
- El **foco siempre es visible** (anillo con el token `ring`), definido globalmente en
  `src/styles/index.css`.

## Reglas

- **Prohibido** `#hex`, `rgb()` o clases de color fijas de Tailwind (p. ej. `bg-indigo-600`)
  en el JSX. Siempre tokens.
- Un solo archivo de tokens: `src/styles/theme.css`. `index.css` solo importa Tailwind +
  tokens y define la capa base.
