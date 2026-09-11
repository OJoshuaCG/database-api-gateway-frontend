import Prism from 'prismjs'

/**
 * Publica el core de Prism en el ámbito global ANTES de que se evalúe ninguna gramática.
 *
 * Los archivos de `prismjs/components/` no son módulos: cada uno es una sentencia suelta
 * `Prism.languages.<lang> = { ... }` que resuelve `Prism` por el binding global. En desarrollo eso
 * funciona de casualidad, porque esbuild pre-empaqueta `prismjs` como CommonJS y su core asigna
 * `window.Prism` al evaluarse.
 *
 * El build de producción lo rompe. `prism-sql.js` no lleva ningún marcador de CommonJS, así que
 * Rollup lo clasifica como ESM e inserta su efecto secundario al tope del chunk, mientras que el
 * core —que sí tiene `module.exports`— queda envuelto en una factoría CommonJS que solo corre
 * cuando alguien lee de ella. La gramática se ejecuta primero, contra un global que todavía no
 * existe, y el chunk muere con `ReferenceError: Prism is not defined` antes de que la app monte.
 *
 * Leer el core acá fuerza que esa factoría corra mientras se evalúa ESTE módulo. Por eso las
 * gramáticas tienen que importarse DESPUÉS de este módulo y nunca junto a `prismjs` directamente:
 * es el orden de evaluación de módulos ES el que garantiza que el global ya esté puesto.
 */
const ambitoGlobal = globalThis as typeof globalThis & { Prism?: typeof Prism }
ambitoGlobal.Prism ??= Prism

export default Prism
