export const ALL_ACCOUNTS_ID = '__all__';

export interface AccountLike {
  openid: string;
  path: string;
  matchCount: number;
  customName?: string;
  nick?: string;
  tag?: string;
}

export function accountDisplayLabel(a: AccountLike, _unknownIndex?: number): string {
  const custom = a.customName?.trim();
  if (custom) return custom;
  if (a.nick && a.tag) return `${a.nick}#${a.tag}`;
  if (a.nick) return a.nick;
  return a.openid;
}

export function applyAccountOrder<T extends { openid: string }>(accounts: T[], order: string[]): T[] {
  const rank = new Map(order.map((openid, i) => [openid, i]));
  return [...accounts].sort((a, b) => {
    const ar = rank.get(a.openid);
    const br = rank.get(b.openid);
    if (ar !== undefined && br !== undefined) return ar - br;
    if (ar !== undefined) return -1;
    if (br !== undefined) return 1;
    return 0;
  });
}
