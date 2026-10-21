import type { Hand, PieceKind, Resource, RoleId, Rng } from './types';

/**
 * Roles plug into the rules through small, optional hooks. The core rules
 * call a hook at a well-defined moment and use its answer; they never
 * check for a specific role by name. To add a role: add an entry here.
 */
export interface RoleDef {
  id: RoleId;
  name: string;
  blurb: string;
  /** Bank trade ratio for giving `resource` (base is 4). */
  bankRatio?(base: number, resource: Resource): number;
  /** Cost of a piece for this player. */
  cost?(piece: PieceKind, base: Hand): Hand;
  /** Extra resources on a dice roll, given what the player already produced. */
  onProduce?(ctx: { gains: Hand; roll: number }): Partial<Hand>;
  /** Hand size above which the player must discard on a 7 (default 7). */
  discardLimit?: number;
  /** Extra resources when the player builds a settlement during the main phase. */
  onSettlementBuilt?(ctx: { adjacent: Resource[]; rng: Rng }): Partial<Hand>;
}

const defs: RoleDef[] = [
  {
    id: 'merchant',
    name: 'Tüccar',
    blurb: 'Bankayla takas 3’e 1 yapılır (herkeste 4’e 1).',
    bankRatio: (base) => Math.min(base, 3),
  },
  {
    id: 'architect',
    name: 'Mimar',
    blurb: 'Yol yapmak sadece 1 odun tutar.',
    cost: (piece, base) => (piece === 'road' ? { ...base, brick: 0 } : { ...base }),
  },
  {
    id: 'farmer',
    name: 'Çiftçi',
    blurb: 'Zarla buğday kazandığın her turda fazladan 1 buğday gelir.',
    onProduce: ({ gains }) => (gains.grain > 0 ? { grain: 1 } : {}),
  },
  {
    id: 'miner',
    name: 'Madenci',
    blurb: 'Zarla cevher kazandığın her turda fazladan 1 cevher gelir.',
    onProduce: ({ gains }) => (gains.ore > 0 ? { ore: 1 } : {}),
  },
  {
    id: 'hunter',
    name: 'Haydut Avcısı',
    blurb: '7 gelince elindeki kartları atmak zorunda kalmaz.',
    discardLimit: Infinity,
  },
  {
    id: 'explorer',
    name: 'Kâşif',
    blurb: 'Yerleşim kurunca komşu bölgelerden birinin kaynağını kazanır.',
    onSettlementBuilt: ({ adjacent, rng }) => {
      if (!adjacent.length) return {};
      const r = adjacent[Math.floor(rng() * adjacent.length)];
      return { [r]: 1 };
    },
  },
];

export const ROLES = Object.fromEntries(defs.map((d) => [d.id, d])) as Record<RoleId, RoleDef>;
export const ROLE_LIST: RoleDef[] = defs;
export const isRoleId = (x: unknown): x is RoleId => typeof x === 'string' && x in ROLES;
