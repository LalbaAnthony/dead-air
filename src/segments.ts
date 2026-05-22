import type { Silence, Segment } from './types/index.js';

export function buildSegments(silences: Silence[], totalDuration: number): Segment[] {
  const segs: Segment[] = [];
  let pos = 0;

  for (let i = 0; i < silences.length; i++) {
    const s = silences[i];
    if (!s) continue;

    if (s.start > pos + 0.02) {
      segs.push({ type: 'clip', start: pos, end: s.start });
    }
    segs.push({ type: 'silence', index: i, start: s.start });
    pos = s.end !== null ? s.end : totalDuration;
  }

  if (pos < totalDuration - 0.02) {
    segs.push({ type: 'clip', start: pos, end: totalDuration });
  }

  return segs;
}
