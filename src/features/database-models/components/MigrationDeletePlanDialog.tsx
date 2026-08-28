import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Callout, Input, Modal } from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import { formatCountdown } from '@/lib/utils/countdown'
import { useCountdown } from '@/lib/utils/use-countdown'
import {
  MIGRATION_ERROR_CODES,
  type MigrationAffectedPartialApplication,
  type MigrationDeletePlanOut,
  type MigrationDeleteResult,
  type MigrationRenumberStep,
  type MigrationStampStep,
  type MigrationUnstampableDatabase,
} from '@/lib/contracts'
import { useDeleteModelMigration, useModelMigrationDeletePlan } from '../hooks/use-model-migrations'
import { BlockingDatabasesList } from './BlockingDatabasesList'

/**
 * Misma forma ANCHA que acepta `BlockingDatabasesList`, con `reason` como `string`.
 *
 * Las filas llegan de dos sitios con tipos distintos —`plan.blockers` (validado por Zod) y
 * `ApiError.blockingDatabases` (sin validar, porque `lib/api` no depende de `lib/contracts`)— y
 * el tipo ancho es lo que permite pintarlas con el mismo componente sin un adaptador por medio.
 */
interface BlockingRow {
  managed_database_id: number
  reason: string
  current_version?: string
}

/**
 * Un error del `DELETE`, ya CLASIFICADO por `code`/`status` y listo para pintar.
 *
 * Es un objeto de datos y no JSX a propósito: la clasificación ocurre en un solo sitio
 * (`submit`), y el render solo decide qué bloques dibujar. Así no hay dos ramas que puedan
 * describir el mismo 409 de dos formas distintas.
 */
interface DeleteError {
  title: string
  text: string
  /** ¿Ofrecer «Volver a comprobar el plan»? Falso cuando primero hay trabajo manual que hacer. */
  replan: boolean
  /** 409 `version_in_use` / `unreadable_databases`. */
  blocking?: BlockingRow[]
  /** 409 `renumber_confirmation_required`: el plan de stamps que llegó sin token. */
  stampPlan?: MigrationStampStep[]
  /** 409 `renumber_stamp_failed` SIN compensar: las BDs que quedaron mal marcadas. */
  leftMoved?: MigrationStampStep[]
  /** 409 `renumber_target_missing`: BDs cuyo destino no existe en su historial. */
  unstampable?: MigrationUnstampableDatabase[]
  /** 409 `affected_partial_application`; ver el comentario de `submit`. */
  partialApplications?: MigrationAffectedPartialApplication[]
  requestId?: string
}

type Step = 'plan' | 'result'

interface MigrationDeletePlanDialogProps {
  modelId: number
  version: string
  /**
   * Plan de la PRIMERA comprobación, la que dispara este diálogo al pulsar «Eliminar…». Llega por
   * props y no se pide aquí al montar: lanzar la llamada desde el render sería un efecto
   * encubierto, y hacerlo desde un `useEffect` obligaría a sincronizar estado con props —que en
   * este repo es error de lint. Las re-comprobaciones sí nacen acá, pero siempre de un clic.
   */
  initialPlan: MigrationDeletePlanOut
  onClose: () => void
  /** Se llama tras el 200, cuando el usuario cierra la pantalla de resultado. */
  onDeleted: () => void
}

/** Nombre de una BD, degradando a «BD #7» cuando el payload no lo trae (mismo criterio que
 * `BlockingDatabasesList`): un nombre que falta no es un fallo de la operación, y esconder la
 * fila por no poder titularla sí lo sería. */
function labelOf(row: { managed_database_id: number; database_name?: string }): string {
  return row.database_name ?? `BD #${row.managed_database_id}`
}

/**
 * ¿Describen dos planes las MISMAS consecuencias sobre bases reales?
 *
 * Función pura y comparación por ids en orden, igual que el `blockingChanged` de
 * `MigrationEditOverrideDialog`. Se usa para desmarcar el reconocimiento tras re-planificar: lo
 * que el usuario aceptó describía otra lista de bases, y arrastrar ese «sí» a una lista distinta
 * convierte la casilla en un trámite. Solo mira `stamp_plan` y `blockers` porque son las dos
 * listas que hablan de BDs; el renumerado es metadata del blueprint y no cambia a quién se toca.
 */
