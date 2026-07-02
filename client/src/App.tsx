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
    return (
      <div className="center-screen">
        <p className="dim">loading…</p>
      </div>
    );
  }

  if (!user) return <Login />;

  if (!openCampaignId) return <CampaignList onOpen={setOpenCampaignId} />;

  return <Table campaignId={openCampaignId} onExit={() => setOpenCampaignId(null)} />;
}
