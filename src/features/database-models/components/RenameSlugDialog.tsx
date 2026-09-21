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
  type RenameSlugDatabase,
  type RenameSlugPlan,
} from '@/lib/contracts'
import { formatCountdown } from '@/lib/utils/countdown'
import { isClipboardAvailable } from '@/lib/utils'
import { useCountdown } from '@/lib/utils/use-countdown'
import { useRenameSlug, useRenameSlugPlan } from '../hooks/use-database-models'
import { renameSlugBadge, renameSlugBlocks, sortBlockersFirst } from '../rename-slug-badges'

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
  /** Solo `slugRenameFailed`: las tres listas van SEPARADAS, ver `IncidentPanel`. */
  incident?: {
    renamed: ApiRenameSlugDatabase[]
    failed?: ApiRenameSlugDatabase
    notCompensated: ApiRenameSlugDatabase[]
    oldTable?: string
    newTable?: string
  }
  requestId?: string
}

type Step = 'plan' | 'confirm'

interface RenameSlugDialogProps {
  modelId: number
  /** El slug que el blueprint tiene HOY, tal como lo conoce quien abre el diálogo. */
  currentSlug: string
  onClose: () => void
  /** Se llama tras el 200. El slug del blueprint cambió: quien abre decide a dónde volver. */
  onRenamed: () => void
}

/**
 * ¿Describen dos planes las MISMAS consecuencias sobre bases reales?
 *
 * Función pura y comparación por ids en orden, igual que el `planConsequencesChanged` de
 * `MigrationDeletePlanDialog`. Se usa para desmarcar el reconocimiento tras re-planificar: lo que
 * el usuario aceptó describía otra lista de bases, y arrastrar ese «sí» a una lista distinta
 * convierte la casilla en un trámite.
 *
 * Compara `databases` y no solo `blockers` porque el reconocimiento habla de «escribe en N
 * base(s)»: si cambia QUIÉN se renombra, aunque no haya bloqueantes ni antes ni después, el texto
 * que se aceptó ya no describe lo que va a pasar. También mira la ACCIÓN de cada fila, porque la
 * misma base puede pasar de `skip` a `rename` sin que la lista cambie de tamaño.
 */
function planConsequencesChanged(before: RenameSlugPlan, after: RenameSlugPlan): boolean {
  const same = (left: RenameSlugDatabase[], right: RenameSlugDatabase[]) =>
    left.length === right.length &&
    left.every(
      (row, index) =>
        row.managed_database_id === right[index]?.managed_database_id &&
        row.action === right[index]?.action,
    )

  return (
    before.new_table !== after.new_table ||
    before.rename_count !== after.rename_count ||
    !same(before.databases, after.databases)
  )
}

/** Nombre de una BD, degradando a «BD #7» cuando el payload no lo trae. */
function labelOf(row: EvidenceRow): string {
  return row.database_name || `BD #${row.managed_database_id}`
}

