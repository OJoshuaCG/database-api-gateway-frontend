# Catálogo de componentes UI

Primitivos reutilizables en `src/components/ui/` (barrel: `import { … } from '@/components/ui'`).
Son **presentacionales y sin lógica de negocio**: reciben datos y callbacks por props.
Todos consumen tokens de color (ver [`theming.md`](theming.md)) y cuidan accesibilidad
(foco visible, ARIA).

> Regla: si un componente sirve a varias features → vive aquí. Si es específico de una
> feature → en `src/features/<f>/components/`.

## Formularios y controles

### `Button`
Botón con variantes y estado de carga. **No** usa neumorphism (rompería el contraste).

- Props: `variant` (`primary` | `secondary` | `accent` | `outline` | `ghost` | `danger`),
  `size` (`sm` | `md` | `lg` | `icon`), `isLoading`, + atributos nativos de `<button>`.
- `isLoading` deshabilita y muestra `Spinner`.

```tsx
<Button variant="danger" isLoading={mutation.isPending} onClick={…}>Eliminar</Button>
```

### `Input` / `Textarea`
Campo con `label`, `error`, `hint` y `aria-invalid`/`aria-describedby` cableados.
Pensados para `react-hook-form` con `{...register('campo')}`.

```tsx
<Input label="Host" required error={errors.host?.message} {...register('host')} />
```

### `Checkbox`
Checkbox con `label` y `hint`. Para flags simples dentro de formularios.

### `Switch`
Interruptor accesible (`role="switch"`) **controlado**: `checked` + `onCheckedChange`.
Úsalo para flags como `provision` / `drop_remote`.

```tsx
<Switch checked={provision} onCheckedChange={setProvision} label="Aprovisionar 🔌" />
```

### `Combobox<T>`
Select **con búsqueda** accesible (Downshift). Filtrado client-side sobre `items`.

- Props clave: `items`, `value`, `onChange`, `itemToString`, `itemToKey`, `renderItem?`,
  `label`, `placeholder`, `error`, `disabled`, `isLoading`, `clearable`, `required`.
- En formularios se usa con `<Controller>` de RHF (el valor suele ser el objeto, y se
  mapea a un id en `onChange`).

```tsx
<Combobox<ServerOut>
  items={servers} value={selected} onChange={setSelected}
  itemToString={(s) => s.name} itemToKey={(s) => s.id} label="Servidor" clearable />
```

### `MultiCombobox<T>`
Multiselect con búsqueda (Downshift `useMultipleSelection`). Mismo estilo de props que
`Combobox` pero con `selectedItems: T[]` + `onChange(items: T[])`. Lo usa `DataTable` para
elegir columnas visibles.

## Datos y estados

### `DataTable<T>`
Tabla basada en TanStack Table. **Orden, búsqueda global y visibilidad de columnas son
client-side**; la paginación/filtros server-side se controlan fuera (ver
[ADR-0003](adr/0003-tablas-orden-busqueda-cliente.md)).

- Props clave: `data`, `columns` (`ColumnDef<T>[]`), `isLoading`, `isFetching`,
  `emptyState`, `enableGlobalFilter`, `enableColumnVisibility`, `toolbar` (slot para
  filtros server-side), `clientPageSize` (activa paginación client-side para listas no
  paginadas como privilegios).
- Muestra filas-esqueleto mientras `isLoading`.

### `Pagination`
Controles de paginación **server-side** (`page`/`size` del backend): `page`, `pages`,
`total`, `size`, `hasNext`, `hasPrev`, `onPageChange`, `onSizeChange?`. Se renderiza bajo
el `DataTable` cuando la lista es paginada por la API.

### `EmptyState`
Estado "sin datos": `title`, `description?`, `action?`, `icon?`.

### `ErrorState`
Estado de error: recibe `error` (cualquier cosa), lo normaliza con `toApiError`, muestra
el mensaje y un botón `onRetry`. Añade una nota cuando es error de motor (502/504).

### `Spinner` / `FullPageSpinner`
Indicador de carga accesible (`role="status"`). `FullPageSpinner` centra a pantalla
completa (p. ej. verificación de sesión).

## Superficies y overlays

### `Card` (+ `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`)
Contenedor de superficie. Prop `clay` aplica el tratamiento claymorphism (solo
contenedores, nunca controles).

### `Modal`
Diálogo modal accesible basado en el elemento nativo **`<dialog>`** (focus-trap, cierre
con Esc y backdrop gratis). Props: `open`, `onClose`, `title`, `description?`, `footer?`,
`size?`.

### `ConfirmDialog`
Confirmación construida sobre `Modal`. Para borrados destructivos, `confirmWord` exige
**reescribir el nombre exacto** del recurso (doble confirmación, alineado con
`confirm_name` / `confirm_username` del backend). El botón se habilita solo al coincidir.

```tsx
<ConfirmDialog open onClose={…} onConfirm={…}
  title="Eliminar base de datos" confirmWord={dropRemote ? db.name : undefined}
  confirmLabel="Eliminar" isLoading={pending} />
```

> Patrón: los diálogos de borrado se **montan condicionalmente** (`{target && <Dialog/>}`)
> para tener estado fresco sin `setState` en efectos. Ver [`maintenance.md`](maintenance.md).

## Layout (en `src/components/layout/`)

`AppShell` (sidebar + topbar + boundary por sección), `Sidebar` (navegación),
`Topbar` (sesión, logout, tema, health), `ThemeToggle`, `SectionErrorFallback`,
`PageHeader` (título + descripción + acciones de cada página).

## Patrón típico de una vista de datos

```tsx
const { data, isLoading, isError, error, refetch } = useServers({ page, size })

if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />
return (
  <>
    <DataTable data={data?.items ?? []} columns={columns} isLoading={isLoading}
      emptyState={<EmptyState title="Aún no hay servidores" />} />
    {data && <Pagination {...data.pagination} onPageChange={setPage} />}
  </>
)
```
