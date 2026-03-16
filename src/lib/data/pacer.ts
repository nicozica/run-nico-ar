import { readJsonFile } from "./json.ts";
import { resolvePacerExportPath } from "./paths.ts";
import type { PacerActivity, PacerExport } from "./types.ts";

export const RUN_ACTIVITY_TYPES = new Set(["Run", "TrailRun", "VirtualRun"]);
export const RIDE_ACTIVITY_TYPES = new Set(["Ride", "VirtualRide", "EBikeRide"]);

export function getActivityType(activity: PacerActivity): string {
  return activity.sport_type ?? activity.type ?? "Activity";
}

export function isRunLike(activity: PacerActivity): boolean {
  return RUN_ACTIVITY_TYPES.has(getActivityType(activity));
}

export function isRideLike(activity: PacerActivity): boolean {
  return RIDE_ACTIVITY_TYPES.has(getActivityType(activity));
}

export function sortActivitiesDesc(activities: PacerActivity[]): PacerActivity[] {
  return [...activities].sort((left, right) => {
    return toTimestamp(right.start_date) - toTimestamp(left.start_date);
  });
}

export function toTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export async function readPacerExport(filePath = resolvePacerExportPath()): Promise<PacerExport | null> {
  return readJsonFile<PacerExport>(filePath);
}
