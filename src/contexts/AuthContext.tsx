import React, { createContext, useContext, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

export type UserRole = 'advogado' | 'cliente' | 'admin';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  oab?: string;
  cpf?: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: (role: UserRole, credentials: Record<string, string>) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const mockUsers: Record<UserRole, User> = {
  advogado: {
    id: '1',
    name: 'Dr. Carlos Mendes',
    email: 'carlos@escritorio.com',
    role: 'advogado',
    oab: '123456/SP',
  },
  cliente: {
    id: '2',
    name: 'Maria Silva',
    email: 'maria@email.com',
    role: 'cliente',
    cpf: '123.456.789-00',
  },
  admin: {
    id: '3',
    name: 'Administrador',
    email: 'admin@jurisai.com',
    role: 'admin',
  },
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  const login = useCallback(async (role: UserRole, _credentials: Record<string, string>) => {
    // Mock login - in production, this would validate against backend
    await new Promise((r) => setTimeout(r, 800));
    setUser(mockUsers[role]);
  }, []);

  const logout = useCallback(() => {
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
