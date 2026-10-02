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

- Props: `variant` (`primary` | `secondary` | `accent` | `outline` | `ghost` | `danger` |
  `danger-soft`), `size` (`sm` | `md` | `lg` | `icon`), `isLoading`, + atributos nativos de
  `<button>`.
- `isLoading` deshabilita y muestra `Spinner`.

```tsx
<Button variant="danger" isLoading={mutation.isPending} onClick={…}>Eliminar</Button>
```

Para un **enlace con aspecto de botón** (navega, no ejecuta) usá `buttonClassName({ variant, size })`
sobre el `<Link>`. Nunca un `<Button>` dentro de un `<Link>`: son dos controles anidados (HTML
inválido y dos paradas de tabulación para una sola acción).

#### Cuándo usar cada variante

Todas las variantes deben verse como **botón** en reposo (fondo y/o borde visibles), no
solo al hacer hover — esto es intencional tras detectar que `ghost` sin borde se percibía
como texto plano y confundía a los usuarios.

| Variante | Uso | Ejemplo |
| --- | --- | --- |
| `primary` | Acción principal de la vista/formulario (una por pantalla). | Guardar, Crear, Confirmar |
| `secondary` / `accent` | Acciones alternativas de marca, poco frecuentes. | — |
| `outline` | Acción secundaria con el mismo peso visual que `primary` pero sin color de marca. | Adoptar, Probar conexión |
| `ghost` | Acción de fila **no destructiva** en tablas/paneles (bajo énfasis, pero con borde sutil visible en reposo). | Editar, Ver grants, Reasignar, Revelar, Rotar contraseña, Cancelar |
| `danger-soft` | Acción de fila **destructiva** en tablas/paneles (mismo bajo énfasis que `ghost`, pero en rojo sutil para diferenciarla del resto). | Botón "Eliminar" dentro de una fila de `DataTable` |
| `danger` | Acción destructiva de **alto énfasis**: solo el botón de confirmación final dentro de `ConfirmDialog`. El botón de la cabecera de una ficha que ABRE ese diálogo va en `danger-soft`, como en una fila. | Confirmar borrado en `ConfirmDialog` |

Regla práctica: en una fila de `DataTable`, el patrón estándar es **`ghost` para las
acciones normales + `danger-soft` para "Eliminar"** (nunca `ghost` para eliminar, ni
`danger` sólido repetido en cada fila — es demasiado intenso para usarse así). El `danger`
sólido se reserva para el momento de mayor relevancia (confirmación final o acción sin
diálogo intermedio).

```tsx
// Patrón estándar de acciones de fila en una tabla
<Button variant="ghost" size="sm" onClick={onEdit}>Editar</Button>
<Button variant="danger-soft" size="sm" onClick={() => setDeleteTarget(row.original)}>
  Eliminar
</Button>
```

### `RowActionButton`
Acción de una fila de tabla. Props: `label`, `subject` (la fila: nombre de la base,
`usuario@host`), `onClick`, `variant?`, `icon?`, `iconText?` (`table` | `card`), `isLoading?`,
`disabled?`. Resuelve tres cosas que cada fila hacía a su manera:

- **Nombre accesible con contexto** (`rowActionName`): empieza por el texto visible (WCAG 2.5.3)
  y añade la fila — `Quitar del inventario «tienda_42»` —; el 🔌 se lee «(toca el motor)».
- **Texto en la tarjeta**: con `iconText="card"` el icono lleva también su texto por debajo de
  `md`, donde no hay tooltip. Úsalo para los iconos que no están en la lista de universales
  (editar, eliminar, actualizar, copiar, navegar, ver/ocultar): quitar del inventario, comparar,
  clonar.
- Sin `icon`, es un botón `sm` con texto.

El contenedor de la fila debe llevar `flex-wrap`: en la tarjeta de `< md` una fila con seis
acciones no cabe en un móvil y la destructiva quedaría fuera de pantalla.

### `Input` / `Textarea`
Campo con `label`, `error`, `hint` y `aria-invalid`/`aria-describedby` cableados.
Pensados para `react-hook-form` con `{...register('campo')}`.

```tsx
<Input label="Host" required error={errors.host?.message} {...register('host')} />
```

### `Checkbox`
Checkbox con `label`, `hint` y `caption?` (una línea propia bajo la etiqueta, fuera del nombre
accesible: p. ej. el id técnico en monoespaciada). Para flags simples dentro de formularios.

