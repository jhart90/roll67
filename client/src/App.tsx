import { useEffect, useState } from 'react';
import { useAuthStore } from './store/auth';
import { Login } from './screens/Login';
import { CampaignList } from './screens/CampaignList';
import { Table } from './screens/Table';

export function App() {
  const { user, checking, loadMe } = useAuthStore();
  const [openCampaignId, setOpenCampaignId] = useState<string | null>(null);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  if (checking) {
    // The same dark the bookshelf paints under itself, so the session check
    // reads as the library's lights coming up rather than a different room.
    return (
      <div className="shelf-screen shelf-checking">
        <span className="shelf-brand">ROLL67</span>
      </div>
    );
  }

  if (!user) return <Login />;

  if (!openCampaignId) return <CampaignList onOpen={setOpenCampaignId} />;

  return <Table campaignId={openCampaignId} onExit={() => setOpenCampaignId(null)} />;
}