function planConsequencesChanged(
  before: MigrationDeletePlanOut,
  after: MigrationDeletePlanOut,
): boolean {
  const sameIds = (
    left: { managed_database_id: number }[],
    right: { managed_database_id: number }[],
  ) =>
    left.length === right.length &&
    left.every((row, index) => row.managed_database_id === right[index]?.managed_database_id)

  return !sameIds(before.stamp_plan, after.stamp_plan) || !sameIds(before.blockers, after.blockers)
}

/**
 * Borrar una versión de blueprint, **intermedia o punta** (api-reference-v18).
 *
 * ## Qué hace de verdad el borrado, que es lo que esta pantalla existe para comunicar
 *
 * 1. La versión desaparece del blueprint y las posteriores **bajan un escalón** (`0016` pasa a
 *    llamarse `0015`). Las anteriores no se tocan.
 * 2. A las BDs que están **más adelante** se les mueve el puntero a la etiqueta nueva de **la
 *    misma** migración: una base en `0020` queda en `0019` porque esa migración ahora se llama
 *    así. **No retrocede de esquema, sigue un renombre.**
 * 3. **No se ejecuta ningún SQL y esto no es un rollback.** Las bases que ya aplicaron la versión
 *    borrada conservan FÍSICAMENTE sus objetos; lo único que pasa es que la cadena del blueprint
 *    deja de describirlos.
 * 4. Mover el puntero **escribe dentro de cada base gestionada** (un `UPDATE` sobre la tabla de
 *    versión de Alembic, con conexión y advisory lock). No es una operación local del gateway, y
 *    por eso ese caso —y solo ese— pide confirmación y va marcado 🔌.
 *
 * ## Por qué el plan se pide de un clic y no al montar
 *
 * El `delete-plan` abre conexión a cada BD del blueprint: es caro y su veredicto es autoritativo
 * **en vivo**, a diferencia de `deletable` / `delete_requires_stamps` del listado, que salen de la
 * caché del inventario. Ante discrepancia manda el plan, siempre. El primero llega por props
 * (`initialPlan`) desde la página; los siguientes salen de «Volver a comprobar».
 *
 * **Nunca se re-planifica en silencio.** Ni al caducar el token, ni tras un error. Cada plan nuevo
 * puede describir otras bases, y el usuario tiene que volver a verlas antes de confirmar nada.
 */
