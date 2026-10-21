import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PieceKind } from '@ada/game-core';
import { Board, type Pick } from '../board/Board';
import { NO_MODE, capturePieces, controlsFor, type Mode } from '../game/controls';
import { heldBack, heldTotal, useReducedMotion, useRollPresentation, visibleLog } from '../game/roll';
import { useT } from '../i18n/context';
import { useApp } from '../net/app';
import { ActionDock, type SheetName } from '../ui/ActionDock';
import { DiceTray } from '../ui/DiceTray';
import { CapturePanel, type PreviewState } from '../ui/CapturePanel';
import { HandBar } from '../ui/HandBar';
import { OfferBanner } from '../ui/OfferBanner';
import { LogList } from '../ui/LogList';
import { LastEvent, PlayerStrip } from '../ui/PlayerStrip';
import { CostsSheet, DiscardSheet, LogSheet, StealSheet } from './sheets/InfoSheets';
import { DevCardsSheet } from './sheets/DevCardsSheet';
import { GameOverSheet } from './sheets/GameOverSheet';
import { TradeSheet } from './sheets/TradeSheet';

/** px at the top of the board that stay free for the dice resting in the corner */
const DICE_INSET = 52;

const PIECES: Pick['kind'][] = ['road', 'settlement', 'city'];

