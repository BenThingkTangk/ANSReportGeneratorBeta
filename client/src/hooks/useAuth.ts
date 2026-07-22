/**
 * client/src/hooks/useAuth.ts
 *
 * Admin auth is now backed by a SHARED React context (see AuthProvider.tsx) so
 * a successful sign-in updates every consumer synchronously and authenticated
 * content renders immediately — no reload. This module re-exports the hook and
 * types so all existing `@/hooks/useAuth` imports keep working unchanged.
 */
export { useAuth, AuthProvider } from "./AuthProvider";
export type { UseAuthReturn, AuthState, AdminSessionMarker, UserRole } from "./AuthProvider";
