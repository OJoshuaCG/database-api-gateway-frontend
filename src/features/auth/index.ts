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
export {
  capabilityHint,
  useCapabilityGuard,
  type CapabilityGuard,
  type CapabilityGuardOptions,
} from './hooks/use-capability-guard'
export { CapabilityHint } from './components/CapabilityHint'
export { ForbiddenState } from './components/ForbiddenState'
export {
  MY_ACCESS_PATH,
  csrfErrorCopy,
  forbiddenCopy,
  isAccessForbidden,
  isCsrfError,
  sessionEndReason,
  type ForbiddenCopy,
  type SessionEndReason,
} from './messages'
export { useLogin } from './hooks/use-login'
export { useLogout } from './hooks/use-logout'
export * from './authz-model'
export { CapabilityFlags } from './components/CapabilityFlags'
export { CAPABILITY_FLAG_LEGEND, CAPABILITY_FLAGS, capabilityFlagKeys } from './capability-flags'
export { RoleCapabilitySummary, ROLES_MATRIX_PATH } from './components/RoleCapabilitySummary'
export { EffectiveAccessPanel, type EffectiveAccessGrant } from './components/EffectiveAccessPanel'
