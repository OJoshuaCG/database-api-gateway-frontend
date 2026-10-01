# Mantenimiento del frontend

Guía práctica para modificar y ampliar el frontend sin romper los patrones existentes.
Rutas relativas a `frontend/`. Lee antes [`architecture.md`](architecture.md) y
[`data-flow.md`](data-flow.md).

## Comandos del día a día

```bash
pnpm dev            # desarrollo (http://localhost:5173)
pnpm typecheck      # tsc sin emitir — córrelo antes de commitear
pnpm lint           # ESLint con type-checking
pnpm test           # Vitest (o pnpm test:watch)
pnpm build          # type-check + build de producción
pnpm format         # Prettier
```

> **Node/pnpm:** el proyecto usa pnpm (ver `package.json` → `packageManager`). Si `node`
> no está en el PATH, actívalo con tu gestor (p. ej. `nvm use`) o `corepack enable`.

## Convenciones de nombres

| Tipo | Convención | Ejemplo |
|---|---|---|
| Componentes | `PascalCase.tsx` | `ServerForm.tsx` |
| Hooks | `use-kebab.ts`, export `useCamel` | `use-servers.ts` → `useServers` |
| Servicios API | `<feature>.api.ts` | `servers.api.ts` |
| Schemas/contratos | `<entidad>.ts` en `lib/contracts/` | `servers.ts` |
| Barrels | `index.ts` que expone solo lo público de la feature | `features/servers/index.ts` |

- **Sin `any`** salvo comentario justificando por qué.
- **Colores solo por tokens** (`bg-primary`, `text-error`…); nunca hex/rgb en JSX.
- **Sin class components**; lógica de negocio en hooks/servicios, no en componentes de UI.
- Estados de datos siempre con **loading / empty / error** explícitos.

## Dónde vive cada cosa

- ¿Un valor nuevo en una respuesta? → añade el campo al schema en `lib/contracts/`.
- ¿Una llamada nueva? → función en `features/<f>/api/<f>.api.ts`.
- ¿Lógica de caché/estado? → hook en `features/<f>/hooks/`.
- ¿UI reutilizable entre features? → `components/ui/`. Si es solo de una feature →
  `features/<f>/components/`.
- ¿Color/diseño? → `styles/theme.css` (tokens) y utilidades de Tailwind.

---

## Receta: añadir un endpoint a una feature existente

Supongamos que el backend añade `GET /servers/{id}/replicas`.

1. **Contrato** — define el shape en `lib/contracts/servers.ts`:
   ```ts
   export const replicaSchema = z.object({ id: z.number().int(), host: z.string() })
   export type Replica = z.infer<typeof replicaSchema>
   ```
   Expórtalo desde `lib/contracts/index.ts` si hace falta fuera.

2. **Servicio** — en `features/servers/api/servers.api.ts`:
   ```ts
   export function listReplicas(id: number, signal?: AbortSignal): Promise<Replica[]> {
     return fetchList(`/servers/${id}/replicas`, replicaSchema, { signal })
   }
   ```
   Elige el helper según la respuesta: `fetchData` (`{data}`), `fetchPage`
   (`{data,pagination}`), `fetchList` (lista no paginada), `mutateData` (POST/PATCH con
   `{data}`), `mutateVoid` (DELETE/acciones sin datos).

3. **Query key** — añade la clave en `lib/api/query-keys.ts` bajo `servers` para poder
   invalidarla de forma dirigida.

4. **Hook** — en `features/servers/hooks/`:
   ```ts
   export function useReplicas(id: number, enabled: boolean) {
     return useQuery({
       queryKey: queryKeys.servers.replicas(id),
       queryFn: ({ signal }) => listReplicas(id, signal),
       enabled,
     })
   }
   ```
   Para mutaciones, recuerda `invalidateQueries` + `toast` en `onSuccess`/`onError`.

5. **UI** — consume el hook en una página/componente y pinta `loading`/`empty`/`error`
   con `<Spinner/>`, `<EmptyState/>`, `<ErrorState onRetry={refetch}/>`.

