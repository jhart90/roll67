import { create } from 'zustand';
import type { GameSystem, Role, UserInfo } from 'shared';
import { api } from '../api';
import { setToken } from '../socket';

export interface CampaignListItem {
  id: string;
  name: string;
  system: GameSystem;
  role: Role;
  inviteCode: string | null;
}

interface AuthState {
  user: UserInfo | null;
  checking: boolean;
  campaignList: CampaignListItem[];
  register(username: string, password: string): Promise<void>;
  login(username: string, password: string): Promise<void>;
  logout(): void;
  loadMe(): Promise<void>;
  loadCampaigns(): Promise<void>;
  createCampaign(name: string, system: GameSystem): Promise<void>;
  joinCampaign(inviteCode: string): Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  checking: true,
  campaignList: [],

  async register(username, password) {
    const { token, user } = await api.post<{ token: string; user: UserInfo }>('/api/register', { username, password });
    setToken(token);
    set({ user });
    await get().loadCampaigns();
  },

  async login(username, password) {
    const { token, user } = await api.post<{ token: string; user: UserInfo }>('/api/login', { username, password });
    setToken(token);
    set({ user });
    await get().loadCampaigns();
  },

  logout() {
    void api.post('/api/logout').catch(() => undefined);
    setToken(null);
    set({ user: null, campaignList: [] });
  },

  async loadMe() {
    try {
      const { user } = await api.get<{ user: UserInfo }>('/api/me');
      set({ user, checking: false });
      await get().loadCampaigns();
    } catch {
      set({ user: null, checking: false });
    }
  },

  async loadCampaigns() {
    const { campaigns } = await api.get<{ campaigns: CampaignListItem[] }>('/api/campaigns');
    set({ campaignList: campaigns });
  },

  async createCampaign(name, system) {
    await api.post('/api/campaigns', { name, system });
    await get().loadCampaigns();
  },

  async joinCampaign(inviteCode) {
    await api.post('/api/campaigns/join', { inviteCode });
    await get().loadCampaigns();
  },
}));
