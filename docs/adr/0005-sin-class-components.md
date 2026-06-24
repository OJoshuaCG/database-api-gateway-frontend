# ADR-0005 — Composición sin class components

**Estado:** Aceptada

## Contexto

Requisito: prohibido usar class components y herencia de clases; la separación de
responsabilidades se logra con composición (hooks, servicios, componentes pequeños). Sin
embargo, los **error boundaries** de React tradicionalmente **requieren** un class
component (`componentDidCatch`/`getDerivedStateFromError`).

## Decisión

No escribir ningún class component. Para los error boundaries se usa la librería
**`react-error-boundary`** (API funcional: `<ErrorBoundary FallbackComponent=…>`),
aplicada **por sección** en `AppShell` (`SectionErrorFallback`) y una vez en la raíz
(`App.tsx`). La lógica de negocio vive en custom hooks y en la capa de servicios
(`api/`), fuera de los componentes de UI.

## Consecuencias

- ✅ Cumple "composición, no herencia" sin renunciar a error boundaries.
- ✅ Boundaries por sección: un fallo de render no tumba toda la app; se ofrece reintentar.
- ⚠️ Dependencia externa pequeña y estable (`react-error-boundary`).