6. **Capacidad y 403** — mirá en el backend qué capacidad exige el endpoint (y si un parámetro
   la sube: va a `CAPABILITY_ESCALATIONS`). En la UI:
   - acción única en contexto → `useCapabilityGuard(cap, 'acción en infinitivo')`, botón
     `disabled` + `aria-describedby={guard.describedBy}` y `<CapabilityHint guard={guard} />` al
     lado (el motivo nunca va en un `title`);
   - acción repetida en filas → se esconde de las filas y un único `Callout` sobre la tabla lo
     explica;
   - módulo entero que no sirve sin la capacidad → `capability` en su entrada del `Sidebar`;
   - el 403 `access.forbidden` se trata igual: `isAccessForbidden(error)` → `ForbiddenState`
     (página) o `forbiddenCopy()` (mensaje), **sin «Reintentar»**. Solo pasá `scope` a la guarda
     en las rutas donde el backend aplica la capa 2 (`assert_scope`).

7. **Test** — añade al menos un test del hook con MSW (mira
   `features/servers/hooks/use-servers.test.tsx` como plantilla).

## Receta: añadir una feature nueva

1. Crea `features/<f>/` con `api/`, `hooks/`, `components/`, `pages/`, `index.ts`.
2. Sigue la receta de endpoint para cada llamada.
3. Registra la ruta en `app/router.tsx` (bajo el layout protegido).
4. Añade el enlace de navegación en `components/layout/Sidebar.tsx` (`NAV_ITEMS`).
5. Si necesita selects de otra entidad, reutiliza los hooks "options"
   (`useServerOptions`, `useServerUserOptions`, `useDatabaseModelOptions`,
   `usePermissionProfileOptions`).

## Patrones de UI reutilizables

| Necesidad | Componente |
|---|---|
| Tabla con orden/búsqueda/visibilidad de columnas | `DataTable` (+ `Pagination` si es server-side) |
| Select con búsqueda | `Combobox` · multiselect → `MultiCombobox` |
| Formulario | `react-hook-form` + `zodResolver` + `Input/Textarea/Checkbox/Switch/Combobox` |
| Confirmación destructiva | `ConfirmDialog` (con `confirmWord` para doble confirmación) |
| Diálogo/modal | `Modal` (usa `<dialog>` nativo: focus-trap + Esc gratis) |
| Estado/etiqueta | `Badge` (+ badges de estado por feature) |
| Seleccionar privilegios por motor | `PrivilegeMultiSelect` (en `features/privileges`; se alimenta del catálogo `/privileges`) |
| Elegir varias bases de un servidor | `DatabaseMultiSelect` (en `features/server-users`; lista las bases del motor con `GET /servers/{id}/databases`, adoptadas o no, y cae a captura manual si la introspección falla). Para elegir **una** sola, `ServerDatabaseCombobox` en `features/servers` |
| Lista dinámica en un formulario | `useFieldArray` de RHF (p. ej. items de un perfil de permisos) |
| Acciones de una base de datos en una fila o en su ficha | `DatabaseRowActions` / `DatabaseHeaderActions` + `DatabaseActionDialogs` (en `features/managed-databases`). Qué acciones corresponden lo decide `database-actions.ts` según el estado de la base y el `source` de la lista. Ver «Una entidad, varias vistas» abajo |
| Acciones de un usuario del motor en una fila o en su ficha | `EngineUserActionButtons` + `useEngineUserDialogs` (en `features/servers/components`), con la lógica en `engine-user-actions.ts` |
| Ruta a la ficha de una base o de un usuario del motor | `serverDatabasePath` / `serverUserPath` de `src/lib/routes.ts`. Nunca armes la plantilla a mano |

## Una entidad, varias vistas

Una base de datos, un usuario del motor, un blueprint o un servidor aparecen en **más de un
listado** además de su página propia. Esas vistas llegaron a ofrecer acciones distintas para la
misma entidad en el mismo estado, y cada arreglo en una vista dejaba atrás a la otra: en
«Servidores → Bases de datos» una base gestionada no se podía editar, cuando en «Bases de datos»
sí. Para que no vuelva a pasar, cinco reglas:

1. **La ficha tiene todas las acciones.** La página propia de la entidad ofrece todo lo que se
   puede hacer con ella. Una fila de cualquier listado es un **atajo** de esas mismas acciones:
   una acción que está en una fila y no en la ficha es un bug. Límite conocido: la lista del
   inventario de bases no conoce la presencia física, así que una base `active` que desapareció
   del motor ofrece en su fila Comparar/Clonar/Exportar y en su ficha no (el detalle, en
   `database-actions.ts`).
