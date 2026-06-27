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

6. **Test** — añade al menos un test del hook con MSW (mira
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
| Lista dinámica en un formulario | `useFieldArray` de RHF (p. ej. items de un perfil de permisos) |

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
- **`apply-profile`:** la UI construye `object_mappings` por nivel a partir de una BD/esquema
  objetivo; para perfiles con items a nivel **tabla/columna** habría que extender ese mapeo.
- **Owner de una BD:** debe pertenecer al **mismo servidor**; al cambiar el servidor en el
  formulario se resetea `owner_id` (si no, el backend responde **409**).
- **`/health`:** vive fuera de `/api/v1` y puede no tener CORS; el `HealthBadge` se degrada
  en silencio.
- **Validación de contrato (Zod) en runtime:** si el backend cambia un shape, verás en
  consola `[api] Respuesta no conforme al contrato` y un error "respuesta inesperada".
  Es la señal de que hay que actualizar `lib/contracts/`.

## Antes de abrir un PR

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` en verde.
- Si cambiaste un flujo o decisión, actualiza el doc correspondiente en `docs/`.
- Sin colores hardcodeados, sin `any` injustificado, con estados loading/empty/error.
