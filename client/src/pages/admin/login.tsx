/**
 * /admin/login — admin username/password sign-in.
 *
 * The app routes /admin/login to components/AdminGatewayLoginPage.tsx (see
 * App.tsx). This module re-exports that same polished username/password form so
 * there is a single source of truth and no stale magic-link UI remains here.
 */
export { default } from "@/components/AdminGatewayLoginPage";
