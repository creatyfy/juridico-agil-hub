import { Navigate } from 'react-router-dom';
import { useAuth, UserRole } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import { useCanAccess } from '@/hooks/usePlanAccess';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
  requiredFeature?: string;
}

export default function ProtectedRoute({ children, allowedRoles, requiredFeature }: ProtectedRouteProps) {
  const { isAuthenticated, loading, user } = useAuth();
  const { allowed, isLoading } = useCanAccess(requiredFeature ?? '');

  if (loading || (requiredFeature && isLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  if (requiredFeature && !allowed) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
