export function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(2).padStart(5, '0');
  return `${String(m).padStart(2, '0')}:${s}`;
}

export function fmtMB(bytes) {
  return (bytes / 1e6).toFixed(1) + ' MB';
}
