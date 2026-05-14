import type { APIRoute } from "astro";
import { buildEinkSummaryV3 } from "../lib/data/eink-v2.ts";
import { loadDashboardData } from "../lib/data/load-dashboard";

export const prerender = true;

export const GET: APIRoute = async () => {
  const dashboard = await loadDashboardData();
  const payload = buildEinkSummaryV3({
    latestSession: dashboard.latestSession,
    weeklySnapshot: dashboard.weeklySnapshot,
    nextRun: dashboard.nextRun
  });

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
};
