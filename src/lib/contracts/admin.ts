import { z } from 'zod'

/** Administración del cifrado de credenciales (§12). Opera sobre la BD de metadatos. */

/** `CryptoRotationOut` — resultado de rotar la DEK y re-cifrar credenciales (§12). */
export const cryptoRotationOutSchema = z.object({
  servers_reencrypted: z.number().int(),
  server_users_reencrypted: z.number().int(),
})
export type CryptoRotationOut = z.infer<typeof cryptoRotationOutSchema>
