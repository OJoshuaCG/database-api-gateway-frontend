# Database API Gateway — Frontend

## Qué es y por qué existe

SPA de **React + TypeScript** que es la única interfaz del **Database API Gateway**. El gateway
existe para que un administrador opere servidores de bases de datos remotos —MySQL, MariaDB y
PostgreSQL— **sin entrar al motor a mano** (cliente SQL, SSH): crear y borrar bases y usuarios,
otorgar privilegios, versionar esquemas y aplicarlos, comparar y clonar bases.

**Alcance y límites, que son lo que más se malinterpreta:**

- Es **solo cliente**. No tiene backend propio, ni lógica de negocio, ni de seguridad: consume el
  contrato de `backend/docs/api-reference.md` y nunca lee ni modifica código del backend.
- Es **single-admin**: no hay roles, tenants ni permisos por usuario. No implementes lógica de
  "ocultar botón según rol"; el único control es sesión válida o no (401 → login).
- Muchas acciones **tocan un motor de BD real** y son irreversibles. Se marcan con 🔌 en la UI.
  Trátalas con la seriedad que merecen: confirmación explícita, nada de reintentos automáticos.

**Dos conceptos que se cruzan todo el tiempo:** el *motor* (lo que existe físicamente en el
servidor) y el *inventario* del gateway (lo que este registró). Una base o un usuario puede
existir en uno, en otro o en ambos — de ahí los estados `adopted`/`unmanaged`/`orphan` y la
pantalla de reconciliación.

## Cómo funciona

```
Componentes → hooks (TanStack Query) → capa API (fetch + Zod) → /api/v1
```

- **Un componente nunca llama a `fetch`.** Todo pasa por `src/lib/api/client.ts`, que valida cada
  respuesta con Zod en runtime y normaliza los errores a `ApiError`.
- Estado de servidor: **TanStack Query** (caché, invalidación). Estado de UI: local o contextos
  transversales (tema, toasts, sesión). Auth por **cookie httpOnly**, nunca tokens en JS.
- Los contratos Zod se escriben **a mano** (ADR-0001): un cambio de forma en el backend falla al
  ejecutar, no al compilar. Si ves `[api] Respuesta no conforme al contrato` en consola, es eso.

Estructura: `src/features/<feature>/{api,hooks,components,pages}` + `index.ts` (barrel = API
pública de la feature, y lo que carga el router en modo lazy). Compartido en `src/components/ui`,
`src/lib/{api,contracts,toast,theme,syntax}`.

## Reglas del proyecto (resumen)

- **Todo el texto en español**: UI, comentarios y JSDoc. Los comentarios explican el *porqué*.
- **Colores solo por tokens** de `src/styles/theme.css`. Prohibido hex/rgb en componentes.
- **Sin `any`.** Sin class components. Type imports en línea: `import { X, type Y } from '…'`.
- **Prohibido `setState` síncrono dentro de `useEffect`** y **llamar funciones impuras en render**
  (`Date.now()`, `Math.random()`): `react-hooks` v7 lo marca como error.
- Prettier: sin punto y coma, comillas simples, ancho 100.
- Al añadir un endpoint: sigue la receta de `docs/maintenance.md` (contrato → servicio → query key
  → hook → UI con estados loading/empty/error → test) y **añade su fila a `docs/api-coverage.md`
  en el mismo PR**. Si cambias un flujo, actualiza su documento.
- Commits: `tipo(alcance): descripción` en español, con cuerpo que explique el *porqué*.

