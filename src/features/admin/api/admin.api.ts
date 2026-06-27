import { mutateData } from '@/lib/api/client'
import { cryptoRotationOutSchema, type CryptoRotationOut } from '@/lib/contracts'

/**
 * `POST /admin/crypto/rotate` — rota la DEK y re-cifra todas las credenciales sin cambiar
 * `SECRET_KEY` ni reiniciar la app (§12). Opera sobre la BD de metadatos.
 */
export function rotateCrypto(): Promise<CryptoRotationOut> {
  return mutateData('POST', '/admin/crypto/rotate', cryptoRotationOutSchema)
}
