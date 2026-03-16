import type { APIRoute } from "astro";
import { loadDashboardData } from "../lib/data/load-dashboard";

export const prerender = true;

export const GET: APIRoute = async () => {
  const dashboard = await loadDashboardData();

  return new Response(JSON.stringify(dashboard.einkSummary, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
};
