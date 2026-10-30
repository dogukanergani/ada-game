import { useState } from 'react';
import { CUSTOM_TARGET_MAX, CUSTOM_TARGET_MIN, ROLE_LIST, MODES, TEAMS, TEAM_MODE_PLAYERS, TEAM_SIZE, type GameMode } from '@ada/game-core';
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

/** The points that win this room's game: the chosen number in the custom mode, the mode's own otherwise. */
export const targetOf = (lobby: Pick<LobbyView, 'mode' | 'targetScore'>): number => (lobby.mode === 'custom' ? lobby.targetScore : MODES[lobby.mode].vpToWin);

/** "90 sn", or "30 dk" when it is whole minutes: how a limit reads on its button. */
function limitText(t: ReturnType<typeof useT>, seconds: number, wholeMinutes: boolean): string {
  return wholeMinutes && seconds % 60 === 0 ? t('lobby.timer.minutes', { n: seconds / 60 }) : t('lobby.timer.seconds', { n: seconds });
}

/** The choice a switch turns on at: the preferred value if it is on offer, else the first one. */
const pickDefault = (choices: number[], preferred: number): number => (choices.includes(preferred) ? preferred : choices[0]);

const MODE_ORDER: GameMode[] = ['standard', 'short', 'custom'];

/** The team mode can start when exactly 4 players are here and two of them sit on each team. */
export function teamsReady(lobby: Pick<LobbyView, 'teamMode' | 'players'>): boolean {
  if (!lobby.teamMode) return true;
  const here = lobby.players.filter((p) => p.connected);
  return here.length === TEAM_MODE_PLAYERS && TEAMS.every((team) => here.filter((p) => p.team === team).length === TEAM_SIZE);
}

