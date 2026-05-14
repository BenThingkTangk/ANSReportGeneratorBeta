import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { ThemeProvider } from "next-themes";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/dashboard";
import NotFound from "@/pages/not-found";

// Admin pages
import AdminLoginPage from "@/pages/admin/login";
import KnowledgePage from "@/pages/admin/knowledge";
import KnowledgeDetailPage from "@/pages/admin/knowledge/[id]";
import NewKnowledgePage from "@/pages/admin/knowledge/new";
import KnowledgeUploadPage from "@/pages/admin/knowledge/upload";
import ChangeRequestsPage from "@/pages/admin/change-requests";
import ChangeRequestDetailPage from "@/pages/admin/change-requests/[id]";
import NewChangeRequestPage from "@/pages/admin/change-requests/new";
import AuditPage from "@/pages/admin/audit";

function AppRouter() {
  return (
    <Switch>
      {/* Patient / clinician routes — UNCHANGED */}
      <Route path="/" component={Dashboard} />

      {/* Admin routes */}
      <Route path="/admin/login" component={AdminLoginPage} />
      <Route path="/admin/knowledge/new" component={NewKnowledgePage} />
      <Route path="/admin/knowledge/upload" component={KnowledgeUploadPage} />
      <Route path="/admin/knowledge/:id" component={KnowledgeDetailPage} />
      <Route path="/admin/knowledge" component={KnowledgePage} />
      <Route path="/admin/change-requests/new" component={NewChangeRequestPage} />
      <Route path="/admin/change-requests/:id" component={ChangeRequestDetailPage} />
      <Route path="/admin/change-requests" component={ChangeRequestsPage} />
      <Route path="/admin/audit" component={AuditPage} />
      {/* /admin redirect */}
      <Route path="/admin">
        {() => { window.location.hash = "#/admin/knowledge"; return null; }}
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      themes={["light", "dark"]}
      storageKey="humanos-theme"
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Router hook={useHashLocation}>
            <AppRouter />
          </Router>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