/**
 * Asistente de renombrado del slug de un blueprint (v25 §3.2 y §3.3).
 *
 * ## Por qué esto no es un campo de texto
 *
 * El slug nombra la tabla de versión `_gw_v_<slug>` **DENTRO de cada base gestionada**. Cambiarlo
 * con un `PATCH` no renombra nada en ningún motor: el gateway se queda apuntando a una tabla que ya
 * no existe y todas esas bases pierden su contabilidad. El renombrado de verdad es una **escritura
 * remota por base**, sin transacción compartida entre motores distintos, y por eso tiene su propio
 * ciclo: preview autoritativo → `confirm_token` con TTL → ejecución.
 *
 * ## El plan se pide de un clic, nunca al montar
 *
 * `rename-slug/plan` abre una conexión por base y está limitado a 10/min. Pedirlo al montar —o por
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
export function RenameSlugDialog({
  modelId,
  currentSlug,
  onClose,
  onRenamed,
}: RenameSlugDialogProps) {
  const [step, setStep] = useState<Step>('plan')
  const [newSlug, setNewSlug] = useState('')
  const [plan, setPlan] = useState<RenameSlugPlan | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [error, setError] = useState<RenameError | null>(null)

  /**
   * Tira el plan y vuelve al paso 1, para los rechazos que **prueban que el plan ya no describe
   * la realidad**.
   *
   * Sin esto, el semáforo se quedaba en 🟢 «Listo para renombrar» debajo del error que acababa
   * de desmentirlo, con el `Callout` de «Se va a escribir en N base(s)» intacto y la casilla de
   * reconocimiento aún marcada. Un veredicto que no se invalida cuando el backend lo contradice
   * deja de ser un veredicto y pasa a ser la decoración del último preview — y el verde es
   * justamente lo que autoriza a no leer el resto.
   *
   * El reconocimiento se desmarca por lo mismo que en `planConsequencesChanged`: describía una
   * lista de bases que ya no es la que hay.
   */
  /**
   * Ancla de foco del paso 2.
   *
   * Al pulsar «Renombrar N base(s)» ese botón se desmonta y lo sustituyen otros dos. Cuando el
   * elemento enfocado desaparece del DOM el foco cae al contenedor, sin nada que lo anuncie: quien
   * navega por teclado pulsa y no percibe que pasó nada, y el siguiente Tab lo devuelve al
   * principio del diálogo, atravesando el input de slug y la tabla de evidencia antes de llegar a
   * la casilla de reconocimiento que ahora es obligatoria.
   *
   * Se mueve a mano en el handler del clic, **no en un `useEffect`**: es una consecuencia directa
   * de una interacción, no un estado que sincronizar.
   */
  const confirmAnchor = useRef<HTMLDivElement>(null)

  const goToConfirm = () => {
    setStep('confirm')
    // En el mismo tick el nodo todavía no existe; `requestAnimationFrame` espera al commit.
    requestAnimationFrame(() => confirmAnchor.current?.focus())
  }

  const invalidatePlan = () => {
    setPlan(null)
    setAcknowledged(false)
    setStep('plan')
  }

  const planMutation = useRenameSlugPlan(modelId)
  const renameMutation = useRenameSlug(modelId)
  // Escribe en bases ajenas: el requisito es `blueprints.write`. Se deshabilita el control en vez
  // de dejar que el 403 llegue después de leer el plan entero y marcar el reconocimiento.
  const guard = useCapabilityGuard(
    CAPABILITIES.blueprintsWrite,
    'renombrar el slug de un blueprint',
  )

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
  const slugUsable = trimmedSlug !== '' && slugError === undefined

  const blockers = plan?.blockers ?? []
  const isBlocked = blockers.length > 0
  // `no_op` manda sobre todo lo demás: los dos slugs truncan al mismo nombre de tabla, así que no
  // hay nada que renombrar aunque el parque esté lleno de bases.
  const isNoRemote = plan !== null && !isBlocked && (plan.no_op || plan.rename_count === 0)
  const isReady = plan !== null && !isBlocked && !plan.no_op && plan.rename_count > 0

  const inFlight = renameMutation.isPending

  const requestPlan = (options?: { keepError?: boolean }) => {
    if (!options?.keepError) setError(null)
    const previous = plan
    planMutation.mutate(trimmedSlug, {
      onSuccess: (next) => {
        // El reconocimiento describe una lista concreta de bases. Si esa lista cambió, se vuelve a
        // pedir: la casilla no puede seguir marcada sobre algo que el usuario no leyó.
        if (previous === null || planConsequencesChanged(previous, next)) setAcknowledged(false)
        setPlan(next)
      },
      onError: (err) => {
        const apiError = toApiError(err)
        setPlan(null)
        setError({
          title: 'No se pudo comprobar el plan',
          text: apiError.message,
          replan: true,
          requestId: apiError.requestId,
        })
      },
    })
  }

  const submit = () => {
    if (plan === null) return
    setError(null)
    renameMutation.mutate(
      // El token va tal cual viene del plan: `null` cuando no hay nada remoto que renombrar.
      // Mandarlo siempre entrenaría al cliente a mandarlo siempre y vaciaría la confirmación.
      { newSlug: plan.new_slug, confirmToken: plan.confirm_token },
      {
        onSuccess: () => onRenamed(),
        onError: (err) => {
          const apiError = toApiError(err)
          const requestId = apiError.requestId
          const context = apiError.databaseModelContext

          // Se clasifica SIEMPRE por `public_context.code`. Ni por status —`slug_rename_plan_stale`
          // hereda el del servicio de tokens y no está garantizado— ni por la prosa, que puede
          // transcribir el error del motor (host, usuario, fragmentos de sentencia).
          if (apiError.code === DATABASE_MODEL_ERROR_CODES.slugRenameConflict) {
            setError({
              title: 'Alguna base ya tiene una tabla con el nombre nuevo',
              text: `El renombrado pisaría esa tabla, así que se aborta la operación entera: el gateway apunta a un solo nombre y dejar medio parque renombrado le quita la contabilidad al resto. El destino sería ${context?.newTable ?? 'la tabla nueva'}.`,
              // 🔴 NO se ofrece «renombrá o eliminá la tabla que sobra»: no hay endpoint para eso
              // y la consola SQL bloquea por diseño cualquier sentencia que nombre `_gw_v_*`.
              // Mandar al operador a hacer algo que la propia aplicación le va a rechazar es peor
              // que no decirle nada, porque se va a la consola, la sentencia le rebota y se queda
              // sin saber por qué. Lo honesto es nombrar lo que SÍ puede hacer —mirar el informe—
              // y decir que el resto pide acceso directo al motor.
              cta: 'Mirá qué tabla sobra en esas bases en el informe de contabilidad. Quitarla requiere acceso directo al motor: el gateway no expone esa operación y la consola SQL la bloquea por diseño.',
              replan: false,
              rowsTitle: 'Bases que ya tienen la tabla destino',
              rows: context?.conflictingDatabases,
              requestId,
            })
            invalidatePlan()
            return
          }

          if (apiError.code === DATABASE_MODEL_ERROR_CODES.slugRenameUnreachable) {
            setError({
              title: 'No se pudo leer alguna base',
              text: 'No significa que no tengan la tabla destino: significa que no se pudo probar que no la tengan. El gateway prefiere negarse a suponer, así que aborta la operación entera.',
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
              title: 'Falta la confirmación de este renombrado',
              text: 'La ejecución llegó sin autorización vigente y el plan tenía bases que renombrar. Estas son las bases en las que habría que escribir.',
              cta: 'Pedí el preview otra vez para obtener una autorización nueva.',
              replan: true,
              rowsTitle: 'Lo que se iba a renombrar',
              rows: context?.renamePlan,
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
            setError({
              title: 'El slug del blueprint NO se modificó.',
              text: 'El renombrado falló a mitad del parque. El slug sigue siendo el de antes, así que el gateway sigue apuntando al nombre viejo de la tabla. Abajo está, base por base, qué quedó en qué estado: no se puede resumir porque cada lista tiene un destino distinto.',
              replan: false,
              incident: {
                renamed: context?.renamed ?? [],
                failed: context?.failed,
                notCompensated: context?.notCompensated ?? [],
                oldTable: context?.oldTable,
                newTable: context?.newTable,
              },
              requestId,
            })
            return
          }

          setError({
            title: 'No se pudo renombrar el slug',
            text: apiError.message,
            replan: false,
            requestId,
          })
        },
      },
    )
  }

  const isIncident = error?.incident !== undefined
  const canSubmitRemote = error === null && acknowledged && tokenAlive && guard.allowed

  return (
    <Modal
      open
      // Con la operación en vuelo el diálogo se bloquea entero: el endpoint es 3/min y un doble
      // envío se come el presupuesto de reintento justo cuando hace falta.
      onClose={inFlight ? () => undefined : onClose}
      dismissible={!inFlight}
      title={`Renombrar el slug de «${currentSlug}» 🔌`}
      description="Escribe dentro de cada base gestionada. No es un cambio local."
      size="lg"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          {isReady && (
            <span className="text-xs text-muted-foreground">
              {tokenAlive
                ? `La confirmación caduca en ${formatCountdown(remaining)}.`
                : 'La confirmación caducó.'}
            </span>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="ghost" onClick={onClose} disabled={inFlight}>
              {isIncident ? 'Cerrar' : 'Cancelar'}
            </Button>

            {step === 'plan' && !isIncident && (
              <>
                <Button
                  variant="outline"
                  disabled={!slugUsable || inFlight}
                  isLoading={planMutation.isPending}
                  onClick={() => requestPlan()}
                >
                  {plan === null ? 'Ver qué se va a renombrar' : 'Volver a comprobar'}
                </Button>

                {/* Sin cambios remotos: se envía SIN `confirm_token` y sin ceremonia, porque no
                    hay ninguna escritura remota que reconocer. */}
                {isNoRemote && (
                  <Button
                    disabled={!guard.allowed || error !== null}
                    title={guard.hint}
                    isLoading={inFlight}
                    onClick={submit}
                  >
                    Cambiar el slug
                  </Button>
                )}

                {isReady && (
                  <Button
                    disabled={!guard.allowed || !tokenAlive || error !== null}
                    title={guard.hint}
                    onClick={goToConfirm}
                  >
                    Renombrar {plan.rename_count} base(s) 🔌
                  </Button>
                )}
              </>
            )}

            {step === 'confirm' && !isIncident && (
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
                  Renombrar {plan?.rename_count ?? 0} base(s) 🔌
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
          {!guard.allowed && guard.hint && (
            <p className="text-xs text-muted-foreground">{guard.hint}</p>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <ErrorPanel
            error={error}
            modelId={modelId}
            replanning={planMutation.isPending}
            onReplan={() => requestPlan()}
          />
        )}

        {step === 'plan' && !isIncident && (
          <>
            {/* El aviso va ANTES de pedir nada: es la consecuencia que decide si esta pantalla
                debería estar abierta siquiera. Va en `Callout` y no en un `hint` por la regla del
                repo — si un aviso decide algo, se lee antes de decidir, no al pasar el ratón. */}
            <Callout tone="warning" title="Esto escribe en bases de datos de terceros 🔌">
              <p>
                Renombra una tabla <strong className="text-foreground">DENTRO</strong> de cada base
                gestionada. Son escrituras remotas, una por base y{' '}
                <strong className="text-foreground">sin transacción compartida</strong> entre
                motores distintos: no existe un «deshacer» atómico si algo falla a mitad.
              </p>
            </Callout>

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
                  // El plan describe un slug concreto. Al cambiar el texto deja de describir lo que
                  // se enviaría, así que se tira: NO se pide otro solo —eso sería un preview por
                  // pulsación de tecla, que es justo lo que el límite de 10/min prohíbe.
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

            {plan === null ? (
              <p className="text-sm text-muted-foreground">
                Todavía no se comprobó nada. «Ver qué se va a renombrar» abre una conexión a cada
                base del blueprint para ver cuáles tienen la tabla de versión y cuáles ya tienen el
                nombre destino ocupado. No escribe nada.
              </p>
            ) : (
              <>
                {/* 🔴 EL SEMÁFORO. Un veredicto, no una lista: tres estados y uno solo visible. */}
                <Verdict
                  plan={plan}
                  modelId={modelId}
                  blocked={isBlocked}
                  ready={isReady}
                  replanning={planMutation.isPending}
                  onReplan={() => requestPlan()}
                />

                {/* La evidencia va SIEMPRE debajo del veredicto, nunca en su lugar: el veredicto
                    dice qué pasa, la tabla demuestra por qué. */}
                <EvidenceTable
                  title={`Las ${plan.databases.length} base(s) del blueprint`}
                  rows={plan.databases}
                />
              </>
            )}
          </>
        )}

        {step === 'confirm' && plan !== null && !isIncident && (
          // `tabIndex={-1}` lo hace enfocable por código pero NO lo mete en el orden de
          // tabulación: el foco aterriza justo encima de «Se va a escribir en N base(s)», que es
          // lo que hay que leer, y el Tab siguiente llega a la casilla de reconocimiento.
          <div ref={confirmAnchor} tabIndex={-1} className="flex flex-col gap-4 outline-none">
            <Callout tone="danger" title={`Se va a escribir en ${plan.rename_count} base(s) 🔌`}>
              <p>
                <code className="rounded bg-surface-muted px-1 py-0.5">{plan.current_table}</code> →{' '}
                <code className="rounded bg-surface-muted px-1 py-0.5">{plan.new_table}</code>, en{' '}
                {plan.rename_count} base(s) de datos reales.
              </p>
            </Callout>

            {/* El orden interno va como texto VISIBLE y no como tooltip: es lo que determina en qué
                estado queda el sistema si algo falla a mitad, y eso no se descubre por accidente. */}
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-foreground">En qué orden pasa esto</h3>
              <p className="text-sm text-muted-foreground">
                Primero se renombra la tabla en los {plan.rename_count} motores; el slug del
                blueprint se actualiza <strong className="text-foreground">ÚLTIMO</strong>. Si algo
                falla a mitad, lo ya renombrado se renombra de vuelta y el slug{' '}
                <strong className="text-foreground">NO</strong> se modifica: el gateway nunca queda
                apuntando a un nombre que las bases no tienen.
              </p>
            </section>

            <div className="rounded-lg border border-border p-3">
              <Checkbox
                label={`Entiendo que esto escribe en ${plan.rename_count} base(s) reales.`}
                checked={acknowledged}
                disabled={inFlight}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
            </div>

            {/* Al caducar NO se re-planifica solo: la lista de bases pudo cambiar y hay que volver
                a verla. El botón de confirmar ya está deshabilitado por `tokenAlive`. */}
            {!tokenAlive && (
              <Callout
                tone="warning"
                title="La autorización de este plan caducó"
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    isLoading={planMutation.isPending}
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

/**
 * 🔴 El semáforo: **un veredicto**, con tres estados y uno solo visible a la vez.
 *
 * No es un resumen de la tabla de abajo. La tabla dice qué le pasa a cada base; esto dice si la
 * operación se puede hacer, y por qué el bloqueo de una sola base aborta las demás.
 */
function Verdict({
  plan,
  modelId,
  blocked,
  ready,
  replanning,
  onReplan,
}: {
  plan: RenameSlugPlan
  modelId: number
  blocked: boolean
  ready: boolean
  replanning: boolean
  onReplan: () => void
}) {
  if (blocked) {
    const conflicts = plan.blockers.filter((row) => row.action === 'conflict')
    const unreachable = plan.blockers.filter((row) => row.action === 'unreachable')

    return (
      <Callout
        tone="danger"
        title="🔴 Bloqueado: no se puede renombrar"
        action={
          <>
            <Button size="sm" variant="outline" isLoading={replanning} onClick={onReplan}>
              Volver a comprobar
            </Button>
            <Link
              to={`/database-models/${modelId}/migrations?tab=contabilidad`}
              className="inline-flex items-center rounded-md px-2 py-1 text-xs text-primary hover:bg-primary/10"
            >
              Ver informe de contabilidad →
            </Link>
          </>
        }
      >
        <p>
          La operación se aborta <strong className="text-foreground">ENTERA</strong>: el gateway
          apunta a un solo nombre de tabla, así que renombrar solo una parte del parque dejaría a la
          otra con su contabilidad huérfana.
        </p>
        {conflicts.length > 0 && (
          <p>
            <strong className="text-foreground">{conflicts.length} base(s)</strong> ya tienen una
            tabla <code className="rounded bg-surface-muted px-1 py-0.5">{plan.new_table}</code>.
          </p>
        )}
        {unreachable.length > 0 && (
          <p>
            No se pudo leer{' '}
            <strong className="text-foreground">{unreachable.length} base(s)</strong>. No se puede
            probar que no la tengan.
          </p>
        )}
      </Callout>
    )
  }

  if (ready) {
    return (
      <Callout tone="success" title="🟢 Listo para renombrar">
        <p>
          Se renombrará{' '}
          <code className="rounded bg-surface-muted px-1 py-0.5">{plan.current_table}</code> →{' '}
          <code className="rounded bg-surface-muted px-1 py-0.5">{plan.new_table}</code> en{' '}
          <strong className="text-foreground">{plan.rename_count} base(s)</strong>.
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
 * `detail` se pinta TAL CUAL y sin resumir: es lo único que distingue «esa tabla la creó otro
 * blueprint» de «el motor rechazó la consulta», y resumirlo borra justo la parte accionable.
 *
 * Es una tabla nativa y no un `DataTable` porque vive dentro de un modal `lg`: cuatro columnas que
 * envuelven texto caben sin scroll horizontal en cualquier ancho, que es la regla del repo.
 */
function EvidenceTable({ title, rows }: { title: string; rows: EvidenceRow[] }) {
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
              <th scope="col" className="w-1/4 px-3 py-2 font-medium">
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
                    <Badge tone={badge.tone} title={badge.title}>
                      {badge.label}
                    </Badge>
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

/** Panel de un error ya clasificado. Para `slugRenameFailed` delega en `IncidentPanel`. */
function ErrorPanel({
  error,
  modelId,
  replanning,
  onReplan,
}: {
  error: RenameError
  modelId: number
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
        <EvidenceTable title={error.rowsTitle ?? 'Bases afectadas'} rows={error.rows} />
      )}

      {error.incident && (
        <IncidentPanel
          incident={error.incident}
          modelId={modelId}
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
        {!error.incident && (
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

/**
 * 🔴 `slug_rename_failed`: pantalla de INCIDENTE, no un toast y no un reintento.
 *
 * Las tres listas van **SEPARADAS y literales**. Fundirlas en «falló el renombrado» le esconde al
 * operador las únicas bases sobre las que tiene que actuar, que son las de `not_compensated`: el
 * resto ya volvió a su sitio solo. Son tres destinos distintos, no tres formas de decir lo mismo.
 *
 * No se ofrece reintentar: el parque quedó en un estado que el plan anterior ya no describe, y un
 * segundo intento sobre bases medio renombradas es exactamente cómo se llega al estado del que no
 * se sale. Primero se reparan a mano las de abajo.
 */
function IncidentPanel({
  incident,
  modelId,
  title,
  text,
  requestId,
}: {
  incident: Incident
  modelId: number
  title: string
  text: string
  requestId?: string
}) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)

  const report = formatIncidentReport({ incident, title, text, requestId })

  const copy = () => {
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
        title={`🔴 Quedaron con el nombre NUEVO y hay que repararlas a mano (${incident.notCompensated.length})`}
        note={
          incident.oldTable && incident.newTable
            ? `Devolvé su tabla de ${incident.newTable} a ${incident.oldTable}: el slug del blueprint no cambió, así que el gateway busca el nombre viejo y no lo encuentra.`
            : 'El slug del blueprint no cambió, así que el gateway busca el nombre viejo y no lo encuentra en estas bases.'
        }
        rows={incident.notCompensated}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Link
          to={`/database-models/${modelId}/migrations?tab=contabilidad`}
          className="rounded-md px-2 py-1 text-xs text-primary hover:bg-primary/10"
        >
          Ver informe de contabilidad →
        </Link>
        <Button variant="outline" size="sm" onClick={copy}>
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
  title,
  text,
  requestId,
}: {
  incident: Incident
  title: string
  text: string
  requestId?: string
}): string {
  const describe = (row: ApiRenameSlugDatabase) =>
    `  - ${row.database_name || `BD #${row.managed_database_id}`} (id ${row.managed_database_id}` +
    `${row.server_name ? `, servidor ${row.server_name}` : ''})` +
    `${row.detail ? `: ${row.detail}` : ''}`

  const block = (heading: string, rows: ApiRenameSlugDatabase[]) =>
    [heading, rows.length === 0 ? '  (ninguna)' : rows.map(describe).join('\n')].join('\n')

  return [
    `INCIDENTE — renombrado de slug: ${title}`,
    text,
    incident.oldTable && incident.newTable
      ? `Tabla: ${incident.oldTable} -> ${incident.newTable}`
      : '',
    requestId ? `X-Request-ID: ${requestId}` : '',
    '',
    block('Renombradas y devueltas a su nombre original:', incident.renamed),
    block('Base en la que falló:', incident.failed ? [incident.failed] : []),
    block('QUEDARON CON EL NOMBRE NUEVO — reparación manual:', incident.notCompensated),
  ]
    .filter((line) => line !== '')
    .join('\n')
}
