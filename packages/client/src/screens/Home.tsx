import { useState, type FormEvent } from 'react';
import { NAME_MAX_LENGTH } from '@ada/protocol';
import { useT } from '../i18n/context';
import { useApp } from '../net/app';
import { storage } from '../net/storage';
import { HeaderButtons } from '../ui/HeaderButtons';
import { RulesSheet } from './sheets/RulesSheet';

const CODE_LENGTH = 4;

/** a little island of seven regions in the terrain colours, drawn once: the one memorable thing on the screen */
const HEX_R = 17;
const ISLAND: [number, number, string][] = [
  [0, 0, '#c9b88a'],
  [1, 0, '#2e6b45'],
  [0.5, 1, '#d8b342'],
  [-0.5, 1, '#8fb45a'],
  [-1, 0, '#b4572f'],
  [-0.5, -1, '#77808c'],
  [0.5, -1, '#2e6b45'],
];
const hexPoints = (cx: number, cy: number) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return `${(cx + HEX_R * Math.cos(a)).toFixed(1)},${(cy + HEX_R * Math.sin(a)).toFixed(1)}`;
  }).join(' ');

function Island() {
  const w = HEX_R * Math.sqrt(3);
  return (
    <svg className="home-island" viewBox="-60 -56 120 112" aria-hidden="true" focusable="false">
      {ISLAND.map(([x, y, fill], i) => (
        <polygon key={i} points={hexPoints(x * w, y * HEX_R * 1.5)} fill={fill} stroke="#0b2530" strokeWidth="2.5" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

/** Entry screen: a name, then create a room or join one with its code. */
export function Home() {
  const t = useT();
  const { state, api } = useApp();
  const [name, setName] = useState(() => storage.get('name') ?? '');
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<'name' | 'code' | null>(null);
  const [busy, setBusy] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const online = state.conn === 'online';

  const cleanName = name.replace(/\s+/g, ' ').trim();
  const validName = cleanName.length >= 1 && cleanName.length <= NAME_MAX_LENGTH;

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!validName) return setProblem('name');
    setProblem(null);
    storage.set('name', cleanName);
    setBusy(true);
    await api.request('room:create', { name: cleanName });
    setBusy(false);
  }

  async function join(e: FormEvent) {
    e.preventDefault();
    if (!validName) return setProblem('name');
    if (code.length !== CODE_LENGTH) return setProblem('code');
    setProblem(null);
    storage.set('name', cleanName);
    setBusy(true);
    await api.request('room:join', { code, name: cleanName });
    setBusy(false);
  }

  return (
    <main className="home">
      <div className="home-top">
        <HeaderButtons rules={false} />
      </div>

      <header className="home-hero">
        <Island />
        <h1 className="home-title">{t('app.name')}</h1>
        <p>{t('home.tagline')}</p>
      </header>

      <section className="card">
        <label htmlFor="name" className="field-label">
          {t('home.name.label')}
        </label>
        <input
          id="name"
          className="field"
          value={name}
          maxLength={NAME_MAX_LENGTH}
          placeholder={t('home.name.placeholder')}
          autoComplete="nickname"
          aria-invalid={problem === 'name'}
          aria-describedby={problem === 'name' ? 'name-problem' : undefined}
          onChange={(e) => setName(e.target.value)}
        />
        {problem === 'name' && (
          <p id="name-problem" className="field-problem" role="alert">
            {t('home.needName')}
          </p>
        )}
      </section>

      <form className="card" onSubmit={create}>
        <button type="submit" className="btn primary wide" disabled={busy || !online}>
          {t('home.create')}
        </button>
      </form>

      <form className="card" onSubmit={join} aria-labelledby="join-title">
        <h2 id="join-title">{t('home.join.title')}</h2>
        <label htmlFor="code" className="field-label">
          {t('home.join.label')}
        </label>
        <div className="row">
          <input
            id="code"
            className="field code-field"
            value={code}
            maxLength={CODE_LENGTH}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="KMTP"
            aria-describedby="code-hint"
            aria-invalid={problem === 'code'}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
          />
          <button type="submit" className="btn" disabled={busy || !online}>
            {t('home.join')}
          </button>
        </div>
        <p id="code-hint" className={problem === 'code' ? 'field-problem' : 'field-hint'} role={problem === 'code' ? 'alert' : undefined}>
          {problem === 'code' ? t('home.needCode') : t('home.join.hint')}
        </p>
      </form>

      <footer className="home-footer">
        <button type="button" className="btn quiet" data-action="rules" aria-haspopup="dialog" onClick={() => setRulesOpen(true)}>
          {t('rules.open')}
        </button>
      </footer>
      {rulesOpen && <RulesSheet onClose={() => setRulesOpen(false)} />}
    </main>
  );
}
