# Capacidades puntuales

Una **capacidad puntual** le suma a una persona del gateway UNA capacidad sobre UN entorno o
servidor, sin tocar su rol. Existe para el caso «necesita borrar bases solo en Desarrollo esta
semana» sin subirle el rol en todo el entorno.

Contrato del backend: `api-reference.md` §19 (no está copiado en `docs/`; este documento describe
el **flujo del frontend**). Cobertura endpoint → pantalla en [`api-coverage.md`](api-coverage.md).

## Quién hace qué

- **Solo `access_admin`** otorga, revoca, aprueba y rechaza. `security_officer` tiene
  `gateway.admin` pero recibe 403 seguro: sus pantallas no se montan ni se piden.
- **Nadie se toca a sí mismo**: no se otorga ni se revoca capacidades (409
  `access.self_modification_forbidden`). La sección sale deshabilitada con el motivo a la vista.
- **Techo**: quien otorga o aprueba tiene que tener la capacidad en ese alcance. Las capacidades
  del eje global (`servers.admin`, `gateway.admin`…) nunca se otorgan: el selector solo ofrece las
  filas del catálogo con `grantable`.
- **Escribir/ejecutar trae la lectura** de su módulo (`implies`); la UI lo dice.

El cliente **no conoce ninguna regla**: qué es otorgable, sensible o implícito sale de
`GET /authz/catalog`, y `can_decide`/`blocked_reason` de la bandeja los calcula el servidor.

## El ciclo

```
Otorgar (POST) ──┬─ no sensible ─────────────► active ──► Revocar (DELETE) ──► revoked
                 │
                 └─ sensible ► pending ──┬─ otro access_admin aprueba ──► active
                                         ├─ otro access_admin rechaza ──► rejected
                                         ├─ quien la pidió cancela    ──► cancelled
                                         └─ 7 días sin decidir        ──► expired
```

1. **Otorgar** vive en «Capacidades puntuales» de `/gateway-users/:userId/accesos`
   (`CapabilityGrantsSection`). Es inmediato: no pasa por «Guardar accesos» y `PUT /access` no las
   toca.
2. **Sensible = segundo aprobador.** `databases.drop`, `engine_users.drop`, `engine_users.secrets`,
   `blueprints.captures`, `clones.execute`, `exports.download` y `sql_console.execute` nacen
   `pending`: **no conceden nada** hasta que OTRA persona con `access_admin` (ni quien la pidió ni
   la persona destino) la apruebe. La UI avisa antes y después de enviar; «Capacidad otorgada» sobre
   algo que no rige sería mentir.
3. **Bandeja** en `/gateway-users?tab=pending` («Solicitudes pendientes», con el recuento en la
   pestaña; solo `access_admin`). Aprobar y rechazar piden confirmación con un motivo opcional.
   Con `can_decide: false` los dos botones van deshabilitados y el `blocked_reason` queda visible
   en la fila. Si otra persona decidió antes (409 `access.grant_not_pending`) o la fila desapareció
   (404), el diálogo lo dice y la bandeja se refresca sola.
4. **Vencimiento a los 7 días.** Solo las pendientes vencen; al aprobarse el backend borra
   `expires_at`. El barrido es perezoso (corre al leer), así que una vencida puede verse un instante
   más hasta el próximo refresco.
5. **Revocar / cancelar** (un solo admin, sin techo, efecto inmediato): activa → `revoked`,
   pendiente → `cancelled`. Si quien la pidió pierde `access_admin` o se desactiva, sus pendientes
   se cancelan solas.

## Acceso efectivo

Las capacidades puntuales **suman** al rol del alcance (nunca restan). El resultado se ve en dos
lugares:

- **Admin sobre otra persona**: «Acceso efectivo» en la página de accesos, con la procedencia de
  cada capacidad («Capacidad puntual», rol, rol por alcance, global). Es la respuesta del servidor
  (`GET …/effective-access`); con cambios sin guardar muestra una vista previa del navegador,
  rotulada como tal.
- **Cada persona sobre sí misma**: «Mi cuenta», desde `/auth/me` (`capability_grants`).

Una pendiente no cuenta como acceso. Tras cualquier cambio los hooks invalidan todo
`queryKeys.capabilityGrants.all` (lista, bandeja y acceso efectivo) y `/auth/me` si la persona
afectada es la de la sesión.

## Dónde vive cada cosa

| Pieza | Ubicación |
|---|---|
| Contratos Zod | `src/lib/contracts/capability-grants.ts` |
| API y hooks | `features/gateway-users/api/capability-grants.api.ts`, `hooks/use-capability-grants.ts` |
| Copy de errores y bloqueos | `features/gateway-users/messages.ts` (`capabilityGrantErrorMessage`, `capabilityGrantBlockedMessage`) |
| Otorgar / revocar | `components/CapabilityGrantsSection.tsx` |
| Bandeja | `components/PendingCapabilityGrantsCard.tsx` (pestaña de `GatewayUsersPage`) |
| Espejo del cálculo | `features/auth/authz-model.ts` (`expandGrant`, `grantMatches`) |
