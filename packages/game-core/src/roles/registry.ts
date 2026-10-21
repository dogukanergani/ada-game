import { ROLE_DEFS } from './defs';
import type { RoleDef } from './types';

export const ROLE_LIST: readonly RoleDef[] = ROLE_DEFS;
export const ROLES: Record<string, RoleDef> = Object.fromEntries(ROLE_DEFS.map((d) => [d.id, d]));
export const isRoleId = (x: unknown): x is string => typeof x === 'string' && Object.hasOwn(ROLES, x);
export const roleOf = (s: { players: { id: string; role: string }[] }, pid: string): RoleDef =>
  ROLES[s.players.find((p) => p.id === pid)!.role];
