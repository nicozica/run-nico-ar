import path from "node:path";

export const projectRoot = process.cwd();
export const dataDir = path.join(projectRoot, "data");
export const manualDataDir = path.join(dataDir, "manual");
export const mockDataDir = path.join(dataDir, "mocks");
export const currentDataDir = path.join(dataDir, "current");

const defaultPacerPath = "../pacer/storage/json/activities.latest.json";
const defaultPacerCmsDir = "../pacer/storage/json/cms";
const defaultPacerStorageDir = "../pacer/storage";

export function resolvePacerExportPath(): string {
  const configured = process.env.PACER_EXPORT_PATH ?? defaultPacerPath;
  return path.resolve(projectRoot, configured);
}

export function resolvePacerCmsSnapshotPath(fileName: string): string {
  const configuredDir = process.env.PACER_CMS_DIR ?? defaultPacerCmsDir;
  return path.resolve(projectRoot, configuredDir, fileName);
}

export function resolvePacerStoragePath(...parts: string[]): string {
  const configuredDir = process.env.PACER_STORAGE_DIR ?? defaultPacerStorageDir;
  return path.resolve(projectRoot, configuredDir, ...parts);
}
