/**
 * Whether an in-flight get_match_rounds response may update the detail store.
 * If the user selected another match while the request was in flight, discard.
 */
export function shouldCommitMatchRounds(
  requestMatchId: string,
  currentMatchId: string | null | undefined,
  requestSelectionVersion: number,
  currentSelectionVersion: number,
): boolean {
  return !!currentMatchId
    && currentMatchId === requestMatchId
    && requestSelectionVersion === currentSelectionVersion;
}
