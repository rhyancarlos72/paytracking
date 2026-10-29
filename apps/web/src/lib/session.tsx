import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from './api';

export type Role = 'owner' | 'admin' | 'analyst' | 'viewer';
export interface Me {
  user: { id: string; email: string; name: string | null; isPlatformAdmin: boolean; emailVerified: boolean; hideEmail: boolean };
  role: Role;
  org: { id: string; name: string; reportingCurrency: string; timezone: string; goalDailyMinor: string; goalMonthlyMinor: string };
  plan: { status: 'trial' | 'active' | 'expired' | 'exempt'; daysLeft: number | null; blocked: boolean; expiresAt: string | null; priceMinor: number };
  orgs: Array<{ id: string; name: string; role: Role }>;
}

const RANK: Record<Role, number> = { viewer: 0, analyst: 1, admin: 2, owner: 3 };

export function useMe() {
  return useQuery<Me | null>({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await get<Me>('/v1/auth/me');
      } catch (e: any) {
        if (e?.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

export function useSession() {
  const { data } = useMe();
  if (!data) throw new Error('Sessão ausente');
  return {
    ...data,
    can: (min: Role) => RANK[data.role] >= RANK[min],
    currency: data.org.reportingCurrency,
  };
}

export function useLogout() {
  const qc = useQueryClient();
  return async () => {
    await post('/v1/auth/logout').catch(() => undefined);
    qc.clear();
    location.href = '/entrar';
  };
}
