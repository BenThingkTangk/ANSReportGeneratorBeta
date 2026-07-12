import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { ThemeProvider } from "next-themes";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/dashboard";
import NotFound from "@/pages/not-found";
import { BuildInfo } from "@/components/BuildInfo";

// Admin pages
// NOTE: the two-step (perimeter gateway → magic-link) login lives in
// components/AdminGatewayLoginPage.tsx because pages/admin/login.tsx is
// read-only in this environment. Same route, superset behaviour.
import AdminLoginPage from "@/components/AdminGatewayLoginPage";
import KnowledgePage from "@/pages/admin/knowledge";
import KnowledgeDetailPage from "@/pages/admin/knowledge/[id]";
import NewKnowledgePage from "@/pages/admin/knowledge/new";
import KnowledgeUploadPage from "@/pages/admin/knowledge/upload";
import ChangeRequestsPage from "@/pages/admin/change-requests";
import ChangeRequestDetailPage from "@/pages/admin/change-requests/[id]";
import NewChangeRequestPage from "@/pages/admin/change-requests/new";
import AuditPage from "@/pages/admin/audit";
import AccuracyLabPage from "@/pages/admin/accuracy-lab";
import RuleEvidencePage from "@/pages/admin/rule-evidence";
import RetrievalTestPage from "@/pages/admin/retrieval-test";
import ParserHealthPage from "@/pages/admin/parser-health";

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
      <Route path="/admin/accuracy-lab" component={AccuracyLabPage} />
      <Route path="/admin/rule-evidence" component={RuleEvidencePage} />
      <Route path="/admin/retrieval-test" component={RetrievalTestPage} />
      <Route path="/admin/parser-health" component={ParserHealthPage} />
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
          <BuildInfo />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