2. **Qué acciones hay lo decide el estado, no la lista.** Gestionada, sin aprovisionar, no
   gestionada o huérfana; y las capacidades del rol. La misma entidad en el mismo estado tiene la
   misma fila en cualquier listado.
3. **Cada acción se implementa una vez.** Un solo diálogo, un solo hook, montado desde todas las
   vistas. Agregar una acción es tocar un lugar: la lógica de acciones de la entidad
   (`database-actions.ts`, `engine-user-actions.ts`) y su componente. No se escriben botones
   sueltos por página.
4. **Las variantes de contexto se declaran.** Si una lista necesita algo propio —la tabla de un
   blueprint ofrece «Aplicar aquí 🔌», la lista del motor y la del inventario difieren en qué
   destructiva ofrecen—, entra como parámetro tipado (`source`, contexto), no como un botón extra
   agregado a mano en esa página.
5. **Una acción destructiva se nombra por su consecuencia.** «Quitar del inventario» (el motor no
   se toca, icono `ListRemoveIcon`) y «Eliminar del motor 🔌» (`DROP`, papelera) nunca comparten
   etiqueta ni icono. Llegaron a compartir los dos, con el mismo rojo, haciendo cosas opuestas.

La paridad se consigue **sumando**: si una vista tiene un atajo que la otra no, se agrega donde
falta; no se quita de donde ya estaba.

## Trampas conocidas (gotchas)

- **Formularios con `provision`:** el password u opciones obligatorias bajo provisión se
  validan con `superRefine` en el schema del formulario, no en el contrato base.
- **Diálogos de borrado:** se **montan condicionalmente** (`{target && <Dialog/>}`) para
  obtener estado fresco sin `setState` dentro de efectos (regla `set-state-in-effect`).
- **Modales con estado reutilizados entre filas** (permisos de usuario, migraciones por BD,
  migraciones de blueprint): el componente vive montado en la página y `Modal` solo desmonta
  sus *hijos*, así que su estado interno (pestaña, formulario, previsualización) **sangraría**
  entre filas. Se reinicia con `key={target?.id ?? 'closed'}` (o montándolo condicionalmente).
- **Campos que alimentan endpoints del motor 🔌** (p. ej. el `database` para ver grants en
  PostgreSQL): aplica **debounce** para no disparar una consulta de introspección por pulsación.
- **Doble confirmación más allá del borrado:** además de `confirm_name`/`confirm_username`,
  el *rollback* de migración exige `confirm_version` (= versión actual) y el `REVOKE … CASCADE`
  en PostgreSQL exige `confirm_grantee` (= username). Deshabilita la acción hasta que coincida.
- **`apply-profile` — los campos de objeto son una PLANTILLA, no un destino.** La UI construye
  un `object_ref` por nivel (`database`/`schema`/`table`/`column`/`sequence`/`routine`) a partir
  de lo que se captura una sola vez, y ese borrador se reusa **idéntico en cada base** del lote:
  el `database` del `object_ref` lo sobrescribe el backend base por base, que es justo la
  semántica del bulk (v21 §11). Por eso la BD ya no se teclea: sale de la multiselección. Y por
  eso los niveles con el objeto **incompleto** (un item `table` sin tabla) **no se mandan** y se
  avisan antes de enviar: mandarlos confiando en que el backend los descarte mezclaría «no lo
  mapeé» con «lo mapeé mal» dentro del mismo `skipped_levels`. Todo eso vive en
  `features/server-users/components/grant-logic.ts` (`buildObjectRef`, `missingObjectFields`),
  aparte del componente y probable sin montar React.
- **Un 200 no significa que haya funcionado: `apply-profile/.../bulk` responde 200 aunque fallen
  TODAS las bases.** El estado real está en `results[].ok`, base por base, y ahí es donde la UI
  decide el éxito (`outcomeRowsFromBulk`). Nunca derives el resultado del status HTTP en este
  endpoint: un `catch` que solo mira el error de red pintaría «perfil aplicado» sobre un lote
  entero fallido. Misma forma en el fan-out de privilegios sueltos (N llamadas, una por base): un
  fallo **no aborta** las demás y cada unidad se reporta por separado.
