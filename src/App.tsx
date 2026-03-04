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
import ImportacaoSucesso from "./pages/processos/ImportacaoSucesso";
import ClientesList from "./pages/clientes/ClientesList";
import ClienteDetail from "./pages/clientes/ClienteDetail";
import Atendimento from "./pages/atendimento/Atendimento";
import Configuracoes from "./pages/configuracoes/Configuracoes";
import AdminDashboard from "./pages/dashboard/AdminDashboard";
import CadastroAdvogado from "./pages/CadastroAdvogado";
import AceitarConvite from "./pages/convite/AceitarConvite";
import VincularWhatsApp from "./pages/vinculacao/VincularWhatsApp";
import NotFound from "./pages/NotFound";
import Planos from './pages/Planos';
import Checkout from './pages/Checkout';
import CheckoutSuccess from './pages/CheckoutSuccess';
import CampanhasList from './pages/campanhas/CampanhasList';

const queryClient = new QueryClient();

function AppRoutes() {
  const { isAuthenticated, loading } = useAuth();

  return (
    <Routes>
      <Route
        path="/"
        element={
          loading ? (
            <div className="min-h-screen flex items-center justify-center">
              <div className="h-8 w-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
            </div>
          ) : isAuthenticated ? (
            <Navigate to="/dashboard" replace />
          ) : (
            <Index />
          )
        }
      />
      <Route path="/login" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/cadastro/advogado" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <CadastroAdvogado />} />
      <Route path="/convite/:token" element={<AceitarConvite />} />
      <Route path="/vincular" element={<VincularWhatsApp />} />
      <Route path="/planos" element={<Planos />} />
      <Route path="/Checkout" element={<Navigate to="/checkout" replace />} />
      <Route path="/checkout" element={<Checkout />} />
      <Route path="/checkout/sucesso" element={<CheckoutSuccess />} />

      {/* Protected app routes */}
      <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/processos" element={<ProtectedRoute allowedRoles={['advogado', 'admin']}><ProcessosList /></ProtectedRoute>} />
        <Route path="/processos/:id" element={<ProcessoDetail />} />
        <Route path="/processos/importacao-sucesso/:id" element={<ProtectedRoute allowedRoles={['advogado', 'admin']}><ImportacaoSucesso /></ProtectedRoute>} />
        <Route path="/clientes" element={<ProtectedRoute allowedRoles={['advogado', 'admin']}><ClientesList /></ProtectedRoute>} />
        <Route path="/clientes/:id" element={<ProtectedRoute allowedRoles={['advogado', 'admin']}><ClienteDetail /></ProtectedRoute>} />
        <Route path="/atendimento" element={<ProtectedRoute allowedRoles={['advogado', 'admin']}><Atendimento /></ProtectedRoute>} />
        <Route path="/campanhas" element={<ProtectedRoute allowedRoles={['advogado', 'admin']}><CampanhasList /></ProtectedRoute>} />
        <Route path="/configuracoes" element={<ProtectedRoute allowedRoles={['advogado', 'admin']}><Configuracoes /></ProtectedRoute>} />

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
