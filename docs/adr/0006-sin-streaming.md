# ADR-0006 — Operaciones contra el motor como request/response (sin streaming)

**Estado:** Aceptada

## Contexto

Existía la hipótesis de que la API podría exponer endpoints de **streaming/long-running**
(SSE, WebSocket o polling, típicos de respuestas de agentes). Tras revisar
`backend/docs/api-reference.md`, **no existe ningún endpoint de streaming**. Las
operaciones marcadas **🔌** (que tocan el motor destino: `test-connection`,
aprovisionamiento `CREATE/DROP`, `GRANT/REVOKE`, reasignación de owner, introspección)
son **request/response clásico**, solo que pueden tardar más y devolver `502` (servidor
no alcanzable) o `504` (timeout).

## Decisión

Tratar las operaciones 🔌 como **queries/mutations normales** de TanStack Query, con:

- Estado de carga visible (botón en `isPending`, spinners por sección en introspección).
- Reintentos limitados solo para errores transitorios (red/502/503/504) en
  `lib/api/query-client.ts`; sin reintento en errores 4xx.
- Mensajes específicos para fallos de motor (`ApiError.isEngineError` → nota extra en
  `ErrorState`).
- Introspección como **queries dependientes** (cada nivel `enabled` tras elegir el
  anterior).

## Consecuencias

- ✅ Modelo simple y uniforme; sin infraestructura de SSE/WebSocket innecesaria.
- ✅ La UI comunica claramente latencia y fallos de los servidores destino.
- ↩️ Si en el futuro el backend añadiera endpoints de streaming (p. ej. progreso de una
  operación larga), se introduciría una capa específica (EventSource/WebSocket) sin
  afectar a las operaciones actuales.
