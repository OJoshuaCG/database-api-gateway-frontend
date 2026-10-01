export { LoginPage } from './pages/LoginPage'
export { ProtectedRoute } from './components/ProtectedRoute'
export { SessionProvider } from './SessionProvider'
export { SessionsPanel } from './components/SessionsPanel'
export { useSession } from './hooks/use-session'
export {
  useCapabilities,
  useCapabilityCatalog,
  useScopeReadiness,
  type Capabilities,
} from './hooks/use-capabilities'
export { useCapabilityGuard, type CapabilityGuard } from './hooks/use-capability-guard'
export { csrfErrorCopy, isCsrfError, sessionEndReason, type SessionEndReason } from './messages'
export { useLogin } from './hooks/use-login'
export { useLogout } from './hooks/use-logout'
export * from './authz-model'
export { CapabilityFlags } from './components/CapabilityFlags'
export { CAPABILITY_FLAG_LEGEND, CAPABILITY_FLAGS, capabilityFlagKeys } from './capability-flags'
export { RoleCapabilitySummary, ROLES_MATRIX_PATH } from './components/RoleCapabilitySummary'
export { EffectiveAccessPanel, type EffectiveAccessGrant } from './components/EffectiveAccessPanel'
