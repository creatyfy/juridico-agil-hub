import { Outlet } from 'react-router-dom';
import AppSidebar from './AppSidebar';
import { useAuth } from '@/contexts/AuthContext';
import { Bell } from 'lucide-react';

export default function AppLayout() {
  const { user } = useAuth();

  return (
    <div className="flex min-h-screen w-full bg-background">
      <AppSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-16 border-b bg-card flex items-center justify-between px-6 sticky top-0 z-10">
          <div>
            <h2 className="text-sm font-medium text-muted-foreground capitalize">
              {user?.role === 'advogado' ? 'Painel do Advogado' : user?.role === 'cliente' ? 'Portal do Cliente' : 'Administração'}
            </h2>
          </div>
          <div className="flex items-center gap-4">
            <button className="relative p-2 rounded-md hover:bg-secondary transition-colors">
              <Bell className="h-5 w-5 text-muted-foreground" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-accent rounded-full" />
            </button>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <span className="text-xs font-semibold text-primary-foreground">
                  {user?.name?.charAt(0) || 'U'}
                </span>
              </div>
              <span className="text-sm font-medium hidden md:block">{user?.name}</span>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
