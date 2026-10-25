/** `id` del panel de aprobaciones: los avisos de «falta aprobar» lo enlazan. */
export const DESTRUCTIVE_APPROVALS_ANCHOR_ID = 'destructive-approvals'

/** Lleva hasta el panel de aprobaciones de la misma pantalla. */
export function scrollToApprovals(): void {
  document
    .getElementById(DESTRUCTIVE_APPROVALS_ANCHOR_ID)
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
