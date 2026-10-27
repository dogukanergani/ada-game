import { useErrorSound } from './audio/reactions';
import { I18nProvider } from './i18n/context';
import { AppProvider, useApp } from './net/app';
import { IncompatibleScreen, ReplacedScreen } from './ui/Gate';
import { Home } from './screens/Home';
import { Lobby } from './screens/Lobby';
import { Toast } from './ui/Toast';
import { StatusLine } from './ui/StatusLine';
import { GameScreen } from './screens/Game';

function Shell() {
  const { state } = useApp();
  useErrorSound(state.notice);
  if (state.conn === 'incompatible') return <IncompatibleScreen />;
  if (state.conn === 'replaced') return <ReplacedScreen />;
  return (
    <div className="app">
      <StatusLine />
      {state.game && state.lobby && state.lobby.phase !== 'lobby' ? <GameScreen /> : state.lobby ? <Lobby lobby={state.lobby} /> : <Home />}
      <Toast />
    </div>
  );
}

export function App() {
  return (
    <I18nProvider>
      <AppProvider>
        <Shell />
      </AppProvider>
    </I18nProvider>
  );
}
