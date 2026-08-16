import { useEffect, useState } from 'react';
import { useAuthStore } from './store/auth';
import { Login } from './screens/Login';
import { ResetPassword, resetTokenFromUrl } from './screens/ResetPassword';
import { CampaignList } from './screens/CampaignList';
import { Table } from './screens/Table';

export function App() {
  const { user, checking, loadMe } = useAuthStore();
  const [openCampaignId, setOpenCampaignId] = useState<string | null>(null);
  // Read once, at mount: the reset screen strips the token from the address bar
  // when it is finished, and re-reading would then bounce straight back out.
  const [resetToken, setResetToken] = useState(resetTokenFromUrl);

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

  // Ahead of the signed-in check on purpose: someone who is still signed in on
  // this browser and clicks a reset link means to reset, not to be waved past
  // it into the shelf.
  if (resetToken) return <ResetPassword token={resetToken} onDone={() => setResetToken(null)} />;

  if (!user) return <Login />;

  if (!openCampaignId) return <CampaignList onOpen={setOpenCampaignId} />;

  return <Table campaignId={openCampaignId} onExit={() => setOpenCampaignId(null)} />;
}
