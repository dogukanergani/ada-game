import { useState } from 'react';
import { ROLE_LIST, MODES, type GameMode } from '@ada/game-core';
import { NAME_MAX_LENGTH, type LobbyView } from '@ada/protocol';
import { useT } from '../i18n/context';
import { hasKey, type MessageKey } from '../i18n';
import { useApp } from '../net/app';
import { storage } from '../net/storage';
import { HeaderButtons } from '../ui/HeaderButtons';

const roleKey = (id: string, part: 'name' | 'desc'): MessageKey | null => (hasKey(`role.${id}.${part}`) ? (`role.${id}.${part}` as MessageKey) : null);

/** Copies text; falls back to a hidden textarea where the clipboard API is missing or refused. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function CodeBadge({ code }: { code: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="code-badge">
      <span className="field-label">{t('lobby.code.label')}</span>
      <button
        type="button"
        className="code-button"
        aria-label={`${t('lobby.code.copy')}: ${code.split('').join(' ')}`}
        onClick={async () => {
          setCopied(await copyText(code));
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        <span className="code-letters" aria-hidden="true">
          {code}
        </span>
      </button>
      <span className="field-hint" role="status">
        {copied ? t('lobby.code.copied') : t('lobby.code.hint')}
      </span>
    </div>
  );
}

/** Room lobby: who is here, pick a role, the host picks the mode and starts. */
export function Lobby({ lobby }: { lobby: LobbyView }) {
  const t = useT();
  const { api } = useApp();
  const me = lobby.players.find((p) => p.id === lobby.me);
  const isHost = lobby.hostId === lobby.me;
  const connected = lobby.players.filter((p) => p.connected).length;
  const canStart = isHost && connected >= lobby.minPlayers;
  const [name, setName] = useState(me?.name ?? '');
  const ownerOf = (role: string) => lobby.players.find((p) => p.role === role);

  return (
    <main className="lobby">
      <header className="screen-head">
        <h1>{t('lobby.title')}</h1>
        <HeaderButtons />
      </header>

      <CodeBadge code={lobby.code} />

      <section className="card" aria-labelledby="players-title">
        <h2 id="players-title">{t('lobby.players.title', { n: lobby.players.length, max: lobby.maxPlayers })}</h2>
        <ul className="player-list">
          {lobby.players.map((p) => (
            <li key={p.id} className="player-row" data-connected={p.connected}>
              <span className="player-name">
                {p.name}
                {p.id === lobby.me && <span className="tag">{t('lobby.player.you')}</span>}
                {p.host && <span className="tag accent">{t('lobby.player.host')}</span>}
              </span>
              <span className="presence" data-connected={p.connected}>
                <span className="presence-dot" aria-hidden="true" />
                {p.connected ? t('lobby.player.online') : t('lobby.player.offline')}
              </span>
              <span className="player-role">{p.role ? (roleKey(p.role, 'name') ? t(roleKey(p.role, 'name')!) : p.role) : '—'}</span>
            </li>
          ))}
        </ul>
        <label htmlFor="lobby-name" className="field-label">
          {t('lobby.name.label')}
        </label>
        <input
          id="lobby-name"
          className="field"
          value={name}
          maxLength={NAME_MAX_LENGTH}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const clean = name.replace(/\s+/g, ' ').trim();
            if (clean && clean !== me?.name) {
              storage.set('name', clean);
              void api.request('lobby:setName', { name: clean });
            }
          }}
        />
      </section>

      <section className="card" aria-labelledby="roles-title">
        <h2 id="roles-title">{t('lobby.roles.title')}</h2>
        <div className="role-grid">
          <button
            type="button"
            className="role-card"
            aria-pressed={me?.role === null}
            onClick={() => void api.request('lobby:setRole', { role: null })}
          >
            <strong>{t('lobby.role.random')}</strong>
            <span>{t('lobby.role.random.desc')}</span>
            {me?.role === null && <span className="tag accent">{t('lobby.role.selected')}</span>}
          </button>
          {ROLE_LIST.map((r) => {
            const owner = ownerOf(r.id);
            const mine = owner?.id === lobby.me;
            const locked = !!owner && !mine;
            return (
              <button
                key={r.id}
                type="button"
                className="role-card"
                aria-pressed={mine}
                aria-disabled={locked}
                data-locked={locked}
                onClick={() => {
                  if (!locked) void api.request('lobby:setRole', { role: mine ? null : r.id });
                }}
              >
                <strong>{roleKey(r.id, 'name') ? t(roleKey(r.id, 'name')!) : r.id}</strong>
                <span>{roleKey(r.id, 'desc') ? t(roleKey(r.id, 'desc')!) : ''}</span>
                {mine && <span className="tag accent">{t('lobby.role.selected')}</span>}
                {locked && <span className="tag">{t('lobby.role.takenBy', { player: owner!.name })}</span>}
              </button>
            );
          })}
        </div>
      </section>

      <section className="card" aria-labelledby="mode-title">
        <h2 id="mode-title">{t('lobby.mode.title')}</h2>
        <div className="segmented" role="radiogroup" aria-labelledby="mode-title">
          {(Object.keys(MODES) as GameMode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={lobby.mode === m}
              disabled={!isHost}
              className="segment"
              onClick={() => void api.request('lobby:setMode', { mode: m })}
            >
              {t(`mode.${m}`)}
            </button>
          ))}
        </div>
        {!isHost && <p className="field-hint">{t('lobby.mode.hostOnly')}</p>}
      </section>

      <footer className="lobby-actions">
        {isHost ? (
          <>
            <button type="button" className="btn primary wide" disabled={!canStart} aria-describedby={canStart ? undefined : 'start-reason'} onClick={() => void api.request('lobby:start')}>
              {t('lobby.start')}
            </button>
            {!canStart && (
              <p id="start-reason" className="field-hint">
                {t('lobby.start.needPlayers')}
              </p>
            )}
          </>
        ) : (
          <p className="field-hint" role="status">
            {t('lobby.start.waiting')}
          </p>
        )}
        <button type="button" className="btn quiet" onClick={() => void api.request('room:leave').then((r) => r.ok && api.dispatch({ t: 'leftRoom' }))}>
          {t('lobby.leave')}
        </button>
      </footer>
    </main>
  );
}
