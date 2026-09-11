# ADR-0007 — Las capacidades son una pista de UI, y la ausencia de datos falla ABIERTO

**Estado:** Aceptada

## Contexto

`api-reference-v23` convirtió la autorización del gateway en un vocabulario cerrado de 29
capacidades. Cada endpoint declara la suya y el servidor la exige; `GET /auth/me` publica las
**efectivas** del usuario para que la interfaz decida qué mostrar.

Eso abre una pregunta que el contrato deja explícitamente en manos del cliente: **qué hace la SPA
cuando `capabilities` llega vacío o ausente.** Pasa en dos casos reales, no hipotéticos:

1. Un backend anterior a v23, que devuelve `/auth/me` con solo `id` y `username`.
2. Un despliegue a medias: frontend nuevo contra gateway viejo, que es exactamente el orden en el
   que se despliega cuando el backend va detrás.

Y hay una tentación fuerte de resolverlo del lado "seguro": si no sé qué puede hacer, no le muestro
nada.

## Decisión

**`capabilities` es una pista de presentación, nunca una barrera.** De ahí se derivan las dos
reglas que implementa `useCapabilities`:

1. **Lista ausente o vacía ⇒ se asume permitido** (*fail-open*). La ausencia de información no es
   una denegación.
2. **Lista presente ⇒ se decide por ella.** Ahí el backend está afirmando algo concreto.

Toda pantalla sigue manejando el 403 aunque el control esté deshabilitado u oculto.

## Por qué no fail-closed, que es el reflejo natural

Porque invertiría el daño hacia la persona equivocada. Tratar la ausencia como denegación deja la
aplicación **entera sin un solo botón habilitado** contra un gateway perfectamente funcional: un
apagón total provocado por un campo que el propio contrato define como una pista.

El argumento de seguridad no se sostiene al mirarlo de cerca, porque **la pista no es la barrera**.
El servidor exige la capacidad en cada request, y la exige igual esté el botón visible o no. Lo
peor que produce fallar abierto es que alguien llegue hasta un 403 que de todos modos lo iba a
frenar — un viaje de ida y vuelta desperdiciado. Fallar cerrado, en cambio, le rompe el trabajo a
quien **sí** tenía permiso, y lo hace de una forma que además parece un bug de la aplicación en vez
de una restricción.

Dicho de otro modo: el costo del fail-open es fricción para alguien que no podía hacerlo igual; el
del fail-closed es negarle el trabajo a alguien que sí podía. No son simétricos.

## Consecuencias

- ✅ Un gateway anterior a v23 sigue funcionando exactamente igual que antes.
- ✅ El orden de despliegue deja de importar: frontend nuevo contra backend viejo no rompe nada.
- ✅ La superficie de autorización real no cambia — sigue estando entera del lado del servidor.
- ⚠️ Contra un backend viejo, la interfaz ofrece controles que pueden terminar en 403. Es el precio
  aceptado, y por eso los mensajes de error de autorización tienen que seguir siendo legibles: ver
  `access.forbidden` en `lib/contracts/auth.ts`.
- ⚠️ **`capabilities` nunca debe usarse como si fuera un permiso.** Si alguna vez aparece una
  decisión que dependa de veras de la autorización —y no de la presentación—, tiene que resolverse
  con una llamada al servidor, no con esta lista.

## Nota sobre el 403 y sobre lo que sí se le dice al usuario

El 403 del contrato es cerrado y **no nombra la capacidad que falta**, para no darle a un atacante
un mapa de la superficie por fuerza bruta. Eso **no** aplica a los controles deshabilitados de la
propia sesión (`useCapabilityGuard`), que sí nombran la capacidad: `/auth/me` ya le publica al
usuario sus propias capacidades, así que decirle cuál le falta no le revela nada que no pueda leer
de su sesión — y le da algo concreto que pedir en vez de un «no podés» sin salida.