**Botones — icono vs. texto.** Usa `IconButton` (exige `label`, que pone `aria-label` y tooltip)
**solo** cuando la acción se repite —filas de tabla, barras— **y** es universalmente reconocible:
editar, eliminar, actualizar, copiar, navegar, ver/ocultar. Conserva el texto en las acciones de
dominio («Adoptar», «Reconciliar», «Aplicar a todas 🔌»), en los botones primarios de página, en
las confirmaciones destructivas finales y cuando el texto lleva un contador. Color: rojo solo en
dos intensidades — `danger-soft` para eliminar en fila, `danger` para la confirmación final; el
resto `ghost` u `outline`. En filas usa `size="icon-sm"`, que comparte alto y relleno con `sm`.
Iconos, siempre del set compartido `components/ui/icons.tsx`. **Ningún hover de un control puede
usar `bg-surface-muted`**: ese es el tinte con el que las filas de tabla se resaltan, y un botón
que lo repita se vuelve invisible dentro de una fila apuntada. Los controles se resaltan con
tinte de acento (`bg-primary/10`), que es otro tono y por eso nunca colisiona.

⚠️ **Ruido de fin de línea:** el árbol de trabajo tiene decenas de archivos marcados como
modificados que solo cambian CRLF↔LF, sin cambio real de contenido. Antes de commitear, comprueba
qué cambió de verdad (`git diff --ignore-cr-at-eol -- <archivo>`) y no arrastres ese ruido.

## Documentación: consúltala, no la memorices

`docs/` describe el estado real del código. Entra al que toque en lugar de cargarlo todo:

`maintenance.md` (convenciones y recetas — **el primero a leer para ampliar algo**) ·
`architecture.md` (capas y carpetas) · `data-flow.md` (recorrido de una request) ·
`api-coverage.md` (endpoint → pantalla) · `ui-components.md` · `theming.md` · `testing.md` ·
`security.md` · `deployment.md` · `adr/` (el *porqué* de las decisiones).

## Delegar en los agentes

Actúa como coordinador: para trabajo que abarca muchos archivos, **delega y quédate con las
conclusiones**, no con el volcado de los archivos. Lanza en paralelo lo que sea independiente y
asigna archivos disjuntos a cada agente para que no se pisen.

| Agente | Cuándo |
|---|---|
| `Explore` | Barridos de solo lectura: mapear dónde vive algo, rastrear un patrón por el repo. |
| `general-purpose` | Tareas de varios pasos que se pueden aislar (construir un componente, migrar N archivos). |
| `git` | **Agente propio del proyecto.** Commits granulares y mensajes según la convención. Confirma siempre el alcance antes de `git add`. |
| `Plan` | Diseñar la estrategia de un cambio grande antes de tocar código. |
| `claude-code-guide` | Dudas sobre Claude Code, el Agent SDK o la API de Claude. |

Cuando delegues, dale al agente el contexto que ya reuniste (rutas exactas, firmas, convenciones
de arriba). Un agente sin contexto reinventa patrones que este repo ya tiene resueltos.

## Tests: escribirlos sí, ejecutarlos no

**No ejecutes los tests salvo que se te pida explícitamente.** Ni `pnpm test`, ni `vitest run`,
ni variantes — tampoco como comprobación final al cerrar una tarea.

- **Sí** escribe y actualiza los tests que correspondan: siguen siendo parte del entregable.
- **Solo** ejecútalos cuando se pida en ese momento («corré los tests», «verificá que pasan»).
  Una autorización puntual no se extiende a las tareas siguientes.
- Cuando los ejecutes a petición, **acota el alcance** al archivo o carpeta afectados
  (`npx vitest run ruta/al/archivo.test.ts`); no lances la suite completa salvo que se pida.
- Al terminar, **di explícitamente que no se ejecutaron**. Nunca afirmes ni insinúes que los
  tests pasan si no los has corrido.

Motivo: en este entorno (WSL2 sobre `/mnt/c`) el arranque de cada worker de Vitest es muy lento
—la suite completa tarda varios minutos y a veces los workers ni siquiera arrancan—, así que
ejecutarla por rutina cuesta mucho más de lo que aporta.

`pnpm typecheck`, `pnpm lint` y `pnpm build` **sí** se siguen ejecutando con normalidad: son
rápidos y detectan la mayor parte de las regresiones.
