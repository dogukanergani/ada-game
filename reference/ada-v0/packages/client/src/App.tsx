import { useNet } from './net';
import { Home } from './components/Home';
import { Lobby } from './components/Lobby';
import { GameScreen } from './components/GameScreen';

export default function App() {
  const net = useNet();
  return (
    <div className="app">
      {!net.connected && <div className="banner" role="status">Sunucuya bağlanılıyor…</div>}
      {net.rejoining ? (
        <div className="splash"><h1 className="wordmark">Ada</h1></div>
      ) : !net.lobby ? (
        <Home net={net} />
      ) : net.game ? (
        <GameScreen net={net} game={net.game} isHost={net.lobby.host === net.game.me} />
      ) : (
        <Lobby net={net} lobby={net.lobby} />
      )}
      {net.error && <div className="toast" role="alert">{net.error}</div>}
    </div>
  );
}
