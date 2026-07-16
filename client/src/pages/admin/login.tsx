/**
 * /admin/login — admin sign-in.
 *
 * The former Supabase magic-link email flow has been retired. The sole admin
 * entry point is the env-configured gateway (username + password), implemented
 * in AdminGatewayLoginPage. This module re-exports that page so any lingering
 * import of pages/admin/login continues to render the correct credential form.
 */
export { default } from "@/components/AdminGatewayLoginPage";
