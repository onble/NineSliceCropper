/** Maps a CSS viewport coordinate to an integer source-image pixel boundary. */
export function displayToSourcePixel(
  clientPosition: number,
  displayStart: number,
  displayLength: number,
  sourceLength: number,
): number {
  if (displayLength <= 0 || sourceLength <= 0) {
    throw new RangeError('显示尺寸和源图尺寸必须大于 0。');
  }

  return Math.round(((clientPosition - displayStart) / displayLength) * sourceLength);
}

export function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}
