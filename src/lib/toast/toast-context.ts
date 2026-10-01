import { createContext } from 'react'

export type ToastVariant = 'success' | 'error' | 'info' | 'warning'

/**
 * Enlace de salida del aviso. Es un `<a>` común y no un `<Link>`: el proveedor de toasts vive
 * fuera del router. Recargar al seguirlo es además lo que corresponde para «Ver mi acceso»: trae un
 * `/auth/me` fresco si a la persona le cambiaron los permisos hace poco.
 */
export interface ToastAction {
  label: string
  href: string
}

export interface Toast {
  id: string
  variant: ToastVariant
  title: string
  description?: string
  action?: ToastAction
}

export interface ToastInput {
  variant?: ToastVariant
  title: string
  description?: string
  action?: ToastAction
  /** Milisegundos antes del auto-cierre; 0 = persistente. */
  duration?: number
}

export interface ToastContextValue {
  toasts: Toast[]
  push: (input: ToastInput) => string
  dismiss: (id: string) => void
  /** Atajos por variante. */
  success: (title: string, description?: string) => string
  error: (title: string, description?: string) => string
}

export const ToastContext = createContext<ToastContextValue | null>(null)
