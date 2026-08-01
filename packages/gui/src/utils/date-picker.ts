/** Shared local-time boundary used by the date picker and match filters. */
export function endOfSelectedDayForFilter(date: Date): number {
  const end = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + 1,
  );
  end.setMilliseconds(-1);
  return end.getTime();
}
