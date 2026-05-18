export function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;

  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatBbox(bbox: [number, number, number, number] | null, fallback = 'N/A') {
  if (!bbox) return fallback;
  return bbox.map((value) => value.toFixed(5)).join(', ');
}
