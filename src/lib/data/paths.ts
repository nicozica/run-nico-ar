import path from "node:path";

export const projectRoot = process.cwd();
export const dataDir = path.join(projectRoot, "data");
export const manualDataDir = path.join(dataDir, "manual");
export const mockDataDir = path.join(dataDir, "mocks");
export const currentDataDir = path.join(dataDir, "current");

const defaultPacerPath = "../pacer/storage/json/activities.latest.json";

export function resolvePacerExportPath(): string {
  const configured = process.env.PACER_EXPORT_PATH ?? defaultPacerPath;
  return path.resolve(projectRoot, configured);
}
