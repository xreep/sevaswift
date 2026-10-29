import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { AuthState, RegisterData, Role, User } from '../types';
import { authApi } from '../services/api';

export interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<User>;
  register: (data: RegisterData) => Promise<User>;
  logout: () => Promise<void>;
  verifyEmail: (token: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  resetPassword: (token: string, password: string) => Promise<void>;
  hasRole: (roles: Role[]) => boolean;
  refreshUser: () => Promise<void>;
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: localStorage.getItem('accessToken'),
    isAuthenticated: false,
    isLoading: true,
  });

  const refreshUser = useCallback(async () => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      setState({ user: null, accessToken: null, isAuthenticated: false, isLoading: false });
      return;
    }
    try {
      const response = await authApi.me();
      setState({
        user: response.data.user,
        accessToken: localStorage.getItem('accessToken'),
        isAuthenticated: true,
        isLoading: false,
      });
    } catch {
      localStorage.removeItem('accessToken');
      setState({ user: null, accessToken: null, isAuthenticated: false, isLoading: false });
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  // Keep the token in state in sync when the API client refreshes it.
  useEffect(() => {
    const onToken = () => setState(s => ({ ...s, accessToken: localStorage.getItem('accessToken') }));
    window.addEventListener('sevaswift:token', onToken);
    return () => window.removeEventListener('sevaswift:token', onToken);
  }, []);

  const login = async (email: string, password: string) => {
    const response = await authApi.login({ email, password });
    const { user, accessToken } = response.data;
    localStorage.setItem('accessToken', accessToken);
    setState({ user, accessToken, isAuthenticated: true, isLoading: false });
    return user;
  };

  const register = async (data: RegisterData) => {
    const response = await authApi.register(data);
    const { user, accessToken } = response.data;
    localStorage.setItem('accessToken', accessToken);
    setState({ user, accessToken, isAuthenticated: true, isLoading: false });
    return user;
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } finally {
      localStorage.removeItem('accessToken');
      setState({ user: null, accessToken: null, isAuthenticated: false, isLoading: false });
    }
  };

  const verifyEmail = async (token: string) => {
    await authApi.verifyEmail({ token });
  };

  const forgotPassword = async (email: string) => {
    await authApi.forgotPassword({ email });
  };

  const resetPassword = async (token: string, password: string) => {
    await authApi.resetPassword({ token, password });
  };

  const hasRole = (roles: Role[]) => (state.user ? roles.includes(state.user.role) : false);

  const setUser = (user: User) => setState(s => ({ ...s, user }));

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        register,
        logout,
        verifyEmail,
        forgotPassword,
        resetPassword,
        hasRole,
        refreshUser,
        setUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
