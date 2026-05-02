import type { DerivedSessionInsight, RaceContext, RaceDefinition } from "./types.ts";

const SITE_TIMEZONE = "America/Argentina/Buenos_Aires";

function roundPaceSeconds(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.round(value);
}

function formatPaceLabel(value: number | null): string | null {
  const rounded = roundPaceSeconds(value);

  if (rounded === null) {
    return null;
  }

  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")} /km`;
}

function parseRaceDate(date: string): Date | null {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function currentSiteDate(): string {
  const formatter = new Intl.DateTimeFormat("en", {
    timeZone: SITE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    return new Date().toISOString().slice(0, 10);
  }

  return `${year}-${month}-${day}`;
}

function dayDiff(referenceDate: string, targetDate: string): number | null {
  const reference = parseRaceDate(referenceDate);
  const target = parseRaceDate(targetDate);

  if (!reference || !target) {
    return null;
  }

  return Math.round((target.getTime() - reference.getTime()) / 86_400_000);
}

function phaseFromDays(daysToRace: number | null): { currentPhase: string; focusLabel: string } {
  if (daysToRace === null) {
    return {
      currentPhase: "General build",
      focusLabel: "No race on the calendar"
    };
  }

  if (daysToRace <= 7) {
    return {
      currentPhase: "Race week",
      focusLabel: "Freshness matters more than squeezing extra work in"
    };
  }

  if (daysToRace <= 14) {
    return {
      currentPhase: "Sharpen",
      focusLabel: "Keep the work specific and the recovery obvious"
    };
  }

  if (daysToRace <= 42) {
    return {
      currentPhase: "Specific build",
      focusLabel: "Specific sessions matter, but only if the easy days stay easy"
    };
  }

  if (daysToRace <= 70) {
    return {
      currentPhase: "Build phase",
      focusLabel: "Stack durable work before you get too specific"
    };
  }

  return {
    currentPhase: "Base phase",
    focusLabel: "Build range before the calendar starts dictating the week"
  };
}

function distanceLabel(distanceKm: number): string {
  if (distanceKm >= 20) {
    return "half-marathon";
  }

  if (distanceKm >= 14) {
    return "15K";
  }

  if (distanceKm >= 9.5) {
    return "10K";
  }

  return `${distanceKm.toFixed(0)}K`;
}

function chooseNextRace(referenceDate: string, completedThroughDate: string, races: RaceDefinition[]) {
  return races
    .map((race) => ({
      race,
      daysToRace: dayDiff(referenceDate, race.date)
    }))
    .filter((entry) => (
      entry.daysToRace !== null
      && entry.daysToRace >= 0
      && entry.race.date > completedThroughDate
    ))
    .sort((left, right) => {
      const priorityOrder = { A: 0, B: 1, C: 2 } as const;
      const dayOrder = (left.daysToRace ?? 9_999) - (right.daysToRace ?? 9_999);

      if (dayOrder !== 0) {
        return dayOrder;
      }

      return priorityOrder[left.race.priority] - priorityOrder[right.race.priority];
    })[0] ?? null;
}

function chooseMainGoal(referenceDate: string, completedThroughDate: string, races: RaceDefinition[]) {
  return races
    .map((race) => ({
      race,
      daysToRace: dayDiff(referenceDate, race.date)
    }))
    .filter((entry) => (
      entry.daysToRace !== null
      && entry.daysToRace >= 0
      && entry.race.date > completedThroughDate
    ))
    .sort((left, right) => {
      const priorityOrder = { A: 0, B: 1, C: 2 } as const;
      const priorityDiff = priorityOrder[left.race.priority] - priorityOrder[right.race.priority];

      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      return (left.daysToRace ?? 9_999) - (right.daysToRace ?? 9_999);
    })[0] ?? null;
}

function buildSessionRelevance(
  insight: DerivedSessionInsight | null,
  nextRace: RaceContext["nextRace"],
  currentPhase: string
): string {
  if (!insight) {
    return "No recent session insight is available yet.";
  }

  if (!nextRace) {
    if (insight.sessionIntentDetected === "Tempo session") {
      return "Useful threshold touch inside a general build, as long as the next day stays easy enough to absorb it.";
    }

    if (insight.sessionIntentDetected === "Long run") {
      return "Good durability work for a general build, with the main value coming from consistent aerobic time on feet.";
    }

    return "Useful support work inside a general build without forcing race specificity too early.";
  }

  const raceLabel = distanceLabel(nextRace.distanceKm);

  if (insight.sessionIntentDetected === "Race") {
    return `The last race is now banked. The build can shift toward ${nextRace.title}, with the next useful signal coming from how well recovery turns back into ${raceLabel} rhythm.`;
  }

  if (insight.sessionIntentDetected === "Long run") {
    return `This one matters directly for ${nextRace.title}. In this ${currentPhase.toLowerCase()}, the main value is building ${raceLabel} endurance without turning the finish into another quality effort.`;
  }

  if (insight.sessionIntentDetected === "Tempo session") {
    return `This fits the build for ${nextRace.title} well. The quality is useful now; the bigger question is whether the next sessions stay calm enough to let it count.`;
  }

  if (insight.sessionIntentDetected === "Easy run") {
    return `This run matters as support work for ${nextRace.title}. Its job is to protect the more specific sessions, not compete with them.`;
  }

  return `This session helps the ${nextRace.title} build if it keeps the week readable and leaves room for the more specific work ahead.`;
}

export function buildRaceContext(input: {
  latestSessionDate: string;
  derivedInsight: DerivedSessionInsight | null;
  races: RaceDefinition[];
}): RaceContext {
  const { derivedInsight, latestSessionDate, races } = input;
  const referenceDate = currentSiteDate();
  const nextRaceEntry = chooseNextRace(referenceDate, latestSessionDate, races);
  const mainGoalEntry = chooseMainGoal(referenceDate, latestSessionDate, races);
  const daysToRace = nextRaceEntry?.daysToRace ?? null;
  const targetPaceSecPerKm = nextRaceEntry?.race.goalTimeMin
    ? roundPaceSeconds((nextRaceEntry.race.goalTimeMin * 60) / nextRaceEntry.race.distanceKm)
    : null;
  const mainGoalTargetPaceSecPerKm = mainGoalEntry?.race.goalTimeMin
    ? roundPaceSeconds((mainGoalEntry.race.goalTimeMin * 60) / mainGoalEntry.race.distanceKm)
    : null;
  const phase = phaseFromDays(daysToRace);

  return {
    generatedAt: new Date().toISOString(),
    nextRace: nextRaceEntry
      ? {
        ...nextRaceEntry.race,
        daysToRace: nextRaceEntry.daysToRace ?? 0,
        targetPaceSecPerKm,
        targetPaceLabel: formatPaceLabel(targetPaceSecPerKm)
      }
      : null,
    mainGoal: mainGoalEntry
      ? {
        ...mainGoalEntry.race,
        daysToRace: mainGoalEntry.daysToRace ?? 0,
        targetPaceSecPerKm: mainGoalTargetPaceSecPerKm,
        targetPaceLabel: formatPaceLabel(mainGoalTargetPaceSecPerKm)
      }
      : null,
    daysToRace,
    targetPaceSecPerKm,
    targetPaceLabel: formatPaceLabel(targetPaceSecPerKm),
    currentPhase: phase.currentPhase,
    focusLabel: phase.focusLabel,
    sessionRelevance: buildSessionRelevance(derivedInsight, nextRaceEntry
      ? {
        ...nextRaceEntry.race,
        daysToRace: nextRaceEntry.daysToRace ?? 0,
        targetPaceSecPerKm,
        targetPaceLabel: formatPaceLabel(targetPaceSecPerKm)
      }
      : null, phase.currentPhase)
  };
}
