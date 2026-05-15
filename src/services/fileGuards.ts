export const SUPPORTED_EXTENSIONS = ['.geojson', '.json', '.zip', '.shp'];

export function getFileExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex === -1 ? '' : fileName.slice(dotIndex).toLowerCase();
}

export function isSupportedGisFile(fileName: string) {
  return SUPPORTED_EXTENSIONS.includes(getFileExtension(fileName));
}
