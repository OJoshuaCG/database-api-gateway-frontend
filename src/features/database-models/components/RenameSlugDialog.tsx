import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Callout, Checkbox, Input, Modal } from '@/components/ui'
import { useCapabilityGuard } from '@/features/auth'
import { toApiError, type ApiRenameSlugDatabase } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import {
  CAPABILITIES,
  DATABASE_MODEL_ERROR_CODES,
  SLUG_PATTERN,
  type RenameSlugPlan,
  type RenameSlugResult,
} from '@/lib/contracts'
import { formatCountdown } from '@/lib/utils/countdown'
import { isClipboardAvailable } from '@/lib/utils'
import { useCountdown } from '@/lib/utils/use-countdown'
import {
  useMigrateVersionTable,
  useMigrateVersionTablePlan,
  useRenameSlug,
  useRenameSlugPlan,
} from '../hooks/use-database-models'
import { renameSlugBadge, renameSlugBlocks, sortBlockersFirst } from '../rename-slug-badges'
import {
  listDatabaseNames,
  planConsequencesChanged,
  renameSlugVerdict,
  type RenameSlugMode,
  type RenameSlugVerdict,
} from '../rename-slug-verdict'

/**
 * Forma ANCHA que acepta la tabla de evidencia.
 *
 * Las filas llegan de dos sitios con tipos distintos —el plan (`RenameSlugDatabase`, validado por
 * Zod) y los `public_context` de error (`ApiRenameSlugDatabase`, sin validar, porque `lib/api` no
 * depende de `lib/contracts`)— y el tipo ancho es lo que permite pintarlas con la misma tabla sin
 * un adaptador por medio. Mismo criterio que el `BlockingRow` de `MigrationDeletePlanDialog`.
 */
interface EvidenceRow {
  managed_database_id: number
  database_name: string
  server_name?: string | null
  action: string
  source_table?: string | null
  has_mirror?: boolean | null
  detail?: string | null
}

/**
 * Un error del renombrado, ya CLASIFICADO por `public_context.code` y listo para pintar.
 *
 * Es un objeto de datos y no JSX a propósito, igual que el `DeleteError` de
 * `MigrationDeletePlanDialog`: la clasificación ocurre en un solo sitio (`submit`) y el render solo
 * decide qué bloques dibujar. Así no hay dos ramas capaces de describir el mismo rechazo de dos
 * formas distintas.
 *
 * **Nunca se clasifica por el `message` del backend ni por el número de status.** `slugRenamePlanStale`
 * es el caso que lo obliga: el controller hereda el status del servicio de tokens (típicamente 422,
 * pero el contrato no lo garantiza), así que ramificar por número lo perdería en silencio.
 */
interface RenameError {
  title: string
  text: string
  /** ¿Ofrecer «Volver a comprobar»? Falso cuando primero hay trabajo manual que hacer. */
  replan: boolean
  /** Qué tiene que hacer el operador a continuación. Va aparte del `text` para que se vea solo. */
  cta?: string
  /** Bases del contexto del error, con su encabezado. */
  rowsTitle?: string
  rows?: ApiRenameSlugDatabase[]
  /** Tabla destino del contexto, para la columna «origen → destino» de esas filas. */
  targetTable?: string
  /** Solo `slugRenameFailed`: las tres listas van SEPARADAS, ver `IncidentPanel`. */
  incident?: Incident
  requestId?: string
}

type Step = 'plan' | 'confirm' | 'result'

interface BaseProps {
  modelId: number
  onClose: () => void
}

/**
 * Las props dependen del modo: el renombrado necesita saber el slug de hoy y avisar a quien lo
 * abrió de que el slug cambió; la migración de formato no toca el slug, así que no pide ninguna
 * de las dos cosas. Una unión discriminada y no dos props opcionales para que el compilador no
 * deje montar el renombrado sin ellas.
 */
type RenameSlugDialogProps = BaseProps &
  (
    | {
        mode?: 'rename-slug'
        /** El slug que el blueprint tiene HOY, tal como lo conoce quien abre el diálogo. */
        currentSlug: string
        /**
         * Se llama al CERRAR el paso de resultado de un renombrado exitoso. El slug del
         * blueprint cambió: quien abre decide a dónde volver.
         */
        onRenamed: () => void
      }
    | { mode: 'migrate-format' }
  )

/** Nombre de una BD, degradando a «BD #7» cuando el payload no lo trae. */
function labelOf(row: EvidenceRow): string {
  return row.database_name || `BD #${row.managed_database_id}`
}

/** Textos que dependen del modo. En un solo sitio para que las dos variantes no diverjan. */
function copyFor(mode: RenameSlugMode) {
  return mode === 'rename-slug'
    ? {
        confirmationOf: 'este renombrado',
        blockedTitle: '🔴 Bloqueado: no se puede renombrar',
        readyTitle: '🟢 Listo para renombrar',
        planButton: 'Ver qué se va a renombrar',
        guardAction: 'renombrar el slug de un blueprint',
        genericFailure: 'No se pudo renombrar el slug',
        incidentHeading: 'renombrado de slug',
      }
    : {
        confirmationOf: 'esta actualización',
        blockedTitle: '🔴 Bloqueado: no se puede actualizar',
        readyTitle: '🟢 Listo para actualizar',
        planButton: 'Comprobar qué hay que actualizar',
        guardAction: 'actualizar el formato de las tablas de versión',
        genericFailure: 'No se pudo actualizar al formato Datum',
        incidentHeading: 'actualización al formato Datum',
      }
}

/**
 * Asistente de las tablas de versión de un blueprint, con dos modos que comparten el mismo
 * contrato (v25 §2.1–§2.3):
 *
 * - `rename-slug` (por defecto): renombra el slug y, con él, la tabla de versión de cada base.
 * - `migrate-format`: moderniza las tablas al formato Datum **sin cambiar el slug**. Es opcional:
 *   una base con el formato histórico sigue funcionando indefinidamente.
 *
 * ## Por qué esto no es un campo de texto
 *
 * El slug nombra la tabla de versión `_datum_version_<slug>` (o `_gw_v_<slug>` en el formato
 * histórico) **DENTRO de cada base gestionada**. Cambiarlo con un `PATCH` no renombra nada en
 * ningún motor: el gateway se queda apuntando a una tabla que ya no existe y todas esas bases
 * pierden su contabilidad. El renombrado de verdad es una **escritura remota por base**, sin
 * transacción compartida entre motores distintos, y por eso tiene su propio ciclo: preview
 * autoritativo → `confirm_token` con TTL → ejecución → resultado.
 *
 * ## El origen varía por base
 *
 * Dentro de un mismo blueprint conviven bases con `_gw_v_…` y con `_datum_version_…`. Por eso
 * la tabla de evidencia muestra el `source_table` de CADA fila y ningún texto afirma un origen
 * único ni deriva un prefijo.
 *
 * ## El plan se pide de un clic, nunca al montar
 *
 * Los dos `plan` abren una conexión por base y están limitados a 10/min. Pedirlo al montar —o por
 * pulsación de tecla— gastaría el presupuesto sin que nadie lo haya pedido. Por eso no hay ningún
 * `useEffect` que dispare llamadas acá: todas nacen de un clic.
 *
 * ## Nunca se re-planifica en silencio
 *
 * Ni al caducar el token, ni tras un error. Cada plan nuevo puede describir otras bases, y el
 * usuario tiene que volver a verlas antes de confirmar nada. La ÚNICA excepción es
 * `slug_rename_plan_stale`, donde el propio contrato dice que hay que repetir el preview: ahí sí se
 * repite solo, y se dice por qué y que no fue un fallo del operador.
 */