/** The game: players on top, the board in the middle, the hand and the actions below (a side panel on a wide screen). */
export function GameScreen() {
  const t = useT();
  const { state, api } = useApp();
  const { view, legal } = state.game!;
  const lobby = state.lobby;
  const connected = useMemo(() => Object.fromEntries((lobby?.players ?? []).map((p) => [p.id, p.connected])), [lobby]);
  const isHost = lobby?.hostId === view.me;

  const [mode, setMode] = useState<Mode>(NO_MODE);
  const [pick, setPick] = useState<Pick | null>(null);
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const [tradeTab, setTradeTab] = useState<'bank' | 'players' | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [overOpen, setOverOpen] = useState(true);
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });
  const controls = useMemo(() => controlsFor(view, legal, mode), [view, legal, mode]);

  /* the dice picture: purely visual, it never holds back a button, a legal move or a sheet that the game itself needs (only the sheets a 7 opens wait for the dice to stop) */
  const reduced = useReducedMotion();
  const roll = useRollPresentation(state.lastRoll, state.rev, reduced);
  const shownLog = useMemo(() => visibleLog(state.log, roll), [state.log, roll.rolling, roll.roll]); // eslint-disable-line react-hooks/exhaustive-deps
  const holdMine = heldBack(roll, view.me);
  const holdCounts = useMemo(
    () => Object.fromEntries(view.players.map((p) => [p.id, heldTotal(heldBack(roll, p.id))])),
    [view.players, roll.rolling, roll.roll], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /** a build mode or a half-made choice does not outlive the moment it belongs to */
  const moment = `${view.turn}:${view.phase}:${view.current}`;
  useEffect(() => {
    setMode(NO_MODE);
    setPick(null);
    setPreview({ status: 'idle' });
  }, [moment]);

  const send = useCallback(
    async (action: Record<string, unknown>): Promise<boolean> => {
      setBusy(true);
      const r = await api.request('game:action', action);
      setBusy(false);
      return r.ok;
    },
    [api],
  );

  /* ---- capture: ask the server what the tapped piece would do ---- */
  const asked = useRef(0);
  useEffect(() => {
    if (mode.kind !== 'capture' || !pick || !PIECES.includes(pick.kind)) {
      setPreview({ status: 'idle' });
      return;
    }
    const n = ++asked.current;
    setPreview({ status: 'loading' });
    void api
      .ask('game:preview', { type: 'roleAction', name: 'capture', params: { kind: pick.kind, id: pick.id } })
      .then((r) => {
        if (n !== asked.current) return;
        setPreview(r.ok ? { status: 'ok', preview: r.preview as never } : { status: 'error', error: r.error });
      });
  }, [mode.kind, pick, api]);

  const label = (p: Pick): string => {
    if (p.kind === 'vertex') return t('board.vertex', { id: p.id });
    if (p.kind === 'edge') return t('board.edge', { id: p.id });
    if (p.kind === 'tile') return t('board.tile', { id: p.id });
    return t('board.piece', { piece: t(`piece.${p.kind as PieceKind}`), id: p.id });
  };

  const confirmable = pick && (mode.kind !== 'capture' || preview.status === 'ok');
  const confirm = async () => {
    if (!pick || !controls.intent) return;
    const action = controls.intent.action(pick);
    if (!action) return;
    if (await send(action as unknown as Record<string, unknown>)) {
      setPick(null);
      setMode(NO_MODE);
    }
  };
  const cancel = () => {
    setPick(null);
    setMode(NO_MODE);
  };

  const leave = async () => {
    const r = await api.request('room:leave');
    if (r.ok) api.dispatch({ t: 'leftRoom' });
  };

  const closeSheet = () => setSheet(null);

  return (
    <div className="game" data-phase={view.phase}>
      <header className="game-top">
        <PlayerStrip view={view} connected={connected} holdBack={holdCounts} />
        <LastEvent view={view} log={shownLog} connected={connected} rolling={roll.rolling} />
      </header>

      <div className="game-board" onPointerDownCapture={roll.skip}>
        <Board
          view={view}
          target={controls.intent?.target ?? null}
          selected={pick}
          onPick={(p) => setPick(p)}
          topInset={DICE_INSET}
          production={roll.highlight && roll.roll ? { hit: roll.roll.hitTiles, robbed: roll.roll.robbedTile } : null}
        />
        {roll.stage !== 'still' && roll.roll && <DiceTray dice={view.dice} stage={roll.stage} stageLayer />}
        <DiceTray dice={view.dice} stage={roll.stage} />
      </div>

      <div className="game-dock">
        {!controls.forced && sheet !== 'trade' && (
          <OfferBanner
            view={view}
            onOpen={() => {
              setTradeTab('players');
              setSheet('trade');
            }}
          />
        )}
        <HandBar view={view} onOpenCards={() => setSheet('cards')} holdBack={holdMine} gain={roll.highlight && roll.roll ? (roll.roll.gains[view.me] ?? null) : null} />
        <ActionDock
          controls={controls}
          mode={mode}
          selection={confirmable ? label(pick!) : null}
          busy={busy}
          onRoll={() => void send({ type: 'roll' })}
          onEnd={() => void send({ type: 'endTurn' })}
          onBuyCard={() => void send({ type: 'buyDevCard' })}
          onMode={(m) => {
            setMode(m);
            setPick(null);
          }}
          onSheet={(name) => {
            setTradeTab(undefined);
            setSheet(name);
          }}
          onConfirm={() => void confirm()}
          onCancel={cancel}
          onScores={() => setOverOpen(true)}
          extra={
            mode.kind === 'capture' ? (
              <CapturePanel
                view={view}
                picked={pick && PIECES.includes(pick.kind) ? { kind: pick.kind as PieceKind, id: pick.id } : null}
                state={preview}
                anyTargets={capturePieces(view, legal).length > 0}
              />
            ) : null
          }
        />
      </div>

      <aside className="game-log" aria-label={t('log.title')}>
        <h3>{t('log.title')}</h3>
        <LogList view={view} log={shownLog} />
      </aside>

      {controls.forced === 'discard' && !roll.rolling && <DiscardSheet view={view} legal={legal} send={send} />}
      {controls.forced === 'steal' && !roll.rolling && <StealSheet view={view} legal={legal} send={send} />}
      {!controls.forced && sheet === 'trade' && <TradeSheet view={view} legal={legal} onClose={closeSheet} send={send} initialTab={tradeTab} />}
      {!controls.forced && sheet === 'cards' && <DevCardsSheet view={view} legal={legal} onClose={closeSheet} onBuy={() => void send({ type: 'buyDevCard' })} send={send} />}
      {!controls.forced && sheet === 'costs' && <CostsSheet view={view} onClose={closeSheet} />}
      {!controls.forced && sheet === 'log' && <LogSheet view={view} log={shownLog} onClose={closeSheet} />}
      {view.phase === 'finished' && overOpen && (
        <GameOverSheet
          view={view}
          isHost={isHost}
          onClose={() => setOverOpen(false)}
          onLobby={() => void api.request('lobby:reset')}
          onLeave={() => void leave()}
        />
      )}
    </div>
  );
}
