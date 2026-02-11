import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/layout/AppLayout";
import Index from "./pages/Index";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import ProcessosList from "./pages/processos/ProcessosList";
import ProcessoDetail from "./pages/processos/ProcessoDetail";
import ClientesList from "./pages/clientes/ClientesList";
import Atendimento from "./pages/atendimento/Atendimento";
import Configuracoes from "./pages/configuracoes/Configuracoes";
import AdminDashboard from "./pages/dashboard/AdminDashboard";
import CadastroAdvogado from "./pages/CadastroAdvogado";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function AppRoutes() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
      </div>
    );
  }
  return (
    <Routes>
      <Route path="/" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Index />} />
      <Route path="/login" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/cadastro/advogado" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <CadastroAdvogado />} />

      {/* Protected app routes */}
      <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/processos" element={<ProcessosList />} />
        <Route path="/processos/:id" element={<ProcessoDetail />} />
        <Route path="/clientes" element={<ClientesList />} />
        <Route path="/atendimento" element={<Atendimento />} />
        <Route path="/configuracoes" element={<Configuracoes />} />

        {/* Admin routes */}
        <Route path="/admin/advogados" element={<ProtectedRoute allowedRoles={['admin']}><AdminDashboard /></ProtectedRoute>} />
        <Route path="/admin/usuarios" element={<ProtectedRoute allowedRoles={['admin']}><AdminDashboard /></ProtectedRoute>} />
        <Route path="/admin/monitoramento" element={<ProtectedRoute allowedRoles={['admin']}><AdminDashboard /></ProtectedRoute>} />
        <Route path="/admin/integracoes" element={<ProtectedRoute allowedRoles={['admin']}><AdminDashboard /></ProtectedRoute>} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
