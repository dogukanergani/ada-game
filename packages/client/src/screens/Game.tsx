import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PieceKind } from '@ada/game-core';
import { Board, type Pick } from '../board/Board';
import { NO_MODE, countHand, demolishPieces, controlsFor, type Mode } from '../game/controls';
import { defaultTab } from '../game/tradeView';
import { titleFor, type Surface } from '../game/notices';
import { heldBack, heldTotal, useRollPresentation, visibleLog } from '../game/roll';
import { useAnimationsEnabled } from '../audio';
import { useGameSounds } from '../audio/reactions';
import { useT } from '../i18n/context';
import { useApp } from '../net/app';
import { ActionDock, type SheetName } from '../ui/ActionDock';
import { DiceTray } from '../ui/DiceTray';
import { DemolishPanel, type PreviewState } from '../ui/DemolishPanel';
import { GameClock } from '../ui/GameClock';
import { TimerBar } from '../ui/TimerBar';
import { TeamBar } from '../ui/TeamBar';
import { HeaderButtons } from '../ui/HeaderButtons';
import { HandBar } from '../ui/HandBar';
import { NoticeBar, NoticeSlotProvider } from '../ui/NoticeBar';
import { LogList } from '../ui/LogList';
import { LastEvent } from '../ui/LastEvent';
import { Seats } from '../ui/Seats';
import { ProductionFlights } from '../ui/ProductionFlights';
import { CostsSheet, DiscardSheet, LogSheet, StealSheet } from './sheets/InfoSheets';
import { DevCardsSheet } from './sheets/DevCardsSheet';
import { GameOverSheet, endedByTime } from './sheets/GameOverSheet';
import { TradeSheet } from './sheets/TradeSheet';
import { GiftSheet } from './sheets/GiftSheet';
import { BuildSheet } from './sheets/BuildSheet';

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
  const [tradeTab, setTradeTab] = useState<'bank' | 'players'>('bank');
  const [busy, setBusy] = useState(false);
  const [overOpen, setOverOpen] = useState(true);
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });
  const controls = useMemo(() => controlsFor(view, legal, mode), [view, legal, mode]);

  /* the dice picture: purely visual, it never holds back a button, a legal move or a sheet that the game itself needs (only the sheets a 7 opens wait for the dice to stop) */
  const reduced = !useAnimationsEnabled();
  const roll = useRollPresentation(state.lastRoll, state.rev, reduced);
  const tableRef = useRef<HTMLDivElement>(null);
  const shownLog = useMemo(() => visibleLog(state.log, roll), [state.log, roll.rolling, roll.roll]); // eslint-disable-line react-hooks/exhaustive-deps
  useGameSounds(state.log, view.me, roll.roll, roll.highlight);
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

  /* ---- demolish: ask the server what the tapped piece would do ---- */
  const asked = useRef(0);
  useEffect(() => {
    if (mode.kind !== 'demolish' || !pick || !PIECES.includes(pick.kind)) {
      setPreview({ status: 'idle' });
      return;
    }
    const n = ++asked.current;
    setPreview({ status: 'loading' });
    void api
      .ask('game:preview', { type: 'roleAction', name: 'demolish', params: { kind: pick.kind, id: pick.id } })
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

  const confirmable = pick && (mode.kind !== 'demolish' || preview.status === 'ok');
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

  /* the team mode's gift button: on whenever the server lists a teammate to send to (any turn, any phase); otherwise it says why not */
  const myHand = view.players.find((p) => p.id === view.me)?.hand;
  const giftState = { enabled: legal.teamGiftTargets.length > 0, reason: t(myHand && countHand(myHand) === 0 ? 'gift.noCards' : 'gift.discardFirst') };

  /* notices (an open offer): shown on every surface that can cover the game, see game/notices.ts */
  const surface: Surface = { sheet, tradeTab };
  const openNotice = () => {
    setTradeTab('players');
    setSheet('trade');
  };
  const noticeBar = <NoticeBar view={view} surface={surface} onOpen={openNotice} />;
  const waiting = view.offers.filter((o) => o.from !== view.me).length;
  useEffect(() => {
    document.title = titleFor(view);
    return () => {
      document.title = titleFor(null);
    };
  }, [waiting]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <NoticeSlotProvider value={noticeBar}>
    <div className="game" data-phase={view.phase}>
      <header className="game-top">
        <LastEvent view={view} log={shownLog} connected={connected} rolling={roll.rolling} />
        <GameClock clock={state.clock} />
        <HeaderButtons locked={controls.forced !== null} vpToWin={view.vpToWin} />
        <TeamBar view={view} />
        <TimerBar view={view} clock={state.timerClock} />
      </header>

      <div className="game-table" data-players={view.players.length} ref={tableRef}>
        <Seats view={view} connected={connected} holdBack={holdCounts} which="opponents" />
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
        <Seats view={view} connected={connected} holdBack={holdCounts} which="me" />
        <ProductionFlights view={view} roll={roll.roll} active={roll.highlight} reduced={reduced} host={tableRef} />
      </div>

      <div className="game-dock">
        {!controls.forced && sheet === null && noticeBar}
        <HandBar view={view} onOpenCards={() => setSheet('cards')} holdBack={holdMine} gain={roll.highlight && roll.roll ? (roll.roll.gains[view.me] ?? null) : null} />
        <ActionDock
          controls={controls}
          mode={mode}
          selection={confirmable ? label(pick!) : null}
          busy={busy}
          moment={moment}
          deckCount={view.devDeckCount}
          gift={view.teamMode && view.phase !== 'finished' ? giftState : null}
          onRoll={() => void send({ type: 'roll' })}
          onEnd={() => void send({ type: 'endTurn' })}
          onBuyCard={() => void send({ type: 'buyDevCard' })}
          onMode={(m) => {
            setMode(m);
            setPick(null);
          }}
          onSheet={(name) => {
            if (name === 'trade') setTradeTab(defaultTab(view));
            setSheet(name);
          }}
          onConfirm={() => void confirm()}
          onCancel={cancel}
          onScores={() => setOverOpen(true)}
          extra={
            mode.kind === 'demolish' ? (
              <DemolishPanel
                view={view}
                picked={pick && PIECES.includes(pick.kind) ? { kind: pick.kind as PieceKind, id: pick.id } : null}
                state={preview}
                anyTargets={demolishPieces(view, legal).length > 0}
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
      {!controls.forced && sheet === 'build' && (
        <BuildSheet
          view={view}
          controls={controls}
          onClose={closeSheet}
          onPick={(piece) => {
            setSheet(null);
            setMode({ kind: 'build', piece });
            setPick(null);
          }}
        />
      )}
      {!controls.forced && sheet === 'trade' && <TradeSheet view={view} legal={legal} onClose={closeSheet} send={send} tab={tradeTab} onTab={setTradeTab} />}
      {!controls.forced && sheet === 'gift' && view.teamMode && <GiftSheet view={view} legal={legal} onClose={closeSheet} send={send} />}
      {!controls.forced && sheet === 'cards' && <DevCardsSheet view={view} legal={legal} onClose={closeSheet} onBuy={() => void send({ type: 'buyDevCard' })} send={send} />}
      {!controls.forced && sheet === 'costs' && <CostsSheet view={view} onClose={closeSheet} />}
      {!controls.forced && sheet === 'log' && <LogSheet view={view} log={shownLog} onClose={closeSheet} />}
      {view.phase === 'finished' && overOpen && (
        <GameOverSheet
          view={view}
          byTime={endedByTime(view, state.log)}
          isHost={isHost}
          onClose={() => setOverOpen(false)}
          onLobby={() => void api.request('lobby:reset')}
          onLeave={() => void leave()}
        />
      )}
    </div>
    </NoticeSlotProvider>
  );
}