export function RenameSlugDialog(props: RenameSlugDialogProps) {
  const { modelId, onClose } = props
  const mode: RenameSlugMode = props.mode ?? 'rename-slug'
  const currentSlug = props.mode === 'migrate-format' ? null : props.currentSlug
  const copy = copyFor(mode)

  const [step, setStep] = useState<Step>('plan')
  const [newSlug, setNewSlug] = useState('')
  const [plan, setPlan] = useState<RenameSlugPlan | null>(null)
  const [result, setResult] = useState<RenameSlugResult | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [error, setError] = useState<RenameError | null>(null)

  /**
   * Ancla de foco del paso 2.
   *
   * Al pulsar el botón de continuar ese botón se desmonta y lo sustituyen otros dos. Cuando el
   * elemento enfocado desaparece del DOM el foco cae al contenedor, sin nada que lo anuncie: quien
   * navega por teclado pulsa y no percibe que pasó nada, y el siguiente Tab lo devuelve al
   * principio del diálogo, atravesando el input de slug y la tabla de evidencia antes de llegar a
   * la casilla de reconocimiento que ahora es obligatoria. El paso de resultado usa el mismo
   * mecanismo por el mismo motivo.
   *
   * Se mueve a mano en el handler, **no en un `useEffect`**: es una consecuencia directa de una
   * interacción, no un estado que sincronizar.
   */
  const confirmAnchor = useRef<HTMLDivElement>(null)
  const resultAnchor = useRef<HTMLDivElement>(null)

  const goToConfirm = () => {
    setStep('confirm')
    // En el mismo tick el nodo todavía no existe; `requestAnimationFrame` espera al commit.
    requestAnimationFrame(() => confirmAnchor.current?.focus())
  }

  /**
   * Tira el plan y vuelve al paso 1, para los rechazos que **prueban que el plan ya no describe
   * la realidad**.
   *
   * Sin esto, el semáforo se quedaba en 🟢 debajo del error que acababa de desmentirlo, con el
   * `Callout` de «Se va a escribir en N base(s)» intacto y la casilla de reconocimiento aún
   * marcada. Un veredicto que no se invalida cuando el backend lo contradice deja de ser un
   * veredicto y pasa a ser la decoración del último preview — y el verde es justamente lo que
   * autoriza a no leer el resto.
   */
  const invalidatePlan = () => {
    setPlan(null)
    setAcknowledged(false)
    setStep('plan')
  }

  // Los cuatro hooks se llaman siempre —las reglas de hooks no admiten llamarlos según el modo—
  // y se usa el par que corresponde. Son `useMutation` sin efectos al montar: no piden nada solos.
  const renamePlanMutation = useRenameSlugPlan(modelId)
  const migratePlanMutation = useMigrateVersionTablePlan(modelId)
  const renameMutation = useRenameSlug(modelId)
  const migrateMutation = useMigrateVersionTable(modelId)
  const planPending =
    mode === 'rename-slug' ? renamePlanMutation.isPending : migratePlanMutation.isPending

  // Escribe en bases ajenas: el requisito es `blueprints.write`. Se deshabilita el control en vez
  // de dejar que el 403 llegue después de leer el plan entero y marcar el reconocimiento.
  const guard = useCapabilityGuard(CAPABILITIES.blueprintsWrite, copy.guardAction)

  // La vigencia sale SIEMPRE de `expires_at`: el TTL empieza a correr en el servidor y no viaja en
  // la respuesta, así que una constante local mentiría por el tiempo de red.
  const remaining = useCountdown(plan?.expires_at ?? null)
  const tokenAlive = plan?.confirm_token != null && remaining > 0

  const trimmedSlug = newSlug.trim()
  const slugError =
    trimmedSlug === ''
      ? undefined
      : trimmedSlug.length > 120
        ? 'Máximo 120 caracteres.'
        : !SLUG_PATTERN.test(trimmedSlug)
          ? 'kebab/snake en minúsculas (ej. mi-blueprint).'
          : trimmedSlug === currentSlug
            ? 'Es el slug que ya tiene.'
            : undefined
  // En `migrate-format` no hay slug que escribir: el plan se puede pedir siempre.
  const canRequestPlan =
    mode === 'migrate-format' || (trimmedSlug !== '' && slugError === undefined)

  const verdict = plan === null ? null : renameSlugVerdict(plan, mode)
  const ready = verdict?.kind === 'ready' ? verdict : null
  // Sin token que caduque (solo espejo) no hay cuenta atrás que esperar; con token, sí.
  const tokenOk = ready === null || !ready.tokenRequired || tokenAlive

  const inFlight = renameMutation.isPending || migrateMutation.isPending

  const requestPlan = (options?: { keepError?: boolean }) => {
    if (!options?.keepError) setError(null)
    const previous = plan
    const callbacks = {
      onSuccess: (next: RenameSlugPlan) => {
        // El reconocimiento describe una lista concreta de bases. Si esa lista cambió, se vuelve a
        // pedir: la casilla no puede seguir marcada sobre algo que el usuario no leyó.
        if (previous === null || planConsequencesChanged(previous, next)) setAcknowledged(false)
        setPlan(next)
      },
      onError: (err: unknown) => {
        const apiError = toApiError(err)
        setPlan(null)
        setError({
          title: 'No se pudo comprobar el plan',
          text: apiError.message,
          replan: true,
          requestId: apiError.requestId,
        })
      },
    }
    if (mode === 'rename-slug') renamePlanMutation.mutate(trimmedSlug, callbacks)
    else migratePlanMutation.mutate(undefined, callbacks)
  }

  const onExecuted = (next: RenameSlugResult) => {
    setResult(next)
    setStep('result')
    requestAnimationFrame(() => resultAnchor.current?.focus())
  }

  /**
   * Cierre del paso de resultado. En `rename-slug` es lo que antes pasaba al recibir el 200
   * —`onRenamed`, que en `DatabaseModelFormModal` cierra TODO porque el formulario de detrás
   * nació con el slug viejo—, solo que ahora ocurre DESPUÉS de que el operador vio el resultado.
   */
  const finish = () => {
    if (props.mode === 'migrate-format') onClose()
    else props.onRenamed()
  }

  const onExecuteError = (err: unknown) => {
    const apiError = toApiError(err)
    const requestId = apiError.requestId
    const context = apiError.databaseModelContext

    // Se clasifica SIEMPRE por `public_context.code`. Ni por status —`slug_rename_plan_stale`
    // hereda el del servicio de tokens y no está garantizado— ni por la prosa, que puede
    // transcribir el error del motor (host, usuario, fragmentos de sentencia). Los dos modos
    // comparten los cinco códigos; solo cambian los textos que hablan del slug.
    if (apiError.code === DATABASE_MODEL_ERROR_CODES.slugRenameConflict) {
      setError({
        title: 'Alguna base tiene a la vez la tabla de origen y la de destino',
        text: 'Con las dos tablas presentes no se puede decidir cuál es el puntero bueno, y el gateway no elige por vos: se aborta la operación entera, sin tocar ninguna base.',
        // 🔴 NO se ofrece «renombrá o eliminá la tabla que sobra»: no hay endpoint para eso
        // y la consola SQL bloquea por diseño cualquier sentencia que nombre `_datum_version_*` o `_gw_v_*`.
        // Mandar al operador a hacer algo que la propia aplicación le va a rechazar es peor
        // que no decirle nada, porque se va a la consola, la sentencia le rebota y se queda
        // sin saber por qué. Lo honesto es nombrar lo que SÍ puede hacer —mirar el informe—
        // y decir que el resto pide acceso directo al motor.
        cta: 'Mirá qué tabla sobra en esas bases en el informe de contabilidad. Quitarla requiere acceso directo al motor: el gateway no expone esa operación y la consola SQL la bloquea por diseño.',
        replan: false,
        rowsTitle: 'Bases donde conviven las dos tablas',
        rows: context?.conflictingDatabases,
        targetTable: context?.newTable,
        requestId,
      })
      invalidatePlan()
      return
    }

    if (apiError.code === DATABASE_MODEL_ERROR_CODES.slugRenameUnreachable) {
      setError({
        title: 'No se pudo leer alguna base',
        text: 'No significa que tengan un problema: significa que no se pudo comprobar qué tablas tienen. El gateway prefiere negarse a suponer, así que aborta la operación entera.',
        cta: 'Recuperá el acceso a esas bases —motor caído, credenciales rotas, base sin aprovisionar— y volvé a comprobar. No se reintenta solo.',
        replan: false,
        rowsTitle: 'Bases que no se pudieron consultar',
        rows: context?.unreachableDatabases,
        requestId,
      })
      invalidatePlan()
      return
    }

    if (apiError.code === DATABASE_MODEL_ERROR_CODES.slugRenameConfirmationRequired) {
      setError({
        title: `Falta la confirmación de ${copy.confirmationOf}`,
        text: 'La ejecución llegó sin autorización vigente y el plan tenía bases que renombrar. Estas son las bases en las que habría que escribir.',
        cta: 'Pedí el preview otra vez para obtener una autorización nueva.',
        replan: true,
        rowsTitle: 'Lo que se iba a renombrar',
        rows: context?.renamePlan,
        targetTable: context?.newTable,
        requestId,
      })
      setStep('plan')
      return
    }

    if (apiError.code === DATABASE_MODEL_ERROR_CODES.slugRenamePlanStale) {
      // La ÚNICA excepción a «nunca se re-planifica en silencio»: el contrato dice
      // explícitamente que el plan hay que repetirlo. Se repite, y se dice por qué — con el
      // error a la vista, que es lo que `keepError` conserva.
      setError({
        title: 'El parque cambió desde que miraste el plan',
        text: 'El token está atado al estado del parque de bases, y alguna se movió mientras tanto. No fue un error tuyo ni hay nada que arreglar.',
        cta: 'Se está pidiendo el preview otra vez: revisá el veredicto nuevo antes de confirmar, porque puede describir otras bases.',
        replan: true,
        requestId,
      })
      setStep('plan')
      requestPlan({ keepError: true })
      return
    }

    if (apiError.code === DATABASE_MODEL_ERROR_CODES.slugRenameFailed) {
      setError(
        mode === 'rename-slug'
          ? {
              title: 'El slug del blueprint NO se modificó.',
              text: 'El renombrado falló a mitad del parque. El slug sigue siendo el de antes, así que el gateway sigue apuntando al nombre viejo de la tabla. Abajo está, base por base, qué quedó en qué estado: no se puede resumir porque cada lista tiene un destino distinto.',
              replan: false,
              incident: incidentFrom(context),
              requestId,
            }
          : {
              // Acá no hay slug que cambie: lo que NO se modificó es el estado del gateway.
              title: 'El estado del gateway NO se modificó.',
              text: 'La actualización falló a mitad del parque. El gateway no cambió nada de su lado. Abajo está, base por base, qué quedó en qué estado: no se puede resumir porque cada lista tiene un destino distinto.',
              replan: false,
              incident: incidentFrom(context),
              requestId,
            },
      )
      return
    }

    setError({ title: copy.genericFailure, text: apiError.message, replan: false, requestId })
  }

  const submit = () => {
    if (plan === null) return
    setError(null)
    // El token va tal cual viene del plan: `null` cuando no hay nada que renombrar —también
    // cuando solo falta el espejo, que el backend ejecuta sin token—. Mandarlo siempre
    // entrenaría al cliente a mandarlo siempre y vaciaría la confirmación.
    const callbacks = { onSuccess: onExecuted, onError: onExecuteError }
    if (mode === 'rename-slug') {
      renameMutation.mutate({ newSlug: plan.new_slug, confirmToken: plan.confirm_token }, callbacks)
    } else {
      migrateMutation.mutate(plan.confirm_token, callbacks)
    }
  }

  const isIncident = error?.incident !== undefined
  const isResult = step === 'result' && result !== null
  const canSubmitRemote = error === null && acknowledged && tokenOk && guard.allowed
  const showReportLink = mode === 'rename-slug'

  const executeLabel =
    ready === null
      ? ''
      : mode === 'migrate-format'
        ? `Actualizar ${ready.writeCount} base(s) 🔌`
        : ready.renameCount > 0
          ? `Renombrar ${ready.renameCount} base(s) 🔌`
          : `Cambiar el slug y crear el espejo en ${ready.mirrorPendingCount} base(s) 🔌`

  const closeHandler = isResult ? finish : onClose

  return (
    <Modal
      open
      // Con la operación en vuelo el diálogo se bloquea entero: el endpoint es 3/min y un doble
      // envío se come el presupuesto de reintento justo cuando hace falta.
      onClose={inFlight ? () => undefined : closeHandler}
      dismissible={!inFlight}
      title={
        mode === 'rename-slug'
          ? `Renombrar el slug de «${currentSlug ?? ''}» 🔌`
          : 'Actualizar al formato Datum 🔌'
      }
      description={
        mode === 'rename-slug'
          ? 'Escribe dentro de cada base gestionada. No es un cambio local.'
          : 'Escribe dentro de cada base gestionada que lo necesite. No cambia el slug.'
      }
      size="lg"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          {ready?.tokenRequired && step !== 'result' && (
            <span className="text-xs text-muted-foreground">
              {tokenAlive
                ? `La confirmación caduca en ${formatCountdown(remaining)}.`
                : 'La confirmación caducó.'}
            </span>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            {isResult ? (
              <Button onClick={finish}>Cerrar</Button>
            ) : (
              <Button variant="ghost" onClick={onClose} disabled={inFlight}>
                {isIncident ? 'Cerrar' : 'Cancelar'}
              </Button>
            )}

            {step === 'plan' && !isIncident && (
              <>
                <Button
                  variant="outline"
                  disabled={!canRequestPlan || inFlight}
                  isLoading={planPending}
                  onClick={() => requestPlan()}
                >
                  {plan === null ? copy.planButton : 'Volver a comprobar'}
                </Button>

                {/* Sin cambios remotos (solo `rename-slug`): se envía SIN `confirm_token` y sin
                    ceremonia, porque no hay ninguna escritura remota que reconocer. */}
                {verdict?.kind === 'local' && (
                  <Button
                    disabled={!guard.allowed || error !== null}
                    title={guard.hint}
                    isLoading={inFlight}
                    onClick={submit}
                  >
                    Cambiar el slug
                  </Button>
                )}

                {ready !== null && (
                  <Button
                    disabled={!guard.allowed || !tokenOk || error !== null}
                    title={guard.hint}
                    onClick={goToConfirm}
                  >
                    {executeLabel}
                  </Button>
                )}
              </>
            )}

            {step === 'confirm' && !isIncident && ready !== null && (
              <>
                <Button variant="outline" onClick={() => setStep('plan')} disabled={inFlight}>
                  Volver al plan
                </Button>
                <Button
                  variant="danger"
                  disabled={!canSubmitRemote}
                  title={guard.hint}
                  isLoading={inFlight}
                  onClick={submit}
                >
                  {executeLabel}
                </Button>
              </>
            )}
          </div>

          {/*
            El motivo del bloqueo por capacidad, VISIBLE y una sola vez para todo el pie.
            No basta con el `title` de cada botón: un `<button disabled>` **no dispara el tooltip
            nativo en ningún navegador**, así que ese texto no llega ni con ratón, ni por teclado,
            ni en táctil, ni al lector de pantalla — y es justo el único texto que dice a quién
            pedirle el acceso. Mismo patrón que `DatabaseModelForm`, que ya lo pinta así.
          */}
          {!guard.allowed && guard.hint && !isResult && (
            <p className="text-xs text-muted-foreground">{guard.hint}</p>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {isResult && (
          <div ref={resultAnchor} tabIndex={-1} className="outline-none">
            <ResultPanel mode={mode} result={result} mirrorTable={plan?.mirror_table ?? null} />
          </div>
        )}

        {error && !isResult && (
          <ErrorPanel
            error={error}
            modelId={modelId}
            mode={mode}
            showReportLink={showReportLink}
            incidentHeading={copy.incidentHeading}
            replanning={planPending}
            onReplan={() => requestPlan()}
          />
        )}

        {step === 'plan' && !isIncident && (
          <>
            {mode === 'rename-slug' ? (
              // El aviso va ANTES de pedir nada: es la consecuencia que decide si esta pantalla
              // debería estar abierta siquiera. Va en `Callout` y no en un `hint` por la regla del
              // repo — si un aviso decide algo, se lee antes de decidir, no al pasar el ratón.
              <Callout tone="warning" title="Esto escribe en bases de datos de terceros 🔌">
                <p>
                  Renombra una tabla <strong className="text-foreground">DENTRO</strong> de cada
                  base gestionada. Son escrituras remotas, una por base y{' '}
                  <strong className="text-foreground">sin transacción compartida</strong> entre
                  motores distintos: no existe un «deshacer» atómico si algo falla a mitad.
                </p>
              </Callout>
            ) : (
              // Informativo y NO de advertencia: la actualización es opcional, y un aviso con tono
              // de deuda empujaría a ejecutarla por miedo a algo que no va a pasar. Lo que sí se
              // dice, sin dramatismo, es que escribe en bases reales.
              <Callout tone="info" title="Esta actualización es opcional">
                <p>
                  Las bases con el formato histórico siguen funcionando indefinidamente: el gateway
                  resuelve el nombre de la tabla de versión base por base. Además, cada apply,
                  rollback o stamp moderniza sola la base que toca; este botón sirve para no
                  esperar.
                </p>
                <p>
                  Aun así, es una escritura real 🔌: renombra la tabla de versión y crea el espejo
                  del historial <strong className="text-foreground">dentro</strong> de cada base que
                  lo necesite, sin transacción compartida entre motores.
                </p>
              </Callout>
            )}

            {mode === 'rename-slug' && (
              <div className="flex flex-col gap-1.5">
                <Input
                  label="Slug nuevo"
                  required
                  value={newSlug}
                  error={slugError}
                  hint="kebab/snake en minúsculas, hasta 120 caracteres (ej. crm-legacy)"
                  disabled={inFlight}
                  onChange={(event) => {
                    setNewSlug(event.target.value)
                    // El plan describe un slug concreto. Al cambiar el texto deja de describir lo
                    // que se enviaría, así que se tira: NO se pide otro solo —eso sería un preview
                    // por pulsación de tecla, que es justo lo que el límite de 10/min prohíbe.
                    setPlan(null)
                    setAcknowledged(false)
                    setError(null)
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Slug actual:{' '}
                  <code className="rounded bg-surface-muted px-1 py-0.5">{currentSlug}</code>
                </p>
              </div>
            )}

            {plan === null || verdict === null ? (
              <p className="text-sm text-muted-foreground">
                {mode === 'rename-slug'
                  ? 'Todavía no se comprobó nada. «Ver qué se va a renombrar» abre una conexión a cada base del blueprint para ver cuáles tienen la tabla de versión y en cuáles conviven ya las dos tablas. No escribe nada.'
                  : 'Todavía no se comprobó nada. «Comprobar qué hay que actualizar» abre una conexión a cada base del blueprint para ver qué formato tiene cada una. No escribe nada.'}
              </p>
            ) : (
              <>
                {/* 🔴 EL SEMÁFORO. Un veredicto, no una lista: un estado y uno solo visible. */}
                <Verdict
                  plan={plan}
                  verdict={verdict}
                  mode={mode}
                  modelId={modelId}
                  showReportLink={showReportLink}
                  replanning={planPending}
                  onReplan={() => requestPlan()}
                />

                {/* La evidencia va SIEMPRE debajo del veredicto, nunca en su lugar: el veredicto
                    dice qué pasa, la tabla demuestra por qué. */}
                <EvidenceTable
                  title={`Las ${plan.databases.length} base(s) del blueprint`}
                  rows={plan.databases}
                  targetTable={plan.new_table}
                  mirrorTable={plan.mirror_table}
                  showMirror
                />
              </>
            )}
          </>
        )}

        {step === 'confirm' && plan !== null && ready !== null && !isIncident && (
          // `tabIndex={-1}` lo hace enfocable por código pero NO lo mete en el orden de
          // tabulación: el foco aterriza justo encima de «Se va a escribir en N base(s)», que es
          // lo que hay que leer, y el Tab siguiente llega a la casilla de reconocimiento.
          <div ref={confirmAnchor} tabIndex={-1} className="flex flex-col gap-4 outline-none">
            <Callout tone="danger" title={`Se va a escribir en ${ready.writeCount} base(s) 🔌`}>
              {mode === 'rename-slug' && (
                <p>
                  El slug pasa de{' '}
                  <code className="rounded bg-surface-muted px-1 py-0.5">{plan.current_slug}</code>{' '}
                  a <code className="rounded bg-surface-muted px-1 py-0.5">{plan.new_slug}</code>.
                </p>
              )}
              {ready.renameCount > 0 && (
                // Solo el DESTINO es único. El origen varía por base (`_gw_v_…` o
                // `_datum_version_…`) y está fila a fila en la tabla del paso anterior.
                <p>
                  Se renombra la tabla de versión a{' '}
                  <code className="break-all rounded bg-surface-muted px-1 py-0.5">
                    {plan.new_table}
                  </code>{' '}
                  en {ready.renameCount} base(s) de datos reales. El nombre de origen puede ser
                  distinto en cada una: está fila a fila en el plan.
                </p>
              )}
              {ready.mirrorPendingCount > 0 && (
                <p>
                  Se crea el espejo del historial <MirrorName table={plan.mirror_table} /> en{' '}
                  {ready.mirrorPendingCount} base(s).
                </p>
              )}
            </Callout>

            {/* El orden interno va como texto VISIBLE y no como tooltip: es lo que determina en qué
                estado queda el sistema si algo falla a mitad, y eso no se descubre por accidente. */}
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-foreground">En qué orden pasa esto</h3>
              {mode === 'rename-slug' ? (
                <p className="text-sm text-muted-foreground">
                  Primero se renombra la tabla en los motores; el slug del blueprint se actualiza{' '}
                  <strong className="text-foreground">ÚLTIMO</strong>. Si algo falla a mitad, lo ya
                  renombrado se renombra de vuelta y el slug{' '}
                  <strong className="text-foreground">NO</strong> se modifica: el gateway nunca
                  queda apuntando a un nombre que las bases no tienen.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Primero se renombra la tabla en los motores que lo necesitan. Si algo falla a
                  mitad, lo ya renombrado se renombra de vuelta y el estado del gateway{' '}
                  <strong className="text-foreground">NO</strong> se modifica.
                </p>
              )}
              {ready.mirrorPendingCount > 0 && (
                <p className="text-sm text-muted-foreground">
                  El espejo no forma parte de esa marcha atrás: si no se puede crear en alguna base,
                  la operación sigue y esa base se informa en el resultado.
                </p>
              )}
            </section>

            {/* Reconocimiento también cuando solo se crea el espejo: sin token no hay nada que
                caduque, pero crear una tabla en N bases sigue siendo una escritura remota. */}
            <div className="rounded-lg border border-border p-3">
              <Checkbox
                label={`Entiendo que esto escribe en ${ready.writeCount} base(s) reales.`}
                checked={acknowledged}
                disabled={inFlight}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
            </div>

            {/* Al caducar NO se re-planifica solo: la lista de bases pudo cambiar y hay que volver
                a verla. El botón de confirmar ya está deshabilitado por `tokenOk`. */}
            {!tokenOk && (
              <Callout
                tone="warning"
                title="La autorización de este plan caducó"
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    isLoading={planPending}
                    onClick={() => {
                      setStep('plan')
                      requestPlan()
                    }}
                  >
                    Volver a comprobar
                  </Button>
                }
              >
                <p>
                  No se manda un token vencido «para ver qué dice»: el backend lo rechaza y el
                  intento gasta presupuesto del límite de 3/min. Volvé a comprobar — si mientras
                  tanto alguna base se movió, la lista va a ser otra y habrá que reconocerla de
                  nuevo.
                </p>
              </Callout>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

/** El nombre del espejo tal como lo da el backend; sin él, una descripción y no un nombre inventado. */
function MirrorName({ table }: { table: string | null }) {
  if (table === null) return <>del gateway</>
  return <code className="rounded bg-surface-muted px-1 py-0.5">{table}</code>
}

/**
 * 🔴 El semáforo: **un veredicto**, con un estado visible a la vez (ver `renameSlugVerdict`).
 *
 * No es un resumen de la tabla de abajo. La tabla dice qué le pasa a cada base; esto dice si la
 * operación se puede hacer, y por qué el bloqueo de una sola base aborta las demás.
 */
function Verdict({
  plan,
  verdict,
  mode,
  modelId,
  showReportLink,
  replanning,
  onReplan,
}: {
  plan: RenameSlugPlan
  verdict: RenameSlugVerdict
  mode: RenameSlugMode
  modelId: number
  showReportLink: boolean
  replanning: boolean
  onReplan: () => void
}) {
  const copy = copyFor(mode)

  if (verdict.kind === 'blocked') {
    const { conflicts, unreachable } = verdict
    return (
      <Callout
        tone="danger"
        title={copy.blockedTitle}
        action={
          <>
            <Button size="sm" variant="outline" isLoading={replanning} onClick={onReplan}>
              Volver a comprobar
            </Button>
            {showReportLink && (
              <Link
                to={`/database-models/${modelId}/migrations?tab=contabilidad`}
                className="inline-flex items-center rounded-md px-2 py-1 text-xs text-primary hover:bg-primary/10"
              >
                Ver informe de contabilidad →
              </Link>
            )}
          </>
        }
      >
        <p>
          La operación se aborta <strong className="text-foreground">ENTERA</strong>
          {mode === 'rename-slug'
            ? ': el gateway apunta a un solo nombre de tabla, así que renombrar solo una parte del parque dejaría a la otra con su contabilidad huérfana.'
            : ': no se toca ninguna base, tampoco las que sí se podrían actualizar.'}
        </p>
        {conflicts.length > 0 && (
          <p>
            <strong className="text-foreground">{conflicts.length} base(s)</strong> tienen a la vez
            la tabla de origen y la de destino, y no se puede decidir cuál es el puntero bueno:{' '}
            {listDatabaseNames(conflicts)}.
          </p>
        )}
        {unreachable.length > 0 && (
          <p>
            No se pudo leer{' '}
            <strong className="text-foreground">{unreachable.length} base(s)</strong>, así que no se
            sabe qué tablas tienen: {listDatabaseNames(unreachable)}.
          </p>
        )}
      </Callout>
    )
  }

  if (verdict.kind === 'ready') {
    return (
      <Callout tone="success" title={copy.readyTitle}>
        {verdict.renameCount > 0 ? (
          <p>
            Se renombrará la tabla de versión a{' '}
            <code className="break-all rounded bg-surface-muted px-1 py-0.5">{plan.new_table}</code>{' '}
            en <strong className="text-foreground">{verdict.renameCount} base(s)</strong>. El origen
            puede variar por base: está en la tabla de abajo.
          </p>
        ) : (
          <p>
            {mode === 'rename-slug'
              ? 'Ninguna base tiene tabla de versión que renombrar.'
              : 'Ninguna base necesita renombrar su tabla de versión.'}
          </p>
        )}
        {verdict.mirrorPendingCount > 0 && (
          <p>
            <strong className="text-foreground">{verdict.mirrorPendingCount} base(s)</strong>{' '}
            recibirán el espejo del historial <MirrorName table={plan.mirror_table} />.
          </p>
        )}
        {verdict.alreadyCount > 0 && (
          <p className="text-muted-foreground">
            {verdict.alreadyCount} base(s) ya estaban actualizadas: no se les renombra nada.
          </p>
        )}
      </Callout>
    )
  }

  if (verdict.kind === 'up-to-date') {
    // ⚪ y SIN botón de ejecutar: no queda nada que hacer. No es un error — una segunda corrida
    // sobre un blueprint ya migrado sale siempre así.
    return (
      <Callout tone="info" title="⚪ Todo el blueprint ya está en formato Datum">
        <p>
          No hay nada que actualizar
          {verdict.alreadyCount > 0 && `: ${verdict.alreadyCount} base(s) ya están al día`}
          {verdict.skipCount > 0 &&
            `${verdict.alreadyCount > 0 ? ' y' : ':'} ${verdict.skipCount} base(s) todavía no tienen tabla de versión, que nacerá ya con el formato nuevo`}
          .
        </p>
      </Callout>
    )
  }

  return (
    <Callout tone="info" title="⚪ Sin cambios remotos">
      {plan.no_op ? (
        <p>
          Los dos slugs dan el mismo nombre de tabla (tope de 63 caracteres). No hay nada que
          renombrar en ningún motor: el cambio es{' '}
          <strong className="text-foreground">puramente local</strong>.
        </p>
      ) : verdict.alreadyCount > 0 ? (
        <p>
          Ninguna base tiene tabla que renombrar ({verdict.alreadyCount} ya tienen la de destino).
          El cambio es <strong className="text-foreground">local</strong>.
        </p>
      ) : (
        <p>
          Ninguna base tiene todavía tabla de versión. El cambio es{' '}
          <strong className="text-foreground">local</strong>: cuando cada base cree la suya, la
          creará ya con el nombre nuevo.
        </p>
      )}
    </Callout>
  )
}

/**
 * La evidencia: qué le pasa a cada base, con el vocabulario único de `rename-slug-badges`.
 *
 * **Bloqueantes primero** (`sortBlockersFirst`): en un parque grande los dos motivos de abandonar
 * la operación pueden quedar debajo de treinta filas que no obligan a hacer nada.
 *
 * En cada `rename` se pinta **el `source_table` de ESA fila** → el destino. El origen varía por
 * base y nunca se deriva ni se escribe un prefijo a mano: si la fila no lo trae, se dice.
 *
 * `detail` se pinta TAL CUAL y sin resumir: es lo único que distingue «esa tabla la creó otro
 * blueprint» de «el motor rechazó la consulta», y resumirlo borra justo la parte accionable.
 *
 * Es una tabla nativa y no un `DataTable` porque vive dentro de un modal `lg`: cuatro columnas que
 * envuelven texto caben sin scroll horizontal en cualquier ancho, que es la regla del repo.
 */
function EvidenceTable({
  title,
  rows,
  targetTable,
  mirrorTable = null,
  showMirror = false,
}: {
  title: string
  rows: EvidenceRow[]
  targetTable?: string
  mirrorTable?: string | null
  /** Solo en el plan: en las filas de un error el espejo no es lo que se está explicando. */
  showMirror?: boolean
}) {
  if (rows.length === 0) return null

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
        <table className="w-full table-fixed text-left text-sm">
          <thead className="bg-surface-muted text-xs uppercase text-muted-foreground">
            <tr>
              <th scope="col" className="w-1/4 px-3 py-2 font-medium">
                Base
              </th>
              <th scope="col" className="w-1/5 px-3 py-2 font-medium">
                Servidor
              </th>
              <th scope="col" className="w-1/3 px-3 py-2 font-medium">
                Qué le pasa
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Detalle
              </th>
            </tr>
          </thead>
          <tbody>
            {sortBlockersFirst(rows).map((row) => {
              const badge = renameSlugBadge(row.action)
              return (
                <tr
                  key={row.managed_database_id}
                  className={
                    renameSlugBlocks(row.action)
                      ? 'border-t border-border bg-error/5 align-top'
                      : 'border-t border-border align-top'
                  }
                >
                  <td className="break-words px-3 py-2 font-medium text-foreground">
                    {labelOf(row)}
                  </td>
                  <td className="break-words px-3 py-2 text-muted-foreground">
                    {row.server_name ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col items-start gap-1">
                      <Badge tone={badge.tone} title={badge.title}>
                        {badge.label}
                      </Badge>
                      {row.action === 'rename' && (
                        <span className="break-all font-mono text-xs text-muted-foreground">
                          {row.source_table ?? 'origen no informado'} → {targetTable ?? 'destino'}
                        </span>
                      )}
                      {showMirror && <MirrorNote row={row} mirrorTable={mirrorTable} />}
                    </div>
                  </td>
                  {/* `whitespace-pre-wrap`: el detalle puede venir con saltos y son suyos. */}
                  <td className="whitespace-pre-wrap break-words px-3 py-2 text-xs text-muted-foreground">
                    {row.detail ?? '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/**
 * El estado del espejo de UNA base. 🔴 `null` NO es «no lo tiene»: es que no se pudo leer, y
 * esa base no se toca. En una base `unreachable` se calla, porque el badge ya lo dice.
 */
function MirrorNote({ row, mirrorTable }: { row: EvidenceRow; mirrorTable: string | null }) {
  const name = mirrorTable ?? 'espejo del historial'
  if (row.has_mirror === false) {
    return <span className="text-xs text-foreground">Recibirá {name}</span>
  }
  if (row.has_mirror === null && row.action !== 'unreachable') {
    return <span className="text-xs text-muted-foreground">No se pudo leer si tiene {name}</span>
  }
  return null
}

/**
 * El resultado de una ejecución exitosa. Es un paso y no un toast porque el espejo **no aborta**
 * la operación cuando falla: sin esta pantalla el operador cree que el parque quedó uniforme.
 *
 * 🔴 Solo se informa si el espejo se creó o falló. Su CONTENIDO no se lee ni se presenta: es un
 * espejo fail-open que puede tener huecos, y la fuente de verdad del historial es el gateway.
 */
function ResultPanel({
  mode,
  result,
  mirrorTable,
}: {
  mode: RenameSlugMode
  result: RenameSlugResult
  mirrorTable: string | null
}) {
  const renamed = result.renamed_databases.length
  const mirror = result.mirror

  return (
    <div className="flex flex-col gap-4">
      <Callout
        tone="success"
        title={mode === 'rename-slug' ? 'Slug renombrado' : 'Actualización terminada'}
      >
        {mode === 'rename-slug' && (
          <p>
            El blueprint pasa a{' '}
            <code className="rounded bg-surface-muted px-1 py-0.5">{result.model.slug}</code>.
          </p>
        )}
        <p>
          {renamed > 0
            ? `Se renombró la tabla de versión en ${renamed} base(s).`
            : 'No hubo que renombrar la tabla de versión en ninguna base.'}
        </p>
        {/* `mirror === null`: esta respuesta no reporta el espejo —el `rename-slug` desplegado hoy
            lo hace así—. No se pinta «0 creados», que afirmaría algo que nadie dijo. */}
        {mirror !== null && !mirror.skipped_disabled && (
          <p>
            {mirror.created.length > 0 ? (
              <>
                {mirror.created.length} base(s) recibieron el espejo del historial{' '}
                <MirrorName table={mirrorTable} />.
              </>
            ) : (
              'No se creó el espejo del historial en ninguna base.'
            )}
          </p>
        )}
      </Callout>

      {mirror?.skipped_disabled && (
        <Callout tone="info" title="El espejo del historial está desactivado">
          <p>
            El backend tiene el espejo apagado (<code>MIGRATION_MIRROR_ENABLED</code>), así que no
            se creó en ninguna base. La tabla de versión sí quedó como se indica arriba.
          </p>
        </Callout>
      )}

      {mirror !== null && mirror.failed.length > 0 && (
        <Callout
          tone="warning"
          title={`No se pudo crear el espejo en ${mirror.failed.length} base(s)`}
        >
          <p>
            No aborta la operación —la tabla de versión de esas bases está bien—, pero el parque no
            quedó uniforme: esas bases siguen sin espejo. El próximo apply, rollback o stamp sobre
            cada una lo vuelve a intentar.
          </p>
          <ul className="flex flex-col gap-1">
            {mirror.failed.map((row) => (
              <li key={row.managed_database_id} className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium text-foreground">{labelOf(row)}</span>
                {row.server_name && (
                  <span className="text-xs text-muted-foreground">({row.server_name})</span>
                )}
                {row.detail && (
                  <span className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
                    {row.detail}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Callout>
      )}
    </div>
  )
}

/** Panel de un error ya clasificado. Para `slugRenameFailed` delega en `IncidentPanel`. */
function ErrorPanel({
  error,
  modelId,
  mode,
  showReportLink,
  incidentHeading,
  replanning,
  onReplan,
}: {
  error: RenameError
  modelId: number
  mode: RenameSlugMode
  showReportLink: boolean
  incidentHeading: string
  replanning: boolean
  onReplan: () => void
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-error/40 bg-error/5 p-3 text-sm">
      {/*
        `role="alert"` envuelve SOLO el titular, no el panel entero. Lleva implícitos
        `aria-live="assertive"` y `aria-atomic="true"`, así que al aparecer el lector anuncia todo
        el subárbol de corrido, interrumpiendo, y sin que se pueda parar. Con `slug_rename_failed`
        ese subárbol es el parte de incidente completo —tres listas con base, servidor y detalle
        por fila, más dos botones—: un minuto largo de habla forzada en el peor momento posible,
        cuando el operador necesita LEER la tercera lista, no escuchar las tres. La evidencia se
        queda fuera de la región viva, donde se navega a voluntad.
      */}
      <div role="alert" className="flex flex-col gap-3">
        <p className="font-semibold text-error">{error.title}</p>
        <p className="text-muted-foreground">{error.text}</p>
        {error.cta && <p className="text-foreground">{error.cta}</p>}
      </div>

      {error.rows && error.rows.length > 0 && (
        <EvidenceTable
          title={error.rowsTitle ?? 'Bases afectadas'}
          rows={error.rows}
          targetTable={error.targetTable}
        />
      )}

      {error.incident && (
        <IncidentPanel
          incident={error.incident}
          modelId={modelId}
          mode={mode}
          showReportLink={showReportLink}
          heading={incidentHeading}
          title={error.title}
          text={error.text}
          requestId={error.requestId}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        {error.replan && (
          <Button variant="outline" size="sm" isLoading={replanning} onClick={onReplan}>
            Volver a comprobar
          </Button>
        )}
        {!error.incident && showReportLink && (
          <Link
            to={`/database-models/${modelId}/migrations?tab=contabilidad`}
            className="rounded-md px-2 py-1 text-xs text-primary hover:bg-primary/10"
          >
            Ver informe de contabilidad →
          </Link>
        )}
        {error.requestId && (
          <span className="ml-auto text-xs text-muted-foreground">
            Petición <code>{error.requestId}</code>
          </span>
        )}
      </div>
    </div>
  )
}

interface Incident {
  renamed: ApiRenameSlugDatabase[]
  failed?: ApiRenameSlugDatabase
  notCompensated: ApiRenameSlugDatabase[]
  oldTable?: string
  newTable?: string
}

/** Las tres listas del `public_context` de `slug_rename_failed`, con listas vacías por defecto. */
function incidentFrom(context: ReturnType<typeof toApiError>['databaseModelContext']): Incident {
  return {
    renamed: context?.renamed ?? [],
    failed: context?.failed,
    notCompensated: context?.notCompensated ?? [],
    oldTable: context?.oldTable,
    newTable: context?.newTable,
  }
}

/**
 * 🔴 `slug_rename_failed`: pantalla de INCIDENTE, no un toast y no un reintento.
 *
 * Las tres listas van **SEPARADAS y literales**. Fundirlas en «falló el renombrado» le esconde al
 * operador las únicas bases sobre las que tiene que actuar, que son las de `not_compensated`: el
 * resto ya volvió a su sitio solo. Son tres destinos distintos, no tres formas de decir lo mismo.
 *
 * No se ofrece reintentar: el parque quedó en un estado que el plan anterior ya no describe, y un
 * segundo intento sobre bases medio renombradas es exactamente cómo se llega al estado del que no
 * se sale. Primero se revisan a mano las de abajo.
 */
function IncidentPanel({
  incident,
  modelId,
  mode,
  showReportLink,
  heading,
  title,
  text,
  requestId,
}: {
  incident: Incident
  modelId: number
  mode: RenameSlugMode
  showReportLink: boolean
  heading: string
  title: string
  text: string
  requestId?: string
}) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)

  const report = formatIncidentReport({ incident, heading, title, text, requestId })

  const copyReport = () => {
    // Se comprueba ANTES de emprender la acción: `navigator.clipboard` no existe fuera de contexto
    // seguro y este gateway también se sirve por HTTP plano.
    if (!isClipboardAvailable()) {
      toast.error(
        'El navegador no expone el portapapeles',
        'Fuera de HTTPS no está disponible. Seleccioná el detalle a mano para el parte del incidente.',
      )
      return
    }
    navigator.clipboard.writeText(report).then(
      () => {
        setCopied(true)
        toast.success(
          'Detalle copiado',
          'Incluye las tres listas y el identificador de la petición.',
        )
      },
      () => toast.error('No se pudo copiar el detalle'),
    )
  }

  // En el renombrado de slug el gateway busca el nombre VIEJO en todas las bases, así que las que
  // quedaron con el nuevo están rotas. En la actualización de formato el backend resuelve el
  // nombre por base, así que no se afirma que estén rotas: se manda a comprobarlo en el informe.
  const notCompensatedNote =
    mode === 'rename-slug'
      ? incident.oldTable && incident.newTable
        ? `Devolvé su tabla de ${incident.newTable} a ${incident.oldTable}: el slug del blueprint no cambió, así que el gateway busca el nombre viejo y no lo encuentra.`
        : 'El slug del blueprint no cambió, así que el gateway busca el nombre viejo y no lo encuentra en estas bases.'
      : 'Quedaron con la tabla ya renombrada aunque la operación se revirtió en las demás. Antes de tocar nada, comprobá en el informe de contabilidad si el gateway las lee bien.'

  return (
    <div className="flex flex-col gap-3">
      <IncidentList
        tone="neutral"
        title={`Se renombraron y se devolvieron a su nombre original (${incident.renamed.length})`}
        note="Están como antes. No hay nada que hacer con estas."
        rows={incident.renamed}
      />

      <IncidentList
        tone="neutral"
        title="La base en la que falló"
        note="Es donde se cortó la operación. Su detalle dice por qué."
        rows={incident.failed ? [incident.failed] : []}
      />

      <IncidentList
        tone="error"
        title={
          mode === 'rename-slug'
            ? `🔴 Quedaron con el nombre NUEVO y hay que repararlas a mano (${incident.notCompensated.length})`
            : `🔴 Quedaron con el nombre NUEVO y hay que revisarlas (${incident.notCompensated.length})`
        }
        note={notCompensatedNote}
        rows={incident.notCompensated}
      />

      <div className="flex flex-wrap items-center gap-2">
        {showReportLink && (
          <Link
            to={`/database-models/${modelId}/migrations?tab=contabilidad`}
            className="rounded-md px-2 py-1 text-xs text-primary hover:bg-primary/10"
          >
            Ver informe de contabilidad →
          </Link>
        )}
        <Button variant="outline" size="sm" onClick={copyReport}>
          {copied ? 'Detalle copiado' : 'Copiar el detalle completo'}
        </Button>
      </div>
    </div>
  )
}

/** Una de las tres listas del incidente. Cada una lleva SU texto: el mismo listado con otro
 * significado es exactamente la confusión que hace que nadie repare nada. */
function IncidentList({
  tone,
  title,
  note,
  rows,
}: {
  tone: 'neutral' | 'error'
  title: string
  note: string
  rows: ApiRenameSlugDatabase[]
}) {
  return (
    <section
      className={
        tone === 'error'
          ? 'flex flex-col gap-1.5 rounded-lg border border-error/40 p-3'
          : 'flex flex-col gap-1.5 rounded-lg border border-border p-3'
      }
    >
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      <p className="text-xs text-muted-foreground">{note}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Ninguna.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((row) => (
            <li key={row.managed_database_id} className="flex flex-wrap items-baseline gap-2">
              <span className="text-sm font-medium text-foreground">{labelOf(row)}</span>
              {row.server_name && (
                <span className="text-xs text-muted-foreground">({row.server_name})</span>
              )}
              {row.detail && (
                <span className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
                  {row.detail}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * El parte del incidente en texto plano, para pegarlo donde se registren estas cosas.
 *
 * Lleva el `requestId` porque sin él soporte no puede encontrar la traza del backend, y lleva las
 * tres listas por separado por lo mismo que la pantalla: la lista que hay que reparar a mano tiene
 * que poder leerse sin reconstruirla.
 */
function formatIncidentReport({
  incident,
  heading,
  title,
  text,
  requestId,
}: {
  incident: Incident
  heading: string
  title: string
  text: string
  requestId?: string
}): string {
  const describe = (row: ApiRenameSlugDatabase) =>
    `  - ${row.database_name || `BD #${row.managed_database_id}`} (id ${row.managed_database_id}` +
    `${row.server_name ? `, servidor ${row.server_name}` : ''})` +
    `${row.detail ? `: ${row.detail}` : ''}`

  const block = (label: string, rows: ApiRenameSlugDatabase[]) =>
    [label, rows.length === 0 ? '  (ninguna)' : rows.map(describe).join('\n')].join('\n')

  return [
    `INCIDENTE — ${heading}: ${title}`,
    text,
    incident.oldTable && incident.newTable
      ? `Tabla: ${incident.oldTable} -> ${incident.newTable}`
      : '',
    requestId ? `X-Request-ID: ${requestId}` : '',
    '',
    block('Renombradas y devueltas a su nombre original:', incident.renamed),
    block('Base en la que falló:', incident.failed ? [incident.failed] : []),
    block('QUEDARON CON EL NOMBRE NUEVO — revisión manual:', incident.notCompensated),
  ]
    .filter((line) => line !== '')
    .join('\n')
}
