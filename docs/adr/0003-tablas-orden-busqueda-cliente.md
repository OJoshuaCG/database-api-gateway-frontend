# ADR-0003 — Paginación/filtros server-side; orden y búsqueda client-side

**Estado:** Aceptada

## Contexto

La API soporta **paginación** (`page`, `size`) y **filtros concretos** (`server_id`,
`owner_id`, `model_id`, `status`, `engine`, `active`) como query params, pero **no expone
ordenamiento ni búsqueda global** server-side. El requisito de UI pide tablas con orden,
búsqueda global y paginación.

## Decisión

- **Paginación y filtros: server-side**, vía los query params documentados (controlados
  por estado en cada página + `Pagination`).
- **Orden y búsqueda global: client-side**, sobre la página ya cargada, dentro de
  `components/ui/DataTable.tsx` (TanStack Table).
- El catálogo de **privilegios** (no paginado por la API) usa paginación **client-side
  completa** (`clientPageSize`).

## Consecuencias

- ✅ Funciona con el contrato actual sin inventar parámetros inexistentes.
- ✅ UX fluida para filtrar/paginar grandes volúmenes (server-side).
- ⚠️ El orden y la búsqueda global aplican **solo a la página visible**, no a todo el
  dataset. Se documenta este límite; si el backend añade `sort`/`q`, se migra ese
  comportamiento a server-side sin cambiar la API de `DataTable`.
