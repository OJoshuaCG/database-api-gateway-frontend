# Architecture Decision Records (ADR)

Registro del *porqué* de las decisiones de arquitectura del frontend. Cada ADR es
inmutable: si una decisión cambia, se añade una nueva que **supersede** a la anterior, en
lugar de editarla.

Formato: **Contexto** (qué problema) · **Decisión** (qué se eligió) · **Consecuencias**
(qué implica, bueno y malo).

| # | Decisión | Estado |
|---|---|---|
| [0001](0001-contrato-zod-manual.md) | Tipado del contrato con Zod manual (no OpenAPI generado) | Aceptada |
| [0002](0002-auth-cookie-sesion.md) | Autenticación por cookie de sesión httpOnly (sin tokens en JS) | Aceptada |
| [0003](0003-tablas-orden-busqueda-cliente.md) | Paginación/filtros server-side; orden y búsqueda client-side | Aceptada |
| [0004](0004-theming-tailwind-v4.md) | Theming con tokens CSS y Tailwind v4 `@theme inline` | Aceptada |
| [0005](0005-sin-class-components.md) | Composición sin class components (boundaries con librería) | Aceptada |
| [0006](0006-sin-streaming.md) | Operaciones 🔌 como request/response, no streaming | Aceptada |
