import { useAuth } from '@/contexts/AuthContext';
import AdvogadoDashboard from './dashboard/AdvogadoDashboard';
import ClienteDashboard from './dashboard/ClienteDashboard';
import AdminDashboard from './dashboard/AdminDashboard';

export default function Dashboard() {
  const { user } = useAuth();

  if (user?.role === 'cliente') return <ClienteDashboard />;
  if (user?.role === 'admin') return <AdminDashboard />;
  return <AdvogadoDashboard />;
}
