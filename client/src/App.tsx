import { useEffect, useState } from 'react';
import { useAuthStore } from './store/auth';
import { useGameStore } from './store/game';
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

  // Thrown out of a campaign that no longer exists, or that we are no longer
  // in. Above every early return, because a hook that only runs on some
  // renders is not a hook.
  const ejected = useGameStore((s) => s.ejected);
  useEffect(() => {
    if (!ejected) return;
    setOpenCampaignId(null);
    useGameStore.getState().clearEjected();
    // The shelf is only loaded at sign-in, so without this the campaign we
    // were just thrown out of is still sitting on it — a book that opens onto
    // nothing. Refetched rather than pruned locally: the server is the one
    // that knows what is left.
    void useAuthStore.getState().loadCampaigns();
  }, [ejected]);

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
