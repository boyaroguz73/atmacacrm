import { create } from 'zustand';
import api from '@/lib/api';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  organizationId?: string;
}

interface Organization {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  primaryColor: string;
  secondaryColor: string;
  plan: string;
}

interface AuthState {
  user: User | null;
  organization: Organization | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: {
    organizationName: string;
    name: string;
    email: string;
    password: string;
  }) => Promise<void>;
  logout: () => void;
  loadFromStorage: () => void;
  updateOrganization: (org: Partial<Organization>) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  organization: null,
  token: null,
  isLoading: false,

  login: async (email, password) => {
    set({ isLoading: true });
    try {
      const { data } = await api.post('/auth/login', { email, password });
      localStorage.setItem('token', data.accessToken);
      localStorage.setItem('user', JSON.stringify(data.user));
      if (data.organization) {
        localStorage.setItem('organization', JSON.stringify(data.organization));
      }
      set({
        user: data.user,
        organization: data.organization || null,
        token: data.accessToken,
        isLoading: false,
      });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  register: async (payload) => {
    set({ isLoading: true });
    try {
      const { data } = await api.post('/auth/register', payload);
      localStorage.setItem('token', data.accessToken);
      localStorage.setItem('user', JSON.stringify(data.user));
      if (data.organization) {
        localStorage.setItem('organization', JSON.stringify(data.organization));
      } else {
        localStorage.removeItem('organization');
      }
      set({
        user: data.user,
        organization: data.organization || null,
        token: data.accessToken,
        isLoading: false,
      });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('organization');
    set({ user: null, organization: null, token: null });
    window.location.href = '/login';
  },

  loadFromStorage: () => {
    if (typeof window === 'undefined') return;
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    const orgStr = localStorage.getItem('organization');
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr);
        const organization = orgStr ? JSON.parse(orgStr) : null;
        set({ user, organization, token });
      } catch {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('organization');
      }
    }
  },

  updateOrganization: (org) => {
    const current = get().organization;
    const updated = { ...current, ...org } as Organization;
    localStorage.setItem('organization', JSON.stringify(updated));
    set({ organization: updated });
  },
}));
