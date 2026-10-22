/**
 * A role's emblem: a simple line drawing in a 24x24 box, drawn with the ink colour
 * on the seat's avatar. Roles are data; this table is the picture that goes with
 * each id, so a new role is a new entry and a role without one gets the neutral
 * ring (the core knows nothing of pictures).
 */
export interface Emblem {
  /** SVG path data, stroked (not filled) */
  paths: string[];
}

export const NEUTRAL_EMBLEM: Emblem = { paths: ['M12 4 a8 8 0 1 0 0.01 0 Z'] };

export const ROLE_EMBLEMS: Record<string, Emblem> = {
  /** a shield */
  soldier: { paths: ['M12 3 L20 6 V12 C20 16.5 16.5 20 12 21.5 C7.5 20 4 16.5 4 12 V6 Z', 'M12 8 V16'] },
  /** an open book */
  sage: { paths: ['M3.5 6 C6.5 5 9.5 5.3 12 7 C14.5 5.3 17.5 5 20.5 6 V18.5 C17.5 17.5 14.5 17.8 12 19.5 C9.5 17.8 6.5 17.5 3.5 18.5 Z', 'M12 7 V19.5'] },
  /** a sail on a hull */
  sailor: { paths: ['M12 3.5 V15 H18.5 Z', 'M10.5 7 L5.5 15 H10.5 Z', 'M3.5 17.5 H20.5 L18 21 H6 Z'] },
  /** a diamond with a point in it */
  diplomat: { paths: ['M12 3 L21 12 L12 21 L3 12 Z', 'M12 10.5 V13.5'] },
  /** a sprout */
  harvester: { paths: ['M12 21 V11', 'M12 11 C12 7 9 5 5 5 C5 9 8 11 12 11', 'M12 14 C12 10.5 15 8.5 19 8.5 C19 12.5 16 14 12 14'] },
};

export const emblemFor = (role: string): Emblem => ROLE_EMBLEMS[role] ?? NEUTRAL_EMBLEM;