/** Room lobby: who is here, pick a role, the host picks the mode (and the timer) and starts. */
export function Lobby({ lobby }: { lobby: LobbyView }) {
  const t = useT();
  const { api } = useApp();
  const me = lobby.players.find((p) => p.id === lobby.me);
  const isHost = lobby.hostId === lobby.me;
  const connected = lobby.players.filter((p) => p.connected).length;
  const teamOk = teamsReady(lobby);
  const canStart = isHost && connected >= lobby.minPlayers && teamOk;
  const noTeam = lobby.players.filter((p) => p.connected && p.team === null);
  const [name, setName] = useState(me?.name ?? '');
  const ownerOf = (role: string) => lobby.players.find((p) => p.role === role);

  return (
    <main className="lobby">
      <header className="screen-head">
        <h1>{t('lobby.title')}</h1>
        <HeaderButtons vpToWin={targetOf(lobby)} />
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
          {MODE_ORDER.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={lobby.mode === m}
              disabled={!isHost}
              className="segment"
              data-mode={m}
              onClick={() => void api.request('lobby:setMode', m === 'custom' ? { mode: m, targetScore: lobby.targetScore } : { mode: m })}
            >
              {t(`mode.${m}`)}
            </button>
          ))}
        </div>
        {lobby.mode === 'custom' && (
          <div className="target-picker" role="group" aria-labelledby="target-title" data-target={lobby.targetScore}>
            <span id="target-title" className="field-label">
              {t('lobby.target.title')}
            </span>
            <button
              type="button"
              className="btn step-btn"
              aria-label={t('lobby.target.dec')}
              disabled={!isHost || lobby.targetScore <= CUSTOM_TARGET_MIN}
              onClick={() => void api.request('lobby:setMode', { mode: 'custom', targetScore: lobby.targetScore - 1 })}
            >
              −
            </button>
            <output className="target-value" aria-live="polite">
              {t('lobby.target.value', { n: lobby.targetScore })}
            </output>
            <button
              type="button"
              className="btn step-btn"
              aria-label={t('lobby.target.inc')}
              disabled={!isHost || lobby.targetScore >= CUSTOM_TARGET_MAX}
              onClick={() => void api.request('lobby:setMode', { mode: 'custom', targetScore: lobby.targetScore + 1 })}
            >
              +
            </button>
          </div>
        )}
        {lobby.mode === 'custom' && <p className="field-hint">{t('lobby.target.hint')}</p>}
        {!isHost && <p className="field-hint">{t('lobby.mode.hostOnly')}</p>}
      </section>

      <section className="card" aria-labelledby="timer-title" data-timer={lobby.timer ? 'on' : 'off'}>
        <div className="timer-head">
          <h2 id="timer-title">{t('lobby.timer.title')}</h2>
          <button
            type="button"
            role="switch"
            aria-checked={lobby.timer !== null}
            aria-labelledby="timer-title"
            className="switch"
            data-action="timer-toggle"
            disabled={!isHost}
            onClick={() =>
              void api.request('lobby:setTimer', {
                timer: lobby.timer ? null : { turnSeconds: pickDefault(lobby.timerChoices.turnSeconds, 90), gameSeconds: pickDefault(lobby.timerChoices.gameSeconds, 3600) },
              })
            }
          >
            <span className="switch-knob" aria-hidden="true" />
            <span className="switch-text">{lobby.timer ? t('lobby.timer.on') : t('lobby.timer.off')}</span>
          </button>
        </div>
        {lobby.timer && (
          <>
            <span id="turn-limit-title" className="field-label">
              {t('lobby.timer.turn')}
            </span>
            <div className="segmented" role="radiogroup" aria-labelledby="turn-limit-title" data-limit="turn">
              {lobby.timerChoices.turnSeconds.map((sec) => (
                <button
                  key={sec}
                  type="button"
                  role="radio"
                  aria-checked={lobby.timer!.turnSeconds === sec}
                  disabled={!isHost}
                  className="segment"
                  data-seconds={sec}
                  onClick={() => void api.request('lobby:setTimer', { timer: { ...lobby.timer!, turnSeconds: sec } })}
                >
                  {limitText(t, sec, false)}
                </button>
              ))}
            </div>
            <span id="game-limit-title" className="field-label">
              {t('lobby.timer.game')}
            </span>
            <div className="segmented" role="radiogroup" aria-labelledby="game-limit-title" data-limit="game">
              {lobby.timerChoices.gameSeconds.map((sec) => (
                <button
                  key={sec}
                  type="button"
                  role="radio"
                  aria-checked={lobby.timer!.gameSeconds === sec}
                  disabled={!isHost}
                  className="segment"
                  data-seconds={sec}
                  onClick={() => void api.request('lobby:setTimer', { timer: { ...lobby.timer!, gameSeconds: sec } })}
                >
                  {limitText(t, sec, true)}
                </button>
              ))}
            </div>
          </>
        )}
        <p className="field-hint">{t('lobby.timer.hint')}</p>
        {!isHost && <p className="field-hint">{t('lobby.timer.hostOnly')}</p>}
      </section>

      <section className="card" aria-labelledby="team-title" data-team-mode={lobby.teamMode ? 'on' : 'off'}>
        <div className="timer-head">
          <h2 id="team-title">{t('lobby.team.title')}</h2>
          <button
            type="button"
            role="switch"
            aria-checked={lobby.teamMode}
            aria-labelledby="team-title"
            className="switch"
            data-action="team-toggle"
            disabled={!isHost}
            onClick={() => void api.request('lobby:setTeamMode', { on: !lobby.teamMode })}
          >
            <span className="switch-knob" aria-hidden="true" />
            <span className="switch-text">{lobby.teamMode ? t('lobby.team.on') : t('lobby.team.off')}</span>
          </button>
        </div>
        {lobby.teamMode && (
          <>
            <p className="field-hint">{t('lobby.team.pick')}</p>
            <div className="team-cols">
              {TEAMS.map((team) => {
                const members = lobby.players.filter((p) => p.team === team);
                const mineHere = me?.team === team;
                const full = members.length >= TEAM_SIZE;
                return (
                  <div key={team} className="team-col" data-team={team} data-full={full}>
                    <h3 className="team-head">
                      <span className="team-badge" data-team={team} aria-hidden="true">
                        {t(`team.short.${team}`)}
                      </span>
                      {t(`team.name.${team}`)}
                    </h3>
                    <ul className="team-members">
                      {Array.from({ length: TEAM_SIZE }, (_, i) => (
                        <li key={i} data-empty={!members[i]}>
                          {members[i] ? (
                            <>
                              {members[i].name}
                              {members[i].id === lobby.me && <span className="tag">{t('lobby.player.you')}</span>}
                            </>
                          ) : (
                            t('lobby.team.empty')
                          )}
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      className="btn"
                      data-action={`team-join-${team}`}
                      aria-pressed={mineHere}
                      aria-disabled={full && !mineHere}
                      onClick={() => {
                        if (mineHere) void api.request('lobby:setTeam', { team: null });
                        else if (!full) void api.request('lobby:setTeam', { team });
                      }}
                    >
                      {mineHere ? t('lobby.team.leave') : full ? t('lobby.team.full') : t('lobby.team.join')}
                    </button>
                  </div>
                );
              })}
            </div>
            {noTeam.length > 0 && <p className="field-hint">{t('lobby.team.noTeam', { names: noTeam.map((p) => p.name).join(', ') })}</p>}
            {lobby.players.filter((p) => p.connected).length !== TEAM_MODE_PLAYERS && (
              <p className="field-hint" data-team="need4">
                {t('lobby.team.need4', { n: lobby.players.filter((p) => p.connected).length })}
              </p>
            )}
          </>
        )}
        <p className="field-hint">{t('lobby.team.hint')}</p>
        {!isHost && <p className="field-hint">{t('lobby.team.hostOnly')}</p>}
      </section>

      <footer className="lobby-actions">
        {isHost ? (
          <>
            <button type="button" className="btn primary wide" disabled={!canStart} aria-describedby={canStart ? undefined : 'start-reason'} onClick={() => void api.request('lobby:start')}>
              {t('lobby.start')}
            </button>
            {!canStart && (
              <p id="start-reason" className="field-hint">
                {connected >= lobby.minPlayers ? t('lobby.start.needTeams') : t('lobby.start.needPlayers')}
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