### `Switch`
Interruptor accesible (`role="switch"`) **controlado**: `checked` + `onCheckedChange`.
`describedBy?` suma a su `aria-describedby` un texto de afuera (el aviso de acceso de la pantalla
cuando está deshabilitado).
Úsalo para flags como `provision` / `drop_remote`.

```tsx
<Switch checked={provision} onCheckedChange={setProvision} label="Aprovisionar 🔌" />
```

### `RadioCardGroup<T>`
Grupo de radio-cards (**una opción por grupo**) dentro de un `<fieldset>` con `<legend>` visible y
borde propio. Úsalo **siempre que haya más de un grupo de radios en la misma pantalla**: el borde y
el título por grupo son lo que evita que se lean como una sola lista de opciones entre las que hay
que elegir una. Cuando los grupos son secuenciales, numera el `title` (`"1. …"`, `"2. …"`).

Props: `title`, `description?`, `options` (`{ value, label, hint?, disabled? }`), `value` (`T | null`,
`null` = nada marcado), `onChange`, `columns?` (`1 | 2 | 3`, por defecto `2`), `name?`, `className?`.
El `hint` acepta `ReactNode` (puede llevar `<code>` o datos interpolados) y queda ligado al radio por
`aria-describedby`. Usa `columns={1}` cuando los hints sean largos.

