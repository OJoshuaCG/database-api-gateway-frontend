# ADR-0001 — Tipado del contrato con Zod manual

**Estado:** Aceptada

## Contexto

El backend (FastAPI) puede exponer un contrato OpenAPI en `/api/v1/openapi.json`, pero
**solo si `DOCS_ENABLED=true`**, y no es accesible de forma fiable (puede estar
deshabilitado en producción y no está disponible durante el desarrollo del frontend). El
`backend/docs/api-reference.md` documenta el contrato completo (schemas, enums, errores).

Opciones consideradas: (a) generar tipos/cliente con `openapi-typescript` + `openapi-fetch`;
(b) modelar el contrato a mano.

## Decisión

Modelar el contrato **a mano con Zod** en `src/lib/contracts/`, usando Zod como **única
fuente de verdad**: los tipos TypeScript se infieren con `z.infer` y los **mismos schemas
validan en runtime** la respuesta (el envelope `ApiResponse[T]`) en `lib/api/client.ts`.

## Consecuencias

- ✅ No depende de que el backend exponga OpenAPI ni de acceso a la red en build.
- ✅ **Validación en runtime**: detecta drift backend↔frontend (log `[api] Respuesta no
  conforme al contrato`), no solo en compilación.
- ✅ Mismos schemas sirven para validar respuestas y formularios.
- ⚠️ **Mantenimiento manual**: si el backend cambia un shape, hay que actualizar
  `lib/contracts/`. Mitigado por la validación runtime que falla ruidosamente.
- ↩️ Reversible: si el backend garantiza OpenAPI estable, se puede migrar a generación
  automática conservando Zod solo para validación de formularios.
