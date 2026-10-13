export function validateFileNameSuffix(value: string): string | null {
  if (value.trim().length === 0) {
    return '尾缀不能为空；如不需要尾缀，请关闭“添加文件名尾缀”。';
  }
  if (/[<>:"/\\|?*]/.test(value)) {
    return '尾缀不能包含文件名禁用字符：< > : " / \\ | ? *';
  }
  if (Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  })) {
    return '尾缀不能包含换行、制表符等控制字符。';
  }
  return null;
}

export function buildExportFileName(
  fileName: string,
  suffixEnabled: boolean,
  suffix: string,
  mirrorMode: 'none' | 'left' | 'right',
): string {
  const baseName = fileName.replace(/\.png$/i, '') || '图片';
  if (!suffixEnabled) {
    return `${baseName}.png`;
  }

  const error = validateFileNameSuffix(suffix);
  if (error !== null) {
    throw new RangeError(error);
  }

  const mirrorSuffix = mirrorMode === 'left'
    ? '-左侧镜像'
    : mirrorMode === 'right' ? '-右侧镜像' : '';
  return `${baseName}${mirrorSuffix}${suffix}.png`;
}
