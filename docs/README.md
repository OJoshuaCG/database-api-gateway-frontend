# Documentación del frontend

Documentación del proyecto **frontend** (SPA React + TypeScript) del Database API
Gateway. El `README.md` del frontend es la guía rápida; aquí están las guías en
profundidad. Rutas de código (`src/...`) relativas a `frontend/`.

## Índice

| Documento | Contenido | Léelo si… |
|---|---|---|
| [`getting-started.md`](getting-started.md) | Requisitos, instalación, variables de entorno, scripts y solución de problemas (CORS). | …vas a levantar el proyecto por primera vez. |
| [`architecture.md`](architecture.md) | Capas, dependencias entre módulos, mapa de carpetas, árbol de providers y relación con el backend. | …quieres el panorama del frontend. |
| [`data-flow.md`](data-flow.md) | Recorrido de una solicitud archivo por archivo y los 8 escenarios más comunes (con diagramas). | …necesitas entender o depurar **cómo viaja un dato** desde un clic hasta el backend y de vuelta. |
| [`ui-components.md`](ui-components.md) | Catálogo de los componentes de `components/ui` y cómo usarlos. | …vas a construir o modificar una vista/formulario. |
| [`theming.md`](theming.md) | Tokens de color, tema claro/oscuro, cómo cambiar o añadir un color, accesibilidad. | …vas a tocar estilos o el sistema de temas. |
| [`testing.md`](testing.md) | Stack de tests (Vitest + RTL + MSW), utilidades y cómo escribir un test. | …vas a escribir o arreglar tests. |
| [`security.md`](security.md) | Modelo de seguridad del cliente: auth por cookie, almacenamiento, validación de entrada, XSS, CORS y datos sensibles. | …trabajas con auth, formularios o despliegue. |
| [`maintenance.md`](maintenance.md) | Convenciones, dónde vive cada cosa y recetas para **añadir un endpoint/feature**. | …vas a ampliar el frontend. |
| [`deployment.md`](deployment.md) | Build, servido del SPA (fallback de rutas), CORS, Docker/nginx, CI y checklist de endurecimiento. | …vas a desplegar o montar CI/CD. |
| [`adr/`](adr/) | Architecture Decision Records: el *porqué* de las decisiones clave. | …te preguntas "¿por qué está hecho así?". |

## Contexto del proyecto

- **Backend / contrato de la API:** documentado en
  [`../../backend/docs/`](../../backend/docs/) — el contrato vive en
  [`api-reference.md`](../../backend/docs/api-reference.md). El frontend solo **consume**
  ese contrato; no contiene lógica de negocio ni de seguridad.
- **Guía rápida del frontend:** [`../README.md`](../README.md).
- **Visión del monorepo:** [`../../README.md`](../../README.md).

## Convención

Estos documentos describen **el estado real del código**. Si cambias un flujo o una
decisión, actualiza el documento correspondiente en el mismo PR.
