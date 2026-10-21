import { useState } from 'react';
import { savedName, type Net } from '../net';

export function Home({ net }: { net: Net }) {
  const [name, setName] = useState(savedName());
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = name.trim().length > 0;

  const run = async (fn: () => Promise<boolean>) => {
    setBusy(true);
    await fn();
    setBusy(false);
  };

  return (
    <main className="home">
      <h1 className="wordmark">Ada</h1>
      <p className="lede">Arkadaşlarınla oda koduyla oynanan ada kurma oyunu.</p>

      <label className="field">
        <span>Adın</span>
        <input value={name} maxLength={20} autoComplete="nickname" onChange={(e) => setName(e.target.value)} placeholder="Örn. Deniz" />
      </label>

      <button className="btn primary" disabled={!ready || busy || !net.connected} onClick={() => run(() => net.create(name.trim()))}>
        Oda kur
      </button>

      <div className="divider"><span>ya da</span></div>

      <form
        className="join-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && code.length === 4) void run(() => net.join(code, name.trim()));
        }}
      >
        <input
          className="code-input"
          value={code}
          maxLength={4}
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Oda kodu"
          placeholder="KODU"
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
        />
        <button className="btn" type="submit" disabled={!ready || code.length !== 4 || busy || !net.connected}>
          Odaya katıl
        </button>
      </form>
    </main>
  );
}
