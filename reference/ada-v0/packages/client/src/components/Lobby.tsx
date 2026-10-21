import { MAX_PLAYERS, MIN_PLAYERS, ROLE_LIST, type LobbyInfo } from '@ada/game-core';
import type { Net } from '../net';

export function Lobby({ net, lobby }: { net: Net; lobby: LobbyInfo }) {
  const me = lobby.players.find((p) => p.id === lobby.me)!;
  const isHost = lobby.host === lobby.me;
  const nameOf = (id: string) => lobby.players.find((p) => p.id === id)?.name;
  const holderOf = (role: string) => lobby.players.find((p) => p.role === role);

  return (
    <main className="lobby">
      <header className="lobby-head">
        <div>
          <p className="muted">Oda kodu</p>
          <button
            className="room-code"
            aria-label="Oda kodunu kopyala"
            onClick={() => navigator.clipboard?.writeText(lobby.code).catch(() => undefined)}
          >
            {lobby.code}
          </button>
        </div>
        <button className="btn ghost" onClick={net.leave}>Odadan çık</button>
      </header>

      <section aria-labelledby="players-h">
        <h2 id="players-h">Oyuncular ({lobby.players.length}/{MAX_PLAYERS})</h2>
        <ul className="player-list">
          {lobby.players.map((p) => (
            <li key={p.id} className={p.connected ? '' : 'offline'}>
              <span className="p-name">{p.name}{p.id === lobby.host ? ' (oda sahibi)' : ''}</span>
              <span className="p-role">{p.role ? ROLE_LIST.find((r) => r.id === p.role)!.name : 'Rol seçmedi'}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="roles-h">
        <h2 id="roles-h">Rolünü seç</h2>
        <p className="muted">Seçmezsen kalan rollerden biri rastgele verilir.</p>
        <div className="role-grid">
          {ROLE_LIST.map((r) => {
            const holder = holderOf(r.id);
            const mine = holder?.id === me.id;
            const taken = !!holder && !mine;
            return (
              <button
                key={r.id}
                className={`role-card${mine ? ' selected' : ''}`}
                disabled={taken}
                aria-pressed={mine}
                onClick={() => net.setRole(mine ? null : r.id)}
              >
                <strong>{r.name}</strong>
                <span>{r.blurb}</span>
                {taken && <em>{nameOf(holder!.id)} seçti</em>}
              </button>
            );
          })}
        </div>
      </section>

      <footer className="lobby-foot">
        {isHost ? (
          <button className="btn primary" disabled={lobby.players.length < MIN_PLAYERS} onClick={net.start}>
            Oyunu başlat
          </button>
        ) : (
          <p className="muted">Oda sahibinin oyunu başlatması bekleniyor…</p>
        )}
        {isHost && lobby.players.length < MIN_PLAYERS && <p className="muted">En az {MIN_PLAYERS} oyuncu gerekir. Arkadaşlarına oda kodunu gönder.</p>}
      </footer>
    </main>
  );
}
