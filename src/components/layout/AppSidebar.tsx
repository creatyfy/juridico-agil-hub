import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  LayoutDashboard,
  FileText,
  Users,
  MessageSquare,
  Settings,
  Scale,
  LogOut,
  Shield,
  BarChart3,
  CreditCard,
  ChevronLeft,
  ChevronRight,
  Megaphone,
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import logo from '@/assets/logo-jarvis-jud.png';

interface MenuItem {
  label: string;
  icon: React.ElementType;
  path: string;
}

const advogadoMenu: MenuItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
  { label: 'Processos', icon: FileText, path: '/processos' },
  { label: 'Clientes', icon: Users, path: '/clientes' },
  { label: 'Atendimento', icon: MessageSquare, path: '/atendimento' },
  { label: 'Campanhas', icon: Megaphone, path: '/campanhas' },
  { label: 'Configurações', icon: Settings, path: '/configuracoes' },
  { label: 'Planos', icon: CreditCard, path: '/planos' },
];

const clienteMenu: MenuItem[] = [
  { label: 'Meus Processos', icon: FileText, path: '/dashboard' },
  { label: 'Planos', icon: CreditCard, path: '/planos' },
];

const adminMenu: MenuItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
  { label: 'Advogados', icon: Scale, path: '/admin/advogados' },
  { label: 'Usuários', icon: Users, path: '/admin/usuarios' },
  { label: 'Monitoramento', icon: BarChart3, path: '/admin/monitoramento' },
  { label: 'Integrações', icon: Shield, path: '/admin/integracoes' },
  { label: 'Configurações', icon: Settings, path: '/configuracoes' },
  { label: 'Planos', icon: CreditCard, path: '/planos' },
];

export default function AppSidebar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const menu = user?.role === 'admin' ? adminMenu : user?.role === 'cliente' ? clienteMenu : advogadoMenu;

  return (
    <aside
      className={cn(
        'h-screen bg-sidebar flex flex-col border-r border-sidebar-border transition-all duration-300 sticky top-0',
        collapsed ? 'w-16' : 'w-60'
      )}
    >
      {/* Logo area */}
      <div className="h-16 flex items-center justify-between px-3 border-b border-sidebar-border">
        {!collapsed && (
          <img src={logo} alt="Jarvis Jud" className="h-7 brightness-0 invert" />
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-md text-sidebar-foreground/60 hover:text-sidebar-primary-foreground hover:bg-sidebar-accent transition-colors"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
        {menu.map((item) => {
          const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn('sidebar-item', isActive && 'sidebar-item-active')}
              title={collapsed ? item.label : undefined}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* User section */}
      <div className="p-3 border-t border-sidebar-border">
        {!collapsed && user && (
          <div className="mb-2 px-2">
            <p className="text-sm font-medium text-sidebar-primary-foreground truncate">{user.name}</p>
            <p className="text-xs text-sidebar-foreground/60 truncate capitalize">{user.role}</p>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="sidebar-item w-full justify-start text-sidebar-foreground/60 hover:text-destructive"
          title={collapsed ? 'Sair' : undefined}
        >
          <LogOut className="h-5 w-5 shrink-0" />
          {!collapsed && <span>Sair</span>}
        </button>
      </div>
    </aside>
  );
}