export function MigrationDeletePlanDialog({
  modelId,
  version,
  initialPlan,
  onClose,
  onDeleted,
}: MigrationDeletePlanDialogProps) {
  const [step, setStep] = useState<Step>('plan')
  const [plan, setPlan] = useState<MigrationDeletePlanOut>(initialPlan)
  const [result, setResult] = useState<MigrationDeleteResult | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [versionInput, setVersionInput] = useState('')
  const [error, setError] = useState<DeleteError | null>(null)

  const deletePlan = useModelMigrationDeletePlan(modelId)
  const deleteMigration = useDeleteModelMigration(modelId)

  // La vigencia sale SIEMPRE de `expires_at`: el TTL (unos dos minutos) empieza a correr en el
  // servidor y no viaja en la respuesta, así que una constante local mentiría por el tiempo de
  // red. `useCountdown` además descuenta un margen por desfase de reloj del cliente.
  const remaining = useCountdown(plan.expires_at)
  const tokenAlive = plan.confirm_token !== null && remaining > 0

  const needsToken = plan.deletable && plan.requires_confirmation
  const versionMatches = versionInput === version
  // Un intento fallido DESARMA el botón hasta que haya un plan fresco, y esto no es celo: el
  // plan que se confirmó ya no describe la realidad —por eso falló— y su token está quemado. El
  // caso que lo hace obligatorio es `renumber_stamp_failed` sin compensar: ahí el panel pide un
  // `stamp` manual ANTES de reintentar, y dejar el botón armado debajo de ese texto es ofrecer
  // exactamente lo que se acaba de desaconsejar. Entre un texto y un control que se contradicen,
  // gana el control. La salida no es un callejón: «Volver a comprobar» limpia el error y trae el
  // plan nuevo, que es el paso que el contrato manda dar (§7).
  const canSubmit =
    error === null &&
    (needsToken ? acknowledged && versionMatches && tokenAlive : plan.deletable && versionMatches)

  const replan = () => {
    setError(null)
    deletePlan.mutate(version, {
      onSuccess: (next) => {
        // El reconocimiento describe una lista concreta de bases. Si esa lista cambió, se vuelve
        // a pedir: la casilla no puede seguir marcada sobre algo que el usuario no leyó.
        if (planConsequencesChanged(plan, next)) setAcknowledged(false)
        setPlan(next)
      },
      onError: (err) => {
        const apiError = toApiError(err)
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
    setError(null)
    deleteMigration.mutate(
      // El token va tal cual viene del plan: `null` cuando no hace falta confirmar. Mandarlo
      // siempre entrenaría al cliente a mandarlo siempre y vaciaría la confirmación de sentido.
      { version, confirmToken: plan.confirm_token },
      {
        onSuccess: (data) => {
          setResult(data)
          setStep('result')
        },
        onError: (err) => {
          const apiError = toApiError(err)
          const requestId = apiError.requestId

          // NUNCA se parsea el `message` del backend para clasificar: no transcribe el error del
          // motor a propósito (puede llevar host, usuario o fragmentos de sentencia). Se clasifica
          // por `public_context.code` y, para lo que sale del servicio de tokens —compartido con
          // otros módulos y por tanto SIN `code`—, por `status`.
          if (apiError.status === 410) {
            setError({
              title: 'La confirmación caducó',
              text: 'La autorización vale unos dos minutos y la de este plan ya venció. Vuelve a comprobar el plan: puede haber cambiado.',
              replan: true,
              requestId,
            })
            return
          }
          if (apiError.status === 422 && apiError.code === undefined) {
            setError({
              title: 'El plan ya no describe la realidad',
              text: 'El token está atado al estado del parque de bases, y alguna se movió mientras tanto (un apply que corría en paralelo, por ejemplo). No es un fallo tuyo ni hay nada que arreglar: hay que volver a comprobar el plan para confirmar sobre el estado de ahora.',
              replan: true,
              requestId,
            })
            return
          }

          if (apiError.code === MIGRATION_ERROR_CODES.versionInUse) {
            setError({
              title: 'Alguna base está exactamente en esta versión',
              text: 'No es que la hayan aplicado alguna vez: es que su puntero apunta hoy a esta versión, y borrarla lo dejaría apuntando a algo que no existe. Muévelas primero con un apply (hacia adelante) o un rollback (hacia atrás) y vuelve a intentarlo.',
              replan: true,
              blocking: apiError.blockingDatabases,
              requestId,
            })
            return
          }
          if (apiError.code === MIGRATION_ERROR_CODES.unreadableDatabases) {
            setError({
              title: 'No se pudo leer la versión de alguna base',
              text: 'El gateway no puede afirmar dónde están, así que no borra: prefiere negarse a suponer. Es un problema de acceso a esas bases —motor caído, base sin aprovisionar, credenciales rotas—, no del blueprint ni de esta versión. Arregla la conexión y vuelve a comprobar.',
              replan: true,
              blocking: apiError.blockingDatabases,
              requestId,
            })
            return
          }
          if (apiError.code === MIGRATION_ERROR_CODES.renumberConfirmationRequired) {
            setError({
              title: 'Falta la confirmación de este borrado',
              text: 'El borrado necesita mover punteros en bases reales y llegó sin autorización vigente. Vuelve a comprobar el plan para obtener una nueva; estas son las bases en las que habría que escribir.',
              replan: true,
              stampPlan: apiError.stampPlan,
              requestId,
            })
            return
          }
          if (apiError.code === MIGRATION_ERROR_CODES.renumberStampFailed) {
            // Se compara con `=== true` y NO se asume `true` por defecto: ausente o `false`
            // significa que quedaron bases mal marcadas, y decir «no hay nada que arreglar» justo
            // cuando sí lo hay es el mensaje que hace que nadie mire.
            const compensated = apiError.renumberCompensated === true
            setError({
              title: compensated
                ? 'Falló al mover los punteros y se deshizo todo'
                : 'Falló al mover los punteros y algunas bases quedaron mal marcadas',
              text: compensated
                ? 'El blueprint NO se modificó: la versión sigue existiendo y el renumerado no ocurrió. Los punteros que se habían llegado a mover volvieron a su sitio, así que no hay nada pendiente y se puede reintentar.'
                : 'El blueprint NO se modificó: la versión sigue existiendo y el renumerado no ocurrió. Lo que sí quedó torcido son los punteros de las bases de abajo, que apuntan a una versión que no les corresponde. Hay que corregirlas con un stamp manual ANTES de volver a intentar el borrado: el reintento recalcula el plan sobre punteros que el backend ya no cree que estén donde están.',
              // Sin compensar no se ofrece «Volver a comprobar»: primero hay trabajo manual, y un
              // botón de reintento al lado invita justamente a saltárselo.
              replan: compensated,
              leftMoved: compensated ? undefined : apiError.leftMoved,
              requestId,
            })
            return
          }
          if (apiError.code === MIGRATION_ERROR_CODES.renumberTargetMissing) {
            setError({
              title: 'Alguna base quedaría en una versión inexistente',
              text: 'Tras el renumerado, la migración en la que está parada esa base pasaría a llamarse de otra forma, pero ese nombre no figura en su historial: no hay a dónde mover el puntero. El blueprint NO se modificó. Revisa el historial de esas bases (les puede faltar aplicar migraciones) antes de reintentar.',
              replan: true,
              unstampable: apiError.unstampableDatabases,
              requestId,
            })
            return
          }
          if (apiError.code === MIGRATION_ERROR_CODES.affectedPartialApplication) {
            setError({
              title: 'Hay una aplicación a medio camino que este borrado afectaría',
              // Este 409 NO trae contexto propio en el contrato: lo único accionable que tenemos
              // son las filas que el propio plan ya listó. Si el plan tampoco las traía, se enlaza
              // a la pestaña de estado del blueprint, que es donde se ve qué base quedó a medias.
              // Inventar un id para poder pintar un enlace sería peor que ofrecer el listado.
              text: 'Una base quedó a mitad de aplicar una versión y el borrado la dejaría con un checkpoint que ya no describe nada. Reconcilia esa aplicación parcial (o termina el apply) y vuelve a intentarlo.',
              replan: true,
              partialApplications: plan.partial_applications,
              requestId,
            })
            return
          }

          setError({
            title: 'No se pudo eliminar la versión',
            text: apiError.message,
            replan: false,
            requestId,
          })
        },
      },
    )
  }

  const title =
    step === 'result'
      ? `Versión ${version} eliminada`
      : !plan.deletable
        ? `No se puede eliminar la versión ${version}`
        : plan.requires_confirmation
          ? `Eliminar la versión ${version} — escribe en el motor 🔌`
          : `Eliminar la versión ${version}`

  const countdownLabel = tokenAlive
    ? `La confirmación caduca en ${formatCountdown(remaining)}.`
    : 'La confirmación caducó.'

  return (
    <Modal
      open
      onClose={step === 'result' ? onDeleted : onClose}
      title={title}
      size="lg"
      footer={
        step === 'result' ? (
          <div className="flex justify-end">
            <Button onClick={onDeleted}>Volver al blueprint</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            {needsToken && <span className="text-xs text-muted-foreground">{countdownLabel}</span>}
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="ghost" onClick={onClose} disabled={deleteMigration.isPending}>
                Cancelar
              </Button>
              <Button variant="outline" isLoading={deletePlan.isPending} onClick={replan}>
                Volver a comprobar
              </Button>
              {/* Sin `deletable` NO hay botón de borrar, en ningún caso: un botón deshabilitado
                  sugeriría que hay una forma de habilitarlo desde aquí, y no la hay. */}
              {plan.deletable && (
                <Button
                  variant="danger"
                  disabled={!canSubmit}
                  isLoading={deleteMigration.isPending}
                  onClick={submit}
                >
                  {needsToken
                    ? `Eliminar ${version} y mover los punteros 🔌`
                    : `Eliminar la versión ${version}`}
                </Button>
              )}
            </div>
          </div>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-lg border border-error/40 bg-error/5 p-3 text-sm"
          >
            <p className="font-semibold text-error">{error.title}</p>
            <p className="text-muted-foreground">{error.text}</p>

            {error.blocking && error.blocking.length > 0 && (
              <BlockingDatabasesList
                modelId={modelId}
                rows={error.blocking}
                requestId={error.requestId}
              />
            )}
            {error.stampPlan && error.stampPlan.length > 0 && (
              <StampPlanList rows={error.stampPlan} />
            )}
            {error.leftMoved && error.leftMoved.length > 0 && (
              <LeftMovedList rows={error.leftMoved} />
            )}
            {error.unstampable && error.unstampable.length > 0 && (
              <UnstampableList rows={error.unstampable} />
            )}
            {error.partialApplications && (
              <PartialApplicationsList modelId={modelId} rows={error.partialApplications} />
            )}

            {error.replan && (
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  isLoading={deletePlan.isPending}
                  onClick={replan}
                >
                  Volver a comprobar el plan
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ── a) No se puede borrar ─────────────────────────────────────────────────────── */}
        {step === 'plan' && !plan.deletable && (
          <>
            <p className="text-sm text-muted-foreground">
              El plan se comprobó contra las bases de datos reales y esta versión no se puede
              eliminar ahora mismo. Cada motivo de abajo tiene su propia salida.
            </p>

            {plan.blockers.length > 0 && (
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-foreground">
                  Bases paradas en esta versión, o que no se pudieron leer
                </h3>
                <p className="text-xs text-muted-foreground">
                  Mueve las que estén exactamente aquí con un apply o un rollback. Las que no se
                  pudieron leer no son un permiso a forzar: el gateway no puede distinguir «ya no la
                  tiene» de «no pude comprobarlo», así que las cuenta como bloqueantes.
                </p>
                <BlockingDatabasesList modelId={modelId} rows={plan.blockers} />
              </section>
            )}

            {plan.unstampable.length > 0 && (
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-foreground">
                  Bases que quedarían en una etiqueta que no existe
                </h3>
                <p className="text-xs text-muted-foreground">
                  Al borrar esta versión, las posteriores bajan un escalón y cambian de número. Las
                  bases de abajo están paradas en una migración cuyo número nuevo no figura en su
                  historial: se abriría un hueco en la numeración y su puntero no tendría a dónde
                  ir. Revisa su historial —lo habitual es que les falte aplicar migraciones— antes
                  de volver a intentarlo.
                </p>
                <UnstampableList rows={plan.unstampable} />
              </section>
            )}

            {plan.partial_applications.length > 0 && (
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-foreground">
                  Bases con una aplicación a medio camino
                </h3>
                <p className="text-xs text-muted-foreground">
                  Quedaron a mitad de aplicar una versión. Borrar ahora las dejaría con un
                  checkpoint que ya no describe nada: reconcilia esa aplicación parcial o termina el
                  apply antes de eliminar.
                </p>
                <PartialApplicationsList modelId={modelId} rows={plan.partial_applications} />
              </section>
            )}

            {/* Los avisos del backend se pintan también cuando el plan está bloqueado: son suyos
                y pueden decir algo que ninguna de las tres listas cubre. Ocultarlos por estar en
                la rama del «no» sería decidir por el operador qué parte del contrato lee. */}
            {plan.warnings.length > 0 && <WarningsCallout warnings={plan.warnings} />}
          </>
        )}

        {/* ── b) Borrado directo, sin token ─────────────────────────────────────────────── */}
        {step === 'plan' && plan.deletable && !plan.requires_confirmation && (
          <>
            <p className="text-sm text-muted-foreground">
              Ninguna base de datos hay que tocar para esto: el borrado solo cambia la cadena de
              versiones del blueprint, no ejecuta nada en ningún motor y no revierte nada de lo que
              ya se aplicó.
            </p>

            {plan.warnings.length > 0 && <WarningsCallout warnings={plan.warnings} />}

            {plan.renumber.length > 0 && <RenumberSection rows={plan.renumber} />}

            <VersionConfirmInput
              version={version}
              value={versionInput}
              onChange={setVersionInput}
            />
          </>
        )}

        {/* ── c) Borrado que ESCRIBE en bases reales ────────────────────────────────────── */}
        {step === 'plan' && plan.deletable && plan.requires_confirmation && (
          <>
            {/* 1 — Los avisos del plan, tal cual vienen y arriba de todo. El primero dice que las
                bases conservan FÍSICAMENTE los objetos y que esto no los revierte: es la
                consecuencia que hay que entender antes de confirmar, y resumirla es perderla. */}
            {plan.warnings.length > 0 && <WarningsCallout warnings={plan.warnings} />}

            <Callout tone="danger" title="Esto NO es un rollback y no ejecuta ningún SQL">
              <p>
                Las bases que ya aplicaron esta versión conservan{' '}
                <strong className="text-foreground">físicamente</strong> las tablas, columnas e
                índices que creó. El borrado no las revierte: lo único que pasa es que la cadena del
                blueprint deja de describirlas. Para deshacer esos objetos hace falta un rollback o
                una versión compensatoria, que son operaciones aparte.
              </p>
            </Callout>

            {/* 2 — El renumerado: metadata del blueprint, ninguna base se toca por esto. */}
            {plan.renumber.length > 0 && <RenumberSection rows={plan.renumber} />}

            {/* 3 — Los stamps: esto SÍ toca el motor, y por eso va separado del renumerado. */}
            {plan.stamp_plan.length > 0 && (
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-foreground">
                  Se va a escribir en estas {plan.stamp_plan.length} base(s) 🔌
                </h3>
                <p className="text-xs text-muted-foreground">
                  Cada una es una <strong className="text-foreground">escritura remota</strong> en
                  el motor destino: el gateway abre conexión, toma un lock y actualiza la tabla de
                  versión de esa base. No es una operación local.{' '}
                  <strong className="text-foreground">
                    Ninguna de estas bases retrocede de esquema
                  </strong>
                  : siguen exactamente la misma migración, que tras el renumerado pasa a llamarse de
                  otra forma. Es un renombre, no un rollback.
                </p>
                <StampPlanList rows={plan.stamp_plan} />
              </section>
            )}

            {/* 4 — Reconocimiento explícito + reescritura de la versión. */}
            <label className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span className="text-muted-foreground">
                Entiendo que esto escribe en {plan.stamp_plan.length} base(s) de datos real(es), que
                las bases que ya aplicaron la versión {version} conservan sus objetos y que el
                borrado no los revierte.
              </span>
            </label>

            <VersionConfirmInput
              version={version}
              value={versionInput}
              onChange={setVersionInput}
            />

            {/* 5 — Al caducar no se re-planifica solo: la lista de bases pudo cambiar y hay que
                volver a verla. El botón de confirmar ya está deshabilitado por `tokenAlive`. */}
            {!tokenAlive && (
              <Callout
                tone="warning"
                title="La autorización de este plan caducó"
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    isLoading={deletePlan.isPending}
                    onClick={replan}
                  >
                    Volver a comprobar
                  </Button>
                }
              >
                <p>
                  Vale unos dos minutos. Vuelve a comprobar el plan: si mientras tanto alguna base
                  se movió, la lista de escrituras va a ser otra y habrá que reconocerla de nuevo.
                </p>
              </Callout>
            )}
          </>
        )}

        {/* ── Resultado ─────────────────────────────────────────────────────────────────── */}
        {step === 'result' && (
          <>
            <Callout tone="success" title={`La versión ${version} ya no está en el blueprint`}>
              <p>
                Se pinta lo que se ejecutó, no lo que se había planeado: entre la comprobación y el
                borrado pudieron pasar hasta dos minutos y el resultado puede diferir del plan.
              </p>
            </Callout>

            {result === null ? (
              // Un gateway anterior a v18 responde sin cuerpo útil. La operación se hizo; lo que
              // no tenemos es el desglose. Decirlo es mejor que pintar dos listas vacías, que se
              // leerían como «no se renumeró nada y no se tocó ninguna base».
              <p className="text-sm text-muted-foreground">
                El servidor no devolvió el detalle de lo ejecutado. Revisa el catálogo de versiones
                para ver cómo quedó la numeración.
              </p>
            ) : (
              <>
                {result.renumbered.length > 0 && <RenumberSection rows={result.renumbered} done />}

                {result.stamped.length > 0 && (
                  <section className="flex flex-col gap-2">
                    <h3 className="text-sm font-semibold text-foreground">
                      Se escribió en estas {result.stamped.length} base(s)
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Su puntero de versión se movió a la etiqueta nueva de la misma migración. No
                      cambió su esquema.
                    </p>
                    <StampPlanList rows={result.stamped} />
                  </section>
                )}

                {result.renumbered.length === 0 && result.stamped.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No hubo que renumerar ninguna versión ni mover ningún puntero.
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

/** Los `warnings[]` del plan, **sin resumir y en su orden**: son texto del contrato. */
function WarningsCallout({ warnings }: { warnings: string[] }) {
  return (
    <Callout tone="warning" title="Antes de continuar, lee esto">
      <ul className="flex list-disc flex-col gap-1 pl-5">
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </Callout>
  )
}

/**
 * El renumerado del blueprint. Va SIEMPRE separado de los stamps aunque las dos listas se vean
 * parecidas: esto es metadata y no toca ningún motor, y mezclarlas haría que un renombre inocuo
 * se lea como una escritura remota.
 */
function RenumberSection({
  rows,
  done = false,
}: {
  rows: MigrationRenumberStep[]
  done?: boolean
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-foreground">
        {done
          ? `${rows.length} versión(es) cambiaron de número`
          : `${rows.length} versión(es) posteriores bajan un escalón`}
      </h3>
      <p className="text-xs text-muted-foreground">
        Solo cambia su <strong className="text-foreground">número</strong>: su SQL, su nombre y su
        checksum siguen siendo los mismos. Las versiones anteriores a la borrada no se tocan.
      </p>
      <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
        {rows.map((row) => (
          <li
            key={`${row.from_version}-${row.to_version}`}
            className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm"
          >
            <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">
              {row.from_version}
            </code>
            <span className="text-muted-foreground">→</span>
            <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">{row.to_version}</code>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Punteros que se van a mover —o que se movieron— en bases reales. */
function StampPlanList({ rows }: { rows: MigrationStampStep[] }) {
  return (
    <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
      {rows.map((row) => (
        <li
          key={row.managed_database_id}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm"
        >
          <span className="font-medium text-foreground">{labelOf(row)}</span>
          {row.database_name && (
            <span className="text-xs text-muted-foreground">#{row.managed_database_id}</span>
          )}
          <span className="ml-auto flex items-center gap-2 text-xs">
            <code className="rounded bg-surface-muted px-1.5 py-0.5">{row.from_version}</code>
            <span className="text-muted-foreground">→</span>
            <code className="rounded bg-surface-muted px-1.5 py-0.5">{row.to_version}</code>
          </span>
          <Link
            to={`/managed-databases/${row.managed_database_id}/migrations`}
            className="rounded-md px-2 py-1 text-xs text-primary hover:bg-primary/10"
          >
            Ver la base →
          </Link>
        </li>
      ))}
    </ul>
  )
}

/**
 * Las bases que quedaron MAL MARCADAS tras un `renumber_stamp_failed` sin compensar.
 *
 * No es el plan completo ni las que salieron bien: son solo las que hay que arreglar a mano. Por
 * eso lleva su propio texto en vez de reusar `StampPlanList` — la misma lista con otro significado
 * es exactamente la confusión que hace que nadie corrija nada.
 */
function LeftMovedList({ rows }: { rows: MigrationStampStep[] }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Cada una necesita un <strong className="text-foreground">stamp manual</strong> que la
        devuelva a su versión de origen antes de volver a intentar el borrado.
      </p>
      <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
        {rows.map((row) => (
          <li
            key={row.managed_database_id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-error/40 p-3 text-sm"
          >
            <span className="font-medium text-foreground">{labelOf(row)}</span>
            <span className="text-xs text-muted-foreground">
              debería estar en <code>{row.from_version}</code> y quedó marcada en{' '}
              <code>{row.to_version}</code>
            </span>
            <Link
              to={`/managed-databases/${row.managed_database_id}/migrations`}
              className="ml-auto rounded-md px-2 py-1 text-xs text-primary hover:bg-primary/10"
            >
              Corregir la base →
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Bases cuyo puntero no se puede mover porque el destino no existe en su historial. */
function UnstampableList({ rows }: { rows: MigrationUnstampableDatabase[] }) {
  return (
    <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
      {rows.map((row) => (
        <li
          key={row.managed_database_id}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm"
        >
          <span className="font-medium text-foreground">{labelOf(row)}</span>
          <span className="text-xs text-muted-foreground">
            está en <code>{row.current_version}</code> y habría que moverla a{' '}
            <code>{row.missing_target}</code>, que no figura en su historial
          </span>
          <Link
            to={`/managed-databases/${row.managed_database_id}/migrations`}
            className="ml-auto rounded-md px-2 py-1 text-xs text-primary hover:bg-primary/10"
          >
            Ver su historial →
          </Link>
        </li>
      ))}
    </ul>
  )
}

/**
 * Bases con una aplicación parcial que el borrado afectaría. Cada fila enlaza a la reconciliación
 * de esa BD, que es la única salida de este bloqueo.
 *
 * Con la lista vacía enlaza a la pestaña de estado del blueprint: el 409
 * `affected_partial_application` no trae contexto propio, así que puede llegar sin ninguna fila
 * que nombrar, y dejar al operador sin ningún sitio a donde ir sería peor que ofrecerle el
 * listado desde el que va a encontrarla.
 */
function PartialApplicationsList({
  modelId,
  rows,
}: {
  modelId: number
  rows: MigrationAffectedPartialApplication[]
}) {
  if (rows.length === 0) {
    return (
      <Link
        to={`/database-models/${modelId}/migrations?tab=estado`}
        className="text-xs text-primary hover:underline"
      >
        Ver el estado de las bases de este blueprint →
      </Link>
    )
  }

  return (
    <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
      {rows.map((row) => (
        <li
          key={row.managed_database_id}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm"
        >
          <span className="font-medium text-foreground">{labelOf(row)}</span>
          <span className="text-xs text-muted-foreground">
            {row.version ? `versión ${row.version}` : 'con aplicación parcial'}
            {row.last_statement_index !== undefined && row.total_statements !== undefined
              ? `, quedó en la sentencia ${row.last_statement_index} de ${row.total_statements}`
              : ''}
          </span>
          <Link
            to={`/managed-databases/${row.managed_database_id}/migrations`}
            className="ml-auto rounded-md px-2 py-1 text-xs text-primary hover:bg-primary/10"
          >
            Reconciliar →
          </Link>
        </li>
      ))}
    </ul>
  )
}

/**
 * Reescritura del número de versión, el mismo molde `confirm_target_name` que el resto de la app
 * usa para lo irreversible.
 *
 * No se autocompleta a propósito: el backend solo comprueba igualdad, así que rellenarlo lo
 * convertiría en un campo decorativo y dejaría la puerta abierta a borrar la versión equivocada
 * desde una pestaña vieja.
 */
function VersionConfirmInput({
  version,
  value,
  onChange,
}: {
  version: string
  value: string
  onChange: (next: string) => void
}) {
  return (
    <Input
      label="Escribe el número de versión para confirmar que es la que quieres eliminar"
      hint={`Versión a eliminar: ${version}`}
      value={value}
      error={value !== '' && value !== version ? `Debe ser exactamente «${version}».` : undefined}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}