- **`database` no significa lo mismo en cada motor al consultar grants.** PostgreSQL lo **exige**
  y devuelve solo esa base; MySQL/MariaDB lo **ignoran** y responden con los grants del usuario en
  todo el servidor. Mandarlo y asumir que acotó es el error fácil del endpoint: el recorte por
  base lo hace el cliente (`filterGrantsByDatabase`), que compara el primer segmento del `object`
  y **conserva los grants `global`** —aplican también a esa base, y esconderlos daría una foto
  incompleta—.
- **Owner de una BD:** debe pertenecer al **mismo servidor**; al cambiar el servidor en el
  formulario se resetea `owner_id` (si no, el backend responde **409**).
- **`/health`:** vive fuera de `/api/v1` y puede no tener CORS; el `HealthBadge` se degrada
  en silencio.
- **`data: null` no llega como `null`, llega como clave AUSENTE.** `ApiResponse._exclude_none`
  del backend omite del envelope las claves nulas de primer nivel, y `envelope()` declara `data`
  como clave **requerida**. Así que un endpoint que antes respondía vacío y ahora devuelve un
  objeto no se tipa con `schema.nullable()`: eso rechaza al gateway viejo y convierte una
  operación **ya ejecutada** en «La API devolvió una respuesta inesperada». Va
  `schema.nullable().optional()`, normalizado a `null` en la capa de servicio para que arriba
  haya una sola forma de «ausente». Precedente: el `DELETE` de migraciones de blueprint (v18).
- **Enums de Zod sobre vocabularios que el backend puede ampliar o renombrar:** un `z.enum`
  rechaza el valor desconocido y el `safeParse` corre sobre el envelope entero, así que **una
  palabra nueva en un campo de ayuda tumba la respuesta completa**. Cuando el valor solo gobierna
  un texto —`block_reason`, `reason` de una lista bloqueante— acepta también los valores viejos y
  deja el legado documentado, en vez de estrechar el enum al vocabulario del día.
- **Un 504 no es «falló»: es «no sé».** Apply, rollback, `reconcile-partial` y el apply masivo
  son síncronos y pueden tardar más que el timeout de un proxy; cuando el proxy corta, uvicorn
  **sigue** ejecutando. `ApiError.isOutcomeUncertain` reconoce esa huella —un 504, o cualquier 5xx
  cuyo cuerpo no es el envelope del backend (HTML de nginx/Traefik, marcado `unrecognizedBody`)— y
  `handleUncertainRun` (`features/managed-databases/uncertain-run.ts`) avisa «probablemente sigue
  en curso», invalida el estado y deja que el refetch de `.../migrations/status` diga cómo
  terminó. Una mutación nueva que toque el motor y pueda tardar debe pasar por ahí, nunca por un
  `toast.error('No se pudo…')` que invite a relanzarla sobre una base a medio migrar.
- **Validación de contrato (Zod) en runtime:** si el backend cambia un shape, verás en
  consola `[api] Respuesta no conforme al contrato` y un error "respuesta inesperada".
  Es la señal de que hay que actualizar `lib/contracts/`.
- **Un campo NUEVO en una respuesta NO rompe nada; uno DIVERGENTE sí.** Los addenda del backend
  suelen advertir que «un campo nuevo o divergente descarta la respuesta entera» y **para este
  repo eso es falso a medias**. Verificado contra zod 4.4.3, sin un solo `.strict()` ni
  `strictObject` en `lib/contracts/`: el comportamiento por defecto de `z.object` es *strip*, así
  que una clave que el schema no declara se descarta en silencio y el envelope sigue validando.
  Lo que sí falla es un campo declarado cuyo **tipo o forma** cambió.
  La consecuencia práctica: declarar un campo nuevo en el Zod hace falta para **usarlo**, no para
  «no romperse». Eso baja la urgencia de un despliegue coordinado, no la elimina — el frontend
  simplemente no ve el dato hasta que lo declare. Antes de tratar una advertencia así como
  bloqueante, comprobalo; el precio de creerla es un despliegue de emergencia que no hacía falta.

## Antes de abrir un PR

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` en verde.
- Si cambiaste un flujo o decisión, actualiza el doc correspondiente en `docs/`.
- Sin colores hardcodeados, sin `any` injustificado, con estados loading/empty/error.
