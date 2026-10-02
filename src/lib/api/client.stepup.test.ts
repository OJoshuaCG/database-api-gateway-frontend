import { afterEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { z } from 'zod'
import { server } from '@/test/server'
import { AUTH_STEP_UP_ERROR_CODES } from '@/lib/contracts'
import { fetchBlob, mutateData, setStepUpHandler, setUnauthorizedHandler } from './client'
import { ApiError } from './errors'

/**
 * El step-up vive en `runRequest`, el único punto por el que pasa toda request. Estas pruebas fijan
 * sus cuatro garantías: reenvía UNA vez tras confirmar, cancelar devuelve el 403 original, varios
 * 403 en paralelo abren UN solo pedido, y nunca entra en bucle.
 */

const URL = 'http://localhost/api/v1/operacion'
const schema = z.object({ ok: z.boolean() })

const stepUpRequired = () =>
  HttpResponse.json(
    {
      detail: {
        msg: 'Confirmá tu contraseña.',
        public_context: { code: AUTH_STEP_UP_ERROR_CODES.required, step_up_ttl_seconds: 300 },
      },
    },
    { status: 403 },
  )

/** Responde 403 de step-up las primeras `failures` veces y 200 después. Cuenta los envíos. */
function serveStepUp(failures: number) {
  const calls = { count: 0 }
  server.use(
    http.post(URL, () => {
      calls.count += 1
      return calls.count <= failures ? stepUpRequired() : HttpResponse.json({ data: { ok: true } })
    }),
  )
  return calls
}

afterEach(() => {
  setStepUpHandler(null)
  setUnauthorizedHandler(null)
})

describe('step-up en runRequest', () => {
  it('pide la contraseña y reenvía el request UNA vez', async () => {
    const calls = serveStepUp(1)
    const handler = vi.fn(() => Promise.resolve(true))
    setStepUpHandler(handler)

    await expect(mutateData('POST', '/operacion', schema, { body: {} })).resolves.toEqual({
      ok: true,
    })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(calls.count).toBe(2)
  })

  it('al cancelar devuelve el 403 ORIGINAL y no reenvía', async () => {
    const calls = serveStepUp(1)
    setStepUpHandler(() => Promise.resolve(false))

    const error = await mutateData('POST', '/operacion', schema, { body: {} }).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe(AUTH_STEP_UP_ERROR_CODES.required)
    expect((error as ApiError).stepUpTtlSeconds).toBe(300)
    expect(calls.count).toBe(1)
  })

  it('un segundo 403 sale como error, sin volver a preguntar (no hay bucle)', async () => {
    const calls = serveStepUp(Number.POSITIVE_INFINITY)
    const handler = vi.fn(() => Promise.resolve(true))
    setStepUpHandler(handler)

    await expect(mutateData('POST', '/operacion', schema, { body: {} })).rejects.toMatchObject({
      status: 403,
      code: AUTH_STEP_UP_ERROR_CODES.required,
    })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(calls.count).toBe(2)
  })

  it('varios 403 en paralelo comparten UN solo pedido de contraseña', async () => {
    let first = true
    server.use(
      http.post(URL, () => {
        // Los dos primeros envíos (uno por request) dan 403; los reenvíos, 200.
        return first ? stepUpRequired() : HttpResponse.json({ data: { ok: true } })
      }),
    )
    let confirm: (ok: boolean) => void = () => undefined
    const handler = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          confirm = resolve
        }),
    )
    setStepUpHandler(handler)

    const a = mutateData('POST', '/operacion', schema, { body: {} })
    const b = mutateData('POST', '/operacion', schema, { body: {} })
    await vi.waitFor(() => expect(handler).toHaveBeenCalled())
    // Esperar a que el segundo 403 también llegue antes de confirmar.
    await new Promise((resolve) => setTimeout(resolve, 20))
    first = false
    confirm(true)

    await expect(Promise.all([a, b])).resolves.toEqual([{ ok: true }, { ok: true }])
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('con `suppressStepUp` devuelve el 403 sin preguntar', async () => {
    const calls = serveStepUp(1)
    const handler = vi.fn(() => Promise.resolve(true))
    setStepUpHandler(handler)

    await expect(
      mutateData('POST', '/operacion', schema, { body: {}, suppressStepUp: true }),
    ).rejects.toMatchObject({ code: AUTH_STEP_UP_ERROR_CODES.required })
    expect(handler).not.toHaveBeenCalled()
    expect(calls.count).toBe(1)
  })

  it('sin nadie registrado devuelve el 403 tal cual', async () => {
    const calls = serveStepUp(1)
    await expect(mutateData('POST', '/operacion', schema, { body: {} })).rejects.toMatchObject({
      code: AUTH_STEP_UP_ERROR_CODES.required,
    })
    expect(calls.count).toBe(1)
  })

  it('también cubre las descargas (`fetchBlob`)', async () => {
    let count = 0
    server.use(
      http.get('http://localhost/api/v1/descarga', () => {
        count += 1
        return count === 1 ? stepUpRequired() : HttpResponse.text('SELECT 1;')
      }),
    )
    setStepUpHandler(() => Promise.resolve(true))

    const { blob } = await fetchBlob('/descarga')
    await expect(blob.text()).resolves.toBe('SELECT 1;')
    expect(count).toBe(2)
  })

  it('un 403 de otro código no pide contraseña', async () => {
    server.use(
      http.post(URL, () =>
        HttpResponse.json(
          { detail: { msg: 'No.', public_context: { code: 'access.forbidden' } } },
          { status: 403 },
        ),
      ),
    )
    const handler = vi.fn(() => Promise.resolve(true))
    setStepUpHandler(handler)

    await expect(mutateData('POST', '/operacion', schema, { body: {} })).rejects.toMatchObject({
      code: 'access.forbidden',
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('el 400 `auth.step_up_failed` NO cierra la sesión', async () => {
    server.use(
      http.post('http://localhost/api/v1/auth/step-up', () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'Contraseña incorrecta.',
              public_context: { code: AUTH_STEP_UP_ERROR_CODES.failed, attempts_remaining: 3 },
            },
          },
          { status: 400 },
        ),
      ),
    )
    const unauthorized = vi.fn()
    setUnauthorizedHandler(unauthorized)

    await expect(
      mutateData('POST', '/auth/step-up', schema, {
        body: { password: 'x' },
        suppressStepUp: true,
      }),
    ).rejects.toMatchObject({ status: 400, attemptsRemaining: 3 })
    expect(unauthorized).not.toHaveBeenCalled()
  })
})
