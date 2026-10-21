import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { Connection, type AckResult } from './connection';
import { initialState, reducer, type AppState, type Msg } from './store';

export interface Api {
  /** sends a request; a refusal is also shown as a notice */
  request: (event: string, payload?: unknown) => Promise<AckResult>;
  /** sends a request and leaves error handling to the caller */
  ask: (event: string, payload?: unknown) => Promise<AckResult>;
  retryNow: () => void;
  takeBack: () => void;
  dispatch: (m: Msg) => void;
}

interface AppValue {
  state: AppState;
  api: Api;
}

const Ctx = createContext<AppValue | null>(null);

export function AppProvider({ children, connection }: { children: ReactNode; connection?: Connection }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const conn = useRef<Connection | null>(connection ?? null);

  useEffect(() => {
    const c = conn.current ?? new Connection(dispatch);
    conn.current = c;
    c.start();
    return () => c.close();
  }, []);

  const ask = useCallback((event: string, payload?: unknown) => conn.current!.emit(event, payload), []);
  const request = useCallback(
    async (event: string, payload?: unknown) => {
      const r = await conn.current!.emit(event, payload);
      if (!r.ok) dispatch({ t: 'error', error: r.error });
      return r;
    },
    [],
  );
  const api = useMemo<Api>(
    () => ({
      ask,
      request,
      dispatch,
      retryNow: () => conn.current?.retryNow(),
      takeBack: () => conn.current?.takeBack(),
    }),
    [ask, request],
  );
  const value = useMemo(() => ({ state, api }), [state, api]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}
