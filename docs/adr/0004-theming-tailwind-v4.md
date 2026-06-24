# ADR-0004 — Theming con tokens CSS y Tailwind v4 `@theme inline`

**Estado:** Aceptada

## Contexto

Requisito: colores como **variables CSS semánticas** en **un solo archivo**, tema claro y
oscuro, y que **cambiar un color sea editar una sola variable**. Prohibido hardcodear
colores en los componentes.

## Decisión

Definir todos los tokens en `src/styles/theme.css`:

- Una capa "raw" (`--primary`, `--surface`, …) con los valores reales, redefinida por tema
  en `:root` (claro) y `[data-theme='dark']` (oscuro).
- `@theme inline` mapea cada token de Tailwind (`--color-primary`, `--shadow-clay`…) a su
  variable raw con `var(...)`. Al usar `inline`, las utilidades generadas (`bg-primary`,
  `text-accent`…) referencian la variable en runtime, por lo que el cambio de tema es
  instantáneo.

El tema se persiste en `localStorage` (`gw-theme`) y respeta `prefers-color-scheme` como
valor inicial; un script anti-FOUC en `index.html` lo aplica antes del primer pintado.
Tailwind v4 fija navegadores modernos (Chrome ≥111, Safari ≥16.4, Firefox ≥128).

## Consecuencias

- ✅ "Cambiar un color = editar una variable" se cumple literalmente.
- ✅ Tema oscuro sin duplicar definiciones (mismas variables, otros valores).
- ✅ Solo `localStorage` para la **preferencia de tema** (dato no sensible), nunca para
  credenciales.
- ⚠️ Requiere navegadores modernos (decisión confirmada con el usuario). Si hiciera falta
  soporte antiguo, habría que evaluar Tailwind v3.4.
- ⚠️ El JSX no debe usar colores fijos; se vigila por convención y revisión.
