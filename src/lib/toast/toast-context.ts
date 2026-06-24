import { createContext } from 'react'

export type ToastVariant = 'success' | 'error' | 'info' | 'warning'

export interface Toast {
  id: string
  variant: ToastVariant
  title: string
  description?: string
}

export interface ToastInput {
  variant?: ToastVariant
  title: string
  description?: string
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
