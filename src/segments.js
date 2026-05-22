/**
 * Build ordered list of segments from detected silences.
 * Each silence >= threshold is replaced by a synthetic silence block.
 * Gaps between silences are "clip" segments kept from the source.
 */
export function buildSegments(silences, totalDuration) {
  const segs = [];
  let pos = 0;

  for (const s of silences) {
    if (s.start > pos + 0.02) {
      segs.push({ type: 'clip', start: pos, end: s.start });
    }
    segs.push({ type: 'silence' });
    pos = s.end !== null ? s.end : totalDuration;
  }

  if (pos < totalDuration - 0.02) {
    segs.push({ type: 'clip', start: pos, end: totalDuration });
  }

  return segs;
}
