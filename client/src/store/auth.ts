import { create } from 'zustand';
import type { GameSystem, Role, UserInfo } from 'shared';
import { api } from '../api';
import { disconnectSocket, setToken } from '../socket';

export interface CampaignListItem {
  id: string;
  name: string;
  system: GameSystem;
  role: Role;
  inviteCode: string | null;
  /** Which book on the lobby shelf holds this campaign; null = never placed. */
  shelfSlot: number | null;
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
  /** Rearrange the shelf: campaignId -> book slot. Saved to the account, so
   *  the same shelf greets this member on every machine. */
  saveShelf(slots: Record<string, number>): Promise<void>;
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
    // The socket is a long-lived singleton authenticated once at connect
    // time (server stamps socket.data.userId from the handshake token and
    // never re-checks it) -- leaving it connected would let a fresh login as
    // someone else keep emitting over the old user's identity. Tearing it
    // down forces the next connectSocket() to hand-shake fresh with
    // whatever token is current at that point.
    disconnectSocket();
    set({ user: null, campaignList: [] });
  },

  async loadMe() {
    try {
      const { user } = await api.get<{ user: UserInfo }>('/api/me');
      set({ user, checking: false });
      await get().loadCampaigns();
    } catch {
      disconnectSocket();
      set({ user: null, checking: false });
    }
  },

  async loadCampaigns() {
    const { campaigns } = await api.get<{ campaigns: CampaignListItem[] }>('/api/campaigns');
    set({ campaignList: campaigns });
  },

  async saveShelf(slots) {
    // Optimistic: the books swap under the cursor, then the server's copy
    // becomes the truth on the next load.
    set({ campaignList: get().campaignList.map((c) => ({ ...c, shelfSlot: slots[c.id] ?? null })) });
    await api.post('/api/campaigns/shelf', { slots });
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