```tsx
<RadioCardGroup<SelectionMode>
  title="1. Cómo eliges las bases de datos"
  description="Elige una de estas dos formas de localizar las BDs que vas a comparar."
  options={SELECTION_MODES}
  value={wizard.selectionMode}
  onChange={wizard.setSelectionMode}
/>
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
- **Regla del proyecto: ninguna tabla lleva scroll horizontal**, salvo un caso
  extraordinario justificado y documentado en el propio componente. Por debajo de `md`
  `DataTable` deja de renderizar `<table>` y muestra una tarjeta por fila (par
  etiqueta/valor por columna, más la columna de acciones — la de `header: ''`, convención
  ya usada en toda la app — al final sin etiqueta). Esto es automático para cualquier
  consumidor: no hay que hacer nada especial al definir `columns` más allá de seguir esa
  convención de `header: ''` en la columna de acciones.
- `columnWidths?` (`{ [idDeColumna]: '14%' }`): pasa la tabla a `table-layout: fixed` con un
  `<colgroup>`, así el ancho deja de depender del contenido. **Solo** para varias tablas
  apiladas que tienen que leerse como una —la matriz de «Roles y capacidades», una tabla por
  módulo que con ancho automático salía en escalera—. Las columnas sin ancho se reparten el
  resto; usá porcentajes para no desbordar en `md`. No toca las tarjetas de `< md`.

### `Pagination`
Controles de paginación **server-side** (`page`/`size` del backend): `page`, `pages`,
`total`, `size`, `hasNext`, `hasPrev`, `onPageChange`, `onSizeChange?`. Se renderiza bajo
el `DataTable` cuando la lista es paginada por la API.

### `EmptyState`
Estado "sin datos": `title`, `description?`, `action?`, `icon?`.

### `ErrorState`
Estado de error: recibe `error` (cualquier cosa), lo normaliza con `toApiError`, muestra
el mensaje y un botón `onRetry`. Añade una nota cuando es error de motor (502/504).
`message?` reemplaza el texto del backend cuando la feature ya tradujo el `code` del error
(`ui` no conoce los códigos de ninguna feature: el llamador lo resuelve y lo pasa).

### `Badge` y `StatusLegend`
`Badge` es la etiqueta de estado (`tone`, `children`, `title?`). **Su `title` es solo matiz para
el hover con puntero**: va en un `<span>` no interactivo, así que no llega a lectores de pantalla,
no se enfoca con teclado y en táctil no existe. Nada que decida algo —el motivo de un bloqueo, un
riesgo, la consecuencia de un estado— puede vivir solo ahí. Lo mismo vale para un
`<span title>` alrededor de un botón deshabilitado: el motivo va **visible** al lado del control.

Para la consecuencia de los estados de una tabla está `StatusLegend` (`items: { key, label, tone,
description }[]`, `title?`): una lista de definiciones bajo la tabla, **una vez** y solo con los
estados presentes, en vez de repetir la misma prosa en cada fila. La usan `CollationDriftPanel` y
`VersionTablesReportPanel`. Si el aviso es uno solo y bloquea, es un `Callout`.

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
`size?`. Al cerrarse devuelve el foco al elemento que lo tenía al abrirse, si sigue en el
documento: el `<dialog>` se desmonta sin `close()` y el navegador no lo hace solo.

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

## SQL (visor y editor)

### `CodeBlock`
Visor de SQL de solo lectura: resaltado por tokens (`src/lib/syntax/sql-highlight.ts`),
numeración, copiar y expandir a pantalla completa. Props: `code`, `title?`, `extra?`,
`maxHeightClass?` (`max-h-80`), `hideLineNumbers?`, `emptyLabel?`, `hideFullscreen?`,
`highlightLine?` (resalta esa línea, la marca con `aria-current` y la lleva al centro de la vista;
sin la prop el visor no cambia).
**Es la única forma correcta de mostrar SQL**: no montes un `<pre>` propio.

### `SqlEditor` / `SqlField`
Editor con resaltado *mientras se escribe*: un `<pre>` coloreado debajo y el `<textarea>`
real encima, transparente. `SqlField` es el puente con react-hook-form (y cae a `CodeBlock`
cuando el campo es de solo lectura). Las dos capas comparten tipografía, caja y ancho útil
al carácter; si tocas una, toca la otra o el cursor deja de coincidir con el texto.

`rows` es el alto de **partida y mínimo**. Con `maxRows`, el editor además **crece con el
contenido** hasta ese tope y a partir de ahí desplaza — es el equivalente editable del
tirador de alto del `CodeBlock`. `SqlField` lo trae puesto (`rows` 12, `maxRows` 40), así
que un campo de SQL de formulario acompaña a lo que se escribe sin tocar nada. El alto se
mide en líneas **lógicas**, las mismas que numera la columna: en modo ajuste una línea
envuelta ocupa más de un renglón y la cuenta se queda corta, y para eso queda el scroll.

> `maxRows` es un tope **de pantalla, no de contenido**: un DDL de mil líneas no estira el
> campo hasta ocupar la página. La cuenta es `rows × 1.25rem + 1.5rem`, así que 40 líneas
> ≈ 51rem (≈820 px). Para leer el SQL entero de un vistazo está el visor a pantalla completa.
>
> Solo afecta al **alto**. El ancho de la caja lo hereda del contenedor y nunca lo empuja:
> su `overflow-hidden` resuelve a 0 el `min-width: auto` del ítem flex, así que una línea
> larguísima desplaza *dentro* del editor y no le saca scroll horizontal a la página. Si
> alguna vez se quita ese `overflow-hidden`, hay que poner `min-w-0` en su lugar.

### Los dos modos de lectura
Ajuste de línea (**por omisión**) o scroll horizontal. Se conmuta con el botón de la barra
de cualquier `CodeBlock`, pero **la preferencia es global** (`SqlWrapProvider`, ver
[`theming.md`](theming.md)): todos los bloques cambian a la vez, para que dos SQL contiguos
nunca se lean con reglas distintas. La aplica el CSS desde `[data-sql-wrap]`, así que
alternar no re-renderiza ningún bloque.

El ajuste es seguro para DDL porque se numera **una fila por línea lógica** y la
continuación de una línea envuelta queda sangrada bajo el código, nunca a la altura del
número. Los números se pintan con `content: attr(data-line)`: al ser contenido generado no
entran en la selección, así que copiar con el ratón devuelve SQL limpio.

> **Nunca `break-all` sobre SQL**: partir un identificador a mitad cambia lo que el ojo
> lee. Un literal larguísimo sin espacios sigue desbordando, y para eso el bloque conserva
> su scroll horizontal en los dos modos. Sobre un checksum o una ruta sí es correcto.

### Alto ajustable
A partir de unas pocas líneas el bloque trae tirador de alto en su esquina inferior. En
cuanto se agarra, `maxHeightClass` deja de ser un tope y pasa a ser solo el alto de
partida, y entra en juego un mínimo de cuatro líneas. Es por bloque y no se recuerda entre
montajes: es un ajuste de lectura del momento, no una preferencia como el ajuste de línea.

## Autorización (en `src/features/auth/components/`)

Piezas de la feature `auth`, exportadas por su barrel. **Todo sale del catálogo**
(`GET /authz/catalog`, vía `useCapabilityCatalog`): ninguna lleva una lista de capacidades
escrita a mano. Sin catálogo, lo dicen («No se pudo cargar qué incluye este rol.») y no inventan.
La lógica vive aparte, en funciones puras de `features/auth/authz-model.ts`
(`resolveEffectiveAccess`, `effectiveRoleAt`, `diffCapabilities`, `roleCapabilityIds`…), que es el
espejo de `app/core/scope.py` del backend.

### `CapabilityFlags`
Marcas de una capacidad, siempre icono + texto visible: Destructiva, Modifica, Divulga datos,
Pedirá reautenticación, Usable por agentes, Solo lectura. Props: `capability`, `compact?` (solo
las de riesgo). «Destructiva» sale de `DESTRUCTIVE_CAPABILITIES` (`lib/contracts/auth.ts`), porque
el catálogo no publica esa marca. La leyenda es `CAPABILITY_FLAG_LEGEND`, para una `StatusLegend`.

### `RoleCapabilitySummary`
Una línea bajo un selector de rol: «Otorga 17 de 30. No incluye: …». Props: `role`, `catalog`,
`isLoading?`, `compareTo?` (pasa a decir qué suma o pierde respecto de ése, con las mismas marcas,
colores y salvedad de «qué se aplica hoy» que `EffectiveAccessPanel`), `linkToMatrix?` (enlace a
`/gateway-users?tab=roles`). Reemplaza a las descripciones de rol escritas a mano, que llegaron a
ser falsas. La intención de cada rol y global en una línea («Consulta sin cambiar nada»…) vive en
un solo mapa, `ROLE_PURPOSES` de `authz-model.ts`, y el nombre legible de cada global en
`GLOBAL_CAPABILITY_LABELS`.

### `EffectiveAccessPanel`
Qué puede hacer alguien y dónde: rol base, una fila por permiso con su diferencia respecto del
base, los cruces entorno × servidor (rige el más restrictivo) y las capacidades globales; cada
fila despliega sus capacidades con «Ver capacidades». Props: `baseRole`, `globalCapabilities`,
`grants` (`{ scopeType, scopeId, role, targetLabel }[]`, con el nombre del destino ya resuelto),
`catalog`, `isLoading?`, `mode` (`admin` en la página de accesos, `self` en «Mi acceso»), `idPrefix?`
(da a cada fila de permiso el `id` de `effectiveAccessRowId(prefix, tipo, id)`, para enlazarla:
la página de accesos pone «Ver el efecto al guardar» en cada permiso en vez de repetir la diferencia).
Lo desplegado se recuerda por destino (`tipo:id`), no por posición. Las diferencias marcan
«Suma destructivas» (rojo) y «Quita destructivas» (neutro) por separado, y lo perdido dice qué
parte se hace cumplir hoy (`lostEnforcementNote`; `databases.write`, solo en borrar y aprovisionar).
Con permisos de entorno, la fila base nombra el entorno más protegido, que es adonde caen las bases
sin clasificar. **Lleva siempre la nota de dónde se aplica hoy el recorte por alcance**
(`SCOPE_ENFORCEMENT_NOTE`): solo en borrar bases, aprovisionar, aplicar y revertir versiones; en lo
demás rige el rol unión.

**Dos fuentes, que no se mezclan.** Con `serverAccess` (`{ data, isLoading, isError, onRetry? }`, el
resultado de `useEffectiveAccess`; solo `access_admin` puede leerlo, así que quien llama no lo
pide si no lo es) el panel muestra lo que rige HOY según el servidor, una fila por fuente
(«Por rol», «Rol por alcance», «Global», «Puntual» con el nombre de su alcance; las lecturas
implícitas de una puntual dicen de cuál vienen y una persona desactivada las muestra «Inactiva»).
Con `hasUnsavedChanges` agrega debajo la «Vista previa: así quedaría al guardar», calculada en el
navegador con `resolveEffectiveAccess` (espejo de `capability_resolution.py`) y rotulada como tal.
Sin `serverAccess` (`self`, o quien no es `access_admin`) solo hay cálculo local, y
`capabilityGrants` (`/auth/me.capability_grants`) alimenta las filas «Puntual»; las `pending` se
nombran en una línea y no suman nada.

### `CapabilityCallout`
**El** aviso de acceso de una pantalla: uno solo, arriba, en lugar de un motivo repetido junto a
cada control deshabilitado. Título «Podés {canDo}, pero no {cannotDo}»; el cuerpo nombra lo que
falta con la etiqueta del catálogo (`«label», id`, sin catálogo solo el id) y termina siempre en
«Pedíselo a quien administra los accesos.» (`ASK_FOR_ACCESS`). Props: `canDo`, `cannotDo` (en
infinitivo y sin «no»; para enumerar, `joinWithNi` de `authz-model.ts`), `missing` (los
`guard.missing` de una o varias guardas; se deduplican), `unresolved?` (`guard.unresolved`: con
destino y la capa 2 todavía sin resolver dice «Comprobando…» / «No se pudo comprobar…» en vez de
afirmar que falta algo), `id?`, `className?`, `children?` (contexto propio, después del motivo).
No pinta nada si `missing` está vacío. Cada control deshabilitado lo referencia con
`aria-describedby={id}` (en `Switch`, `describedBy`; en `ConfirmDialog`, `confirmDisabled` +
`confirmDescribedBy`). Lo usan la pestaña de migraciones de una base, la cabecera del blueprint, su
tabla de estado, Servidores, Perfiles de permisos, Privilegios, Charset/collation, la consola SQL y
el paso de datos-semilla.

### `CapabilityHint` y `ForbiddenState`
`CapabilityHint` es el motivo **visible** de un control deshabilitado por `useCapabilityGuard`
(`guard`, `className?`): pinta `guard.hint` con el `id` que el control referencia por
`aria-describedby={guard.describedBy}`, y nada si está permitido. Una guarda por control: cada una
trae su propio `hintId`. `ForbiddenState` (`title?`) es el estado de página para un 403
`access.forbidden`, en lugar de `ErrorState`: el copy de `forbiddenCopy()` y el enlace «Ver mi
acceso», **sin «Reintentar»** (el mismo pedido daría el mismo 403).

`RolesCapabilitiesPanel` (en `features/gateway-users`) es la pestaña «Roles y capacidades» de
`/gateway-users`: una tarjeta por rol y por global, y la matriz por módulo con `DataTable`
(búsqueda, filtro por rol y por riesgo). Cada módulo es una tabla, pero todas comparten los mismos
anchos (`columnWidths`), así que se leen como una sola matriz con secciones.

### `CapabilityGrantsSection` («Capacidades puntuales»)
Sección de `GatewayUserAccessEditor` (`features/gateway-users/components`) para otorgar UNA
capacidad sobre UN entorno o servidor sin cambiar el rol (api-reference §19). Props: `user`
(`id`, `username`, `is_active`), `isSelf`, `catalog`, `isCatalogLoading`.

- **Solo `access_admin`**: el editor la monta únicamente con esa global (el listado es suyo). Con
  otro rol no existe en el DOM y no dispara ninguna consulta; el panel de acceso efectivo ya avisa
  que las puntuales no se incluyen.
- **Es inmediata**: tiene sus propios endpoints y `PUT /access` no las toca, así que no pasa por
  «Guardar accesos» ni activa la vista previa ni el aviso de salida. La cabecera lo dice.
- **Formulario «Otorgar capacidad»**: el selector lista solo las filas del catálogo con
  `grantable`, agrupadas por módulo (el id en mono y, si es `sensitive`, «Requiere aprobación de
  otro admin»); tipo de destino entorno|servidor y destino de `useSelectableEnvironments` /
  `useServerOptions`; motivo opcional (máx. 500). Se deshabilita con el motivo visible si la
  persona es la propia cuenta (`access.self_modification_forbidden`) o está desactivada
  (`access.grant_user_inactive`); una viva igual en la lista bloquea el envío con una pista
  (`access.grant_duplicate` sigue siendo la verdad del servidor).
- **Resultado**: una no sensible nace `active` («Capacidad otorgada… ya rige»); una sensible nace
  `pending` y el mensaje dice que **todavía no concede acceso** hasta que otra persona con
  `access_admin` la apruebe (bandeja: `PendingCapabilityGrantsCard`). Un error `access.*` sale en el formulario
  (`capabilityGrantErrorMessage`, `role="alert"`) además del toast; el 403 usa `forbiddenCopy()`.
- **Lista** (`DataTable`, tarjetas bajo `md`): vigentes por defecto (`active` + `pending`); la
  casilla «Ver también el historial» suma rechazadas, vencidas, canceladas y revocadas. Un solo
  `GET` sin filtro; el filtrado es del cliente. «Revocar» (activa) y «Cancelar solicitud»
  (pendiente) conservan el texto —acción de dominio— y piden `ConfirmDialog` en rojo, un solo
  admin, sin segundo aprobador. Con la propia cuenta van deshabilitados.
- **Refresco**: los hooks invalidan todo `capabilityGrants.all`, así que el acceso efectivo de
  al lado se actualiza solo tras otorgar, revocar o cancelar.

### `PendingCapabilityGrantsCard` («Solicitudes pendientes»)
Pestaña `?tab=pending` de `GatewayUsersPage` (`features/gateway-users/components`), sin props: la
monta la página solo para `access_admin` (con otro rol la pestaña no se ofrece y la bandeja no se
pide; un enlace directo muestra `ForbiddenState`). La pestaña lleva el recuento en una insignia y se pide aun fuera de ella para que sea descubrible. Flujo en
[`capability-grants.md`](capability-grants.md).

- **Fila** (`DataTable`, tarjetas bajo `md`): persona, capacidad (etiqueta, id en mono y lectura
  implícita), alcance, quién la pidió con fecha y motivo, y vencimiento.
- **«Aprobar» / «Rechazar»** conservan el texto (acción de dominio) y su nombre accesible dice qué y
  de quién. Con `can_decide: false` los dos van deshabilitados y el `blocked_reason` se muestra
  debajo, enlazado por `aria-describedby`; un código que la UI no conoce cae en un copy genérico
  para no dejar un botón mudo.
- **Diálogo** (`ConfirmDialog`): motivo opcional (máx. 500). Aprobar es primario; rechazar, rojo,
  por ser la confirmación final. Un 404/409 se queda en el diálogo (`role="alert"`) con la
  confirmación deshabilitada; los hooks refrescan la bandeja y la fila desaparece sola.

`GatewayUserAccessPage` (`/gateway-users/:userId/accesos`, en `features/gateway-users`) es el
editor de accesos de una persona, que antes era un modal: cabecera con el usuario y su rol base,
y en dos columnas desde `lg` el formulario (`GatewayUserAccessEditor`: «Capacidades globales»,
«Permisos por entorno o servidor» y, solo para `access_admin`, «Capacidades puntuales»)
y al costado «Acceso efectivo al guardar». «Guardar accesos» va en una barra fija al pie con la
nota de sesiones; salir con cambios sin guardar pide confirmación. `CheckIcon` y `KeyIcon` se sumaron a `icons.tsx` para ella;
`UserIcon`, para el enlace «Mi cuenta» de la `Topbar`.

## Layout (en `src/components/layout/`)

`AppShell` (sidebar + topbar + boundary por sección), `Sidebar` (navegación),
`Topbar` (sesión, logout, tema, health), `ThemeToggle`, `SectionErrorFallback`,
`PageHeader` (título + descripción + acciones de cada página). Las acciones se parten en varias
líneas y el título corta palabras largas: una ficha con ocho acciones no puede aplastar el título
ni desbordar la página.

### Nada de scroll horizontal en la página

`AppShell` coloca el contenido en la segunda columna de un grid. Un ítem de grid (o de flex)
tiene `min-width: auto`, es decir: su ancho mínimo es el de su contenido, no cero. Sin
`min-w-0` una tabla ancha o un `CodeBlock` con SQL largo estiran la columna más allá del
viewport y el scroll horizontal aparece en toda la página, en vez de quedarse dentro del
contenedor con `overflow-auto` que esos componentes ya traen. Por eso la columna y el `<main>`
llevan `min-w-0`.

Al montar layouts nuevos:

- Un contenedor **flex en fila** cuyo hijo pueda contener una tabla, un `CodeBlock` o texto
  monoespaciado largo necesita `min-w-0` en ese hijo.
- Las rejillas `grid-cols-N` de Tailwind ya usan `minmax(0, 1fr)` y son seguras. Una plantilla
  arbitraria (`grid-cols-[1fr_8rem]`) **no** lo es: escribe `minmax(0,1fr)` en vez de `1fr`.
- Evita `min-w-[Xrem]` grande en barras de herramientas: suma al mínimo de toda la fila y
  desborda antes de que nada pueda encogerse. Sube el contenido de breakpoint en su lugar.

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
