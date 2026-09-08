// How long ago something happened, and how long it took, written the way a
// person would say it.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function count(many: number, one: string): string {
  return many === 1 ? `1 ${one}` : `${many} ${one}s`;
}

export function agoText(then: Date, now: Date): string {
  const since = now.getTime() - then.getTime();
  if (since < MINUTE) return 'just now';
  if (since < HOUR) return `${count(Math.floor(since / MINUTE), 'minute')} ago`;
  if (since < DAY) return `${count(Math.floor(since / HOUR), 'hour')} ago`;
  return `${count(Math.floor(since / DAY), 'day')} ago`;
}

// Anything under a minute is said in seconds, since reading a document takes
// seconds. A run that took no measurable time still says one second rather
// than none.
export function durationText(milliseconds: number): string {
  const seconds = Math.max(1, Math.round(milliseconds / 1000));
  if (seconds < 60) return count(seconds, 'second');
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0
    ? count(minutes, 'minute')
    : `${count(minutes, 'minute')} ${count(rest, 'second')}`;
}
