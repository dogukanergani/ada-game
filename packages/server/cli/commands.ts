import { RESOURCES } from '@ada/game-core';

/** What a typed line asks for. Pure, so it can be tested without a socket. */
export type Command =
  | {
      kind: 'emit';
      event: string;
      payload?: unknown;
      /** a steal target typed as a name or id prefix, resolved against the game view before sending */
      victimRef?: string;
    }
  | { kind: 'local'; name: 'state' | 'map' | 'legal' | 'help' | 'quit' | 'autoplay' | 'whoami'; arg?: string }
  | { kind: 'error'; message: string };

const err = (message: string): Command => ({ kind: 'error', message });
const act = (action: Record<string, unknown>, victimRef?: string): Command => ({ kind: 'emit', event: 'game:action', payload: action, victimRef });
const num = (s: string | undefined): number | null => (s !== undefined && /^\d+$/.test(s) ? Number(s) : null);
const isRes = (s: string | undefined): s is string => !!s && (RESOURCES as readonly string[]).includes(s);

export const HELP = `Lobby:   create <name> | join <CODE> <name> | name <name> | role <role|none> | mode standard|short | start | reset | leave
Turn:    roll | end | settle <vertex> | city <vertex> | road <edge> | buy | bank <give> <get>
Robber:  robber <tile> | steal <player> | discard lumber=1,ore=2
Cards:   knight | roadbuilding | plenty <res> <res> | monopoly <res>
Trade:   offer give=wool:1 want=ore:1 | accept <offerId> | cancel <offerId>
Role:    capture <road|settlement|city> <id>
Other:   state | map | legal | autoplay [on|off] | whoami | raw <json action> | emit <event> <json> | help | quit
Resources: ${RESOURCES.join(', ')}`;

/** "wool:1,ore:2" or "wool=1" -> {wool:1, ore:2}; null when malformed. */
export function parseHand(text: string): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const part of text.split(',').filter(Boolean)) {
    const [k, v = '1'] = part.split(/[:=]/);
    if (!isRes(k) || !/^\d+$/.test(v)) return null;
    out[k] = (out[k] ?? 0) + Number(v);
  }
  return out;
}

export function parseCommand(line: string): Command | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const [cmd, ...rest] = trimmed.split(/\s+/);
  const a = rest[0];
  const restText = trimmed.slice(cmd.length).trim();
  switch (cmd.toLowerCase()) {
    case 'help':
    case '?':
      return { kind: 'local', name: 'help' };
    case 'quit':
    case 'exit':
      return { kind: 'local', name: 'quit' };
    case 'state':
    case 's':
      return { kind: 'local', name: 'state' };
    case 'map':
      return { kind: 'local', name: 'map' };
    case 'legal':
    case 'l':
      return { kind: 'local', name: 'legal' };
    case 'whoami':
      return { kind: 'local', name: 'whoami' };
    case 'autoplay':
      return { kind: 'local', name: 'autoplay', arg: a };

    case 'create':
      return restText ? { kind: 'emit', event: 'room:create', payload: { name: restText } } : err('usage: create <name>');
    case 'join':
      return a && rest.length > 1
        ? { kind: 'emit', event: 'room:join', payload: { code: a, name: rest.slice(1).join(' ') } }
        : err('usage: join <CODE> <name>');
    case 'name':
      return restText ? { kind: 'emit', event: 'lobby:setName', payload: { name: restText } } : err('usage: name <name>');
    case 'role':
      return a ? { kind: 'emit', event: 'lobby:setRole', payload: { role: a === 'none' ? null : a } } : err('usage: role <role|none>');
    case 'mode':
      return a === 'standard' || a === 'short' ? { kind: 'emit', event: 'lobby:setMode', payload: { mode: a } } : err('usage: mode standard|short');
    case 'start':
      return { kind: 'emit', event: 'lobby:start', payload: {} };
    case 'reset':
      return { kind: 'emit', event: 'lobby:reset', payload: {} };
    case 'leave':
      return { kind: 'emit', event: 'room:leave', payload: {} };

    case 'roll':
      return act({ type: 'roll' });
    case 'end':
      return act({ type: 'endTurn' });
    case 'buy':
      return act({ type: 'buyDevCard' });
    case 'knight':
      return act({ type: 'playKnight' });
    case 'roadbuilding':
      return act({ type: 'playRoadBuilding' });
    case 'settle': {
      const n = num(a);
      return n === null ? err('usage: settle <vertex id>') : act({ type: 'placeSettlement', vertex: n });
    }
    case 'city': {
      const n = num(a);
      return n === null ? err('usage: city <vertex id>') : act({ type: 'upgradeCity', vertex: n });
    }
    case 'road': {
      const n = num(a);
      return n === null ? err('usage: road <edge id>') : act({ type: 'placeRoad', edge: n });
    }
    case 'robber': {
      const n = num(a);
      return n === null ? err('usage: robber <tile id>') : act({ type: 'moveRobber', tile: n });
    }
    case 'steal':
      return a ? act({ type: 'steal', victim: a }, a) : err('usage: steal <player name or id>');
    case 'bank':
      return isRes(a) && isRes(rest[1]) ? act({ type: 'bankTrade', give: a, get: rest[1] }) : err('usage: bank <give> <get>');
    case 'plenty':
      return isRes(a) && isRes(rest[1]) ? act({ type: 'playYearOfPlenty', a, b: rest[1] }) : err('usage: plenty <res> <res>');
    case 'monopoly':
      return isRes(a) ? act({ type: 'playMonopoly', resource: a }) : err('usage: monopoly <res>');
    case 'discard': {
      const h = a ? parseHand(a) : null;
      return h ? act({ type: 'discard', resources: h }) : err('usage: discard lumber=1,ore=2');
    }
    case 'accept': {
      const n = num(a);
      return n === null ? err('usage: accept <offer id>') : act({ type: 'acceptTrade', offerId: n });
    }
    case 'cancel': {
      const n = num(a);
      return n === null ? err('usage: cancel <offer id>') : act({ type: 'cancelTrade', offerId: n });
    }
    case 'offer': {
      const give = rest.find((x) => x.startsWith('give='));
      const want = rest.find((x) => x.startsWith('want='));
      const g = give ? parseHand(give.slice(5)) : null;
      const w = want ? parseHand(want.slice(5)) : null;
      return g && w ? act({ type: 'offerTrade', give: g, want: w }) : err('usage: offer give=wool:1 want=ore:1');
    }
    case 'capture': {
      const n = num(rest[1]);
      return (a === 'road' || a === 'settlement' || a === 'city') && n !== null
        ? act({ type: 'roleAction', name: 'capture', params: { kind: a, id: n } })
        : err('usage: capture <road|settlement|city> <id>');
    }
    case 'raw':
    case 'emit': {
      const isEmit = cmd.toLowerCase() === 'emit';
      const jsonText = isEmit ? rest.slice(1).join(' ') : restText;
      const event = isEmit ? a : 'game:action';
      if (!event) return err('usage: emit <event> <json>');
      try {
        return { kind: 'emit', event, payload: jsonText ? JSON.parse(jsonText) : undefined };
      } catch {
        return err('not valid JSON');
      }
    }
    default:
      return err(`unknown command "${cmd}" (try: help)`);
  }
}
