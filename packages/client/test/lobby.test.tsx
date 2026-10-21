import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { LobbyView } from '@ada/protocol';
import { I18nProvider } from '../src/i18n/context';
import { dictionaries } from '../src/i18n';
import { AppProvider } from '../src/net/app';
import { Home } from '../src/screens/Home';
import { Lobby } from '../src/screens/Lobby';

beforeAll(() => {
  vi.stubGlobal('navigator', { languages: ['en'], language: 'en' });
});

const en = dictionaries.en;
const render = (el: React.ReactElement) =>
  renderToStaticMarkup(
    <I18nProvider>
      <AppProvider>{el}</AppProvider>
    </I18nProvider>,
  );

const view = (over: Partial<LobbyView> = {}, players: Partial<LobbyView['players'][number]>[] = []): LobbyView => ({
  code: 'KMTP',
  me: 'a',
  hostId: 'a',
  mode: 'standard',
  phase: 'lobby',
  minPlayers: 2,
  maxPlayers: 5,
  players: players.map((p, i) => ({ id: ['a', 'b', 'c'][i], name: ['Ada', 'Bora', 'Cem'][i], role: null, connected: true, host: i === 0, ...p })),
  ...over,
});

/** The opening tag of the first <button> whose text or label contains `text`. */
const buttonTag = (html: string, text: string): string => {
  const re = /<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<\/button>/g;
  const hit = (html.match(re) ?? []).find((b) => b.includes(text));
  if (!hit) throw new Error(`no button with "${text}" in ${html.slice(0, 200)}`);
  return hit.slice(0, hit.indexOf('>') + 1);
};

describe('Home', () => {
  it('asks for a name, offers create and join, and says what a code looks like', () => {
    const html = render(<Home />);
    expect(html).toContain(en['home.name.label']);
    expect(html).toContain(en['home.create']);
    expect(html).toContain(en['home.join.title']);
    expect(html).toContain(en['home.join.hint']);
    // not online yet in this render, so both actions are off
    expect(buttonTag(html, en['home.create'])).toContain('disabled');
    expect(html).toContain('maxLength="4"');
    expect(html).toContain('autoCapitalize="characters"');
  });
});

describe('Lobby', () => {
  it('the host cannot start alone, and is told why', () => {
    const html = render(<Lobby lobby={view({}, [{}])} />);
    expect(buttonTag(html, en['lobby.start'])).toContain('disabled');
    expect(html).toContain(en['lobby.start.needPlayers']);
  });

  it('the host can start with two connected players, but not when one of the two is offline', () => {
    const two = render(<Lobby lobby={view({}, [{}, {}])} />);
    expect(buttonTag(two, en['lobby.start'])).not.toContain('disabled');
    const offline = render(<Lobby lobby={view({}, [{}, { connected: false }])} />);
    expect(buttonTag(offline, en['lobby.start'])).toContain('disabled');
    // the offline player is marked in words, not only by colour
    expect(offline).toContain(en['lobby.player.offline']);
    expect(offline).toContain('data-connected="false"');
  });

  it('a guest has no start button, waits for the host and cannot change the mode', () => {
    const html = render(<Lobby lobby={view({ me: 'b' }, [{}, {}])} />);
    expect(html).not.toContain(en['lobby.start']);
    expect(html).toContain(en['lobby.start.waiting']);
    expect(html).toContain(en['lobby.mode.hostOnly']);
    expect(buttonTag(html, en['mode.short'])).toContain('disabled');
    const host = render(<Lobby lobby={view({}, [{}, {}])} />);
    expect(buttonTag(host, en['mode.short'])).not.toContain('disabled');
  });

  it('shows the roles with their names and descriptions from the dictionary, locks taken ones and marks mine', () => {
    const html = render(<Lobby lobby={view({}, [{ role: 'sage' }, { role: 'soldier' }])} />);
    for (const id of ['soldier', 'sage', 'sailor', 'diplomat', 'harvester']) {
      expect(html).toContain(en[`role.${id}.name` as keyof typeof en]);
      expect(html).toContain(en[`role.${id}.desc` as keyof typeof en].replace("'", '&#x27;'));
    }
    expect(buttonTag(html, en['role.sage.name'])).toContain('aria-pressed="true"');
    const soldier = buttonTag(html, en['role.soldier.name']);
    expect(soldier).toContain('aria-disabled="true"');
    expect(soldier).toContain('aria-pressed="false"');
    expect(html).toContain('Picked by Bora');
    expect(buttonTag(html, en['role.sailor.name'])).toContain('aria-disabled="false"');
  });

  it('shows the room code as one button that names itself for screen readers', () => {
    const html = render(<Lobby lobby={view({}, [{}, {}])} />);
    expect(html).toContain('K M T P');
    expect(html).toContain(en['lobby.code.hint']);
  });
});
