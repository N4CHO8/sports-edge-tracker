const ANALYSIS_SOURCE = "api-sports-football";
const DEFAULT_LAST_MATCHES = 20;
const FREE_PLAN_DETAIL_MATCH_CAP = 6;

function send(res, response, status = 200) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(response));
}

function requiredEnv() {
  return ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((name) => !process.env[name]);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.trim() ? JSON.parse(raw) : {};
}

async function supabaseFetch(path, options = {}) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      ...(options.headers ?? {})
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase ${response.status}: ${body}`);
  }

  const body = await response.text();
  return body.trim() ? JSON.parse(body) : null;
}

async function apiSportsFetch(path, params = {}) {
  const key = process.env.API_SPORTS_KEY || process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error("Falta API_SPORTS_KEY en Vercel");

  const url = new URL(`https://v3.football.api-sports.io/${path}`);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(name, String(value));
  }

  const response = await fetch(url, { headers: { "x-apisports-key": key } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`API-Sports ${response.status}: ${JSON.stringify(payload)}`);
  }
  if (payload?.errors && Object.keys(payload.errors).length) {
    throw new Error(`API-Sports error: ${JSON.stringify(payload.errors)}`);
  }

  return payload?.response ?? [];
}

function apiSportsErrorAllowsDateFallback(error) {
  return String(error?.message ?? "").toLowerCase().includes("last parameter");
}

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function pastDate(daysBack) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysBack);
  return date;
}

function recentSeasons() {
  const currentYear = new Date().getUTCFullYear();
  return Array.from({ length: 6 }, (_, index) => currentYear - index);
}

function uniqueFixtures(fixtures) {
  const seen = new Set();
  return fixtures.filter((fixture) => {
    const id = fixture.fixture?.id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function isOfficialFootballFixture(fixture) {
  const leagueName = String(fixture.league?.name ?? "").toLowerCase();
  return !leagueName.includes("friendly");
}

async function recentFootballFixtures(teamId, wantedMatches) {
  try {
    return await apiSportsFetch("fixtures", { team: teamId, last: wantedMatches });
  } catch (error) {
    if (!apiSportsErrorAllowsDateFallback(error)) throw error;
  }

  const lookbackDays = Number(process.env.API_SPORTS_LOOKBACK_DAYS || 1460);
  const allFixtures = [];
  for (const season of recentSeasons()) {
    const fixtures = await apiSportsFetch("fixtures", {
      team: teamId,
      season,
      from: formatIsoDate(pastDate(lookbackDays)),
      to: formatIsoDate(new Date())
    });
    allFixtures.push(...fixtures);
    const completed = uniqueFixtures(allFixtures)
      .filter(isOfficialFootballFixture)
      .filter((item) => ["FT", "AET", "PEN"].includes(item.fixture?.status?.short));
    if (completed.length >= wantedMatches) break;
  }

  return uniqueFixtures(allFixtures)
    .filter(isOfficialFootballFixture)
    .sort((a, b) => new Date(b.fixture?.date ?? 0) - new Date(a.fixture?.date ?? 0))
    .slice(0, wantedMatches);
}

function detailMatchLimit(lastMatches) {
  const configured = Number(process.env.API_SPORTS_DETAIL_MATCHES || FREE_PLAN_DETAIL_MATCH_CAP);
  const requested = Number.isFinite(configured) && configured > 0 ? configured : FREE_PLAN_DETAIL_MATCH_CAP;
  const allowHighDetail = String(process.env.API_SPORTS_ALLOW_HIGH_DETAIL ?? "false").toLowerCase() === "true";
  const cap = allowHighDetail ? lastMatches : FREE_PLAN_DETAIL_MATCH_CAP;
  return Math.min(requested, lastMatches, cap);
}

function average(values) {
  const numbers = values.map(Number).filter(Number.isFinite);
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
}

function percent(count, total) {
  return total ? Math.round((count / total) * 1000) / 10 : null;
}

function valueFromStat(statistics, names) {
  const wanted = names.map((name) => name.toLowerCase());
  const row = statistics.find((item) => wanted.includes(String(item.type).toLowerCase()));
  if (!row || row.value === null || row.value === undefined) return null;
  if (typeof row.value === "string" && row.value.endsWith("%")) return Number(row.value.replace("%", ""));
  return Number(row.value);
}

function teamSide(fixture, teamId) {
  return fixture.teams?.home?.id === teamId ? "home" : "away";
}

function matchResult(fixture, teamId) {
  const side = teamSide(fixture, teamId);
  const forGoals = Number(fixture.goals?.[side]);
  const againstGoals = Number(fixture.goals?.[side === "home" ? "away" : "home"]);
  if (!Number.isFinite(forGoals) || !Number.isFinite(againstGoals)) return null;
  if (forGoals > againstGoals) return "G";
  if (forGoals === againstGoals) return "E";
  return "P";
}

function hotFact(teamName, metrics) {
  if (metrics.scoredRate !== null && metrics.scoredRate >= 80) {
    return `${teamName} marco en ${metrics.scoredRate}% de sus ultimos ${metrics.matches} partidos.`;
  }
  if (metrics.bttsRate !== null && metrics.bttsRate >= 65) {
    return `${teamName} tuvo BTTS en ${metrics.bttsRate}% de la muestra.`;
  }
  if (metrics.over25Rate !== null && metrics.over25Rate >= 65) {
    return `${teamName} viene con tendencia Over 2.5 en ${metrics.over25Rate}% de la muestra.`;
  }
  return "Sin dato caliente suficiente.";
}

function lineForAverage(value, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return `over ${Math.max(0.5, Math.floor(value) + 0.5).toFixed(1)}`;
}

function estimateOutcome(home, away) {
  const homeScore = (home.winRate ?? 0) + (home.gfPerMatch ?? 0) * 10 - (home.gaPerMatch ?? 0) * 6;
  const awayScore = (away.winRate ?? 0) + (away.gfPerMatch ?? 0) * 10 - (away.gaPerMatch ?? 0) * 6;
  const drawBase = 24 + Math.max(0, 12 - Math.abs(homeScore - awayScore) / 3);
  const homeRaw = 40 + (homeScore - awayScore) / 2;
  const awayRaw = 40 + (awayScore - homeScore) / 2;
  const total = Math.max(1, homeRaw + awayRaw + drawBase);

  return {
    homeWin: Math.round((homeRaw / total) * 1000) / 10,
    draw: Math.round((drawBase / total) * 1000) / 10,
    awayWin: Math.round((awayRaw / total) * 1000) / 10,
    note: "Estimacion propia por forma reciente y goles, no dato oficial."
  };
}

async function findFootballTeam(teamName) {
  const results = await apiSportsFetch("teams", { search: teamName });
  return results.find((item) => item.team?.national) ?? results[0] ?? null;
}

async function footballFixtureStats(fixtureId, teamId) {
  const rows = await apiSportsFetch("fixtures/statistics", { fixture: fixtureId });
  const teamRow = rows.find((row) => row.team?.id === teamId);
  if (!teamRow) return {};

  const stats = teamRow.statistics ?? [];
  return {
    corners: valueFromStat(stats, ["Corner Kicks"]),
    yellowCards: valueFromStat(stats, ["Yellow Cards"]),
    redCards: valueFromStat(stats, ["Red Cards"]),
    possession: valueFromStat(stats, ["Ball Possession"]),
    shotsOnGoal: valueFromStat(stats, ["Shots on Goal"])
  };
}

async function footballTeamAnalysis(teamName) {
  const lastMatches = Number(process.env.API_SPORTS_LAST_MATCHES || DEFAULT_LAST_MATCHES);
  const statsMatches = detailMatchLimit(lastMatches);
  const team = await findFootballTeam(teamName);
  if (!team?.team?.id) {
    return { teamName, status: "insufficient_data", reason: "Equipo no encontrado en API-Football" };
  }

  const fixtures = await recentFootballFixtures(team.team.id, lastMatches);
  const completed = fixtures
    .filter((item) => ["FT", "AET", "PEN"].includes(item.fixture?.status?.short))
    .slice(0, lastMatches);

  const detailed = [];
  for (const fixture of completed.slice(0, statsMatches)) {
    try {
      detailed.push(await footballFixtureStats(fixture.fixture.id, team.team.id));
    } catch {
      detailed.push({});
    }
  }

  const goalsFor = [];
  const goalsAgainst = [];
  const results = [];
  let over25 = 0;
  let btts = 0;
  let scored = 0;

  for (const fixture of completed) {
    const side = teamSide(fixture, team.team.id);
    const forGoals = Number(fixture.goals?.[side]);
    const againstGoals = Number(fixture.goals?.[side === "home" ? "away" : "home"]);
    if (!Number.isFinite(forGoals) || !Number.isFinite(againstGoals)) continue;
    goalsFor.push(forGoals);
    goalsAgainst.push(againstGoals);
    if (forGoals + againstGoals > 2.5) over25 += 1;
    if (forGoals > 0 && againstGoals > 0) btts += 1;
    if (forGoals > 0) scored += 1;
    const result = matchResult(fixture, team.team.id);
    if (result) results.push(result);
  }

  const wins = results.filter((item) => item === "G").length;
  const draws = results.filter((item) => item === "E").length;
  const losses = results.filter((item) => item === "P").length;
  const cards = detailed.map((item) => Number(item.yellowCards || 0) + Number(item.redCards || 0)).filter(Number.isFinite);
  const corners = detailed.map((item) => item.corners).filter(Number.isFinite);
  const metrics = {
    team: team.team.name,
    providerId: team.team.id,
    matches: results.length,
    form5: results.slice(0, 5).join("-") || "sin datos suficientes",
    winRate: percent(wins, results.length),
    drawRate: percent(draws, results.length),
    lossRate: percent(losses, results.length),
    gfPerMatch: average(goalsFor),
    gaPerMatch: average(goalsAgainst),
    over25Rate: percent(over25, goalsFor.length),
    bttsRate: percent(btts, goalsFor.length),
    scoredRate: percent(scored, goalsFor.length),
    cornersFor: average(corners),
    cornersLine: lineForAverage(average(corners), "sin datos suficientes"),
    cardsFor: average(cards),
    cardsLine: lineForAverage(average(cards), "sin datos suficientes"),
    possession: average(detailed.map((item) => item.possession)),
    shotsOnGoal: average(detailed.map((item) => item.shotsOnGoal)),
    hotFact: null
  };
  metrics.hotFact = hotFact(metrics.team, metrics);

  return { status: results.length ? "ready" : "insufficient_data", ...metrics };
}

async function analyzeFootballEvent(event) {
  const [home, away] = await Promise.all([
    footballTeamAnalysis(event.home_name),
    footballTeamAnalysis(event.away_name)
  ]);
  const outcome = home.status === "ready" && away.status === "ready" ? estimateOutcome(home, away) : null;

  return {
    status: outcome ? "ready" : "insufficient_data",
    source: ANALYSIS_SOURCE,
    summary: {
      outcome,
      strongest: [home, away].filter((item) => item.hotFact && item.hotFact !== "Sin dato caliente suficiente.")[0]?.hotFact ?? "sin datos suficientes",
      disclaimer: "Estimacion para entretenimiento, no asesoramiento de apuestas."
    },
    teams: [home, away],
    diagnostics: {
      requestedTeams: [event.home_name, event.away_name],
      lastMatches: Number(process.env.API_SPORTS_LAST_MATCHES || DEFAULT_LAST_MATCHES),
      detailMatches: detailMatchLimit(Number(process.env.API_SPORTS_LAST_MATCHES || DEFAULT_LAST_MATCHES)),
      fallback: "Si el plan gratis bloquea last=20, se usa rango de fechas y se ordena localmente.",
      freePlanNote: "Para cuidar el cupo gratis, las estadisticas detalladas se limitan a 6 partidos por equipo salvo que API_SPORTS_ALLOW_HIGH_DETAIL=true.",
      consultedAt: new Date().toISOString()
    }
  };
}

async function getCachedAnalysis(eventId) {
  const rows = await supabaseFetch(`sports_analyses?event_id=eq.${encodeURIComponent(eventId)}&source=eq.${ANALYSIS_SOURCE}&order=calculated_at.desc&limit=1`);
  return rows?.[0] ?? null;
}

async function saveAnalysis(event, analysis) {
  const payload = [{
    event_id: event.id,
    sport: event.sport,
    source: analysis.source,
    status: analysis.status,
    summary: analysis.summary,
    teams: analysis.teams,
    diagnostics: analysis.diagnostics,
    calculated_at: new Date().toISOString()
  }];

  const rows = await supabaseFetch("sports_analyses?on_conflict=event_id,source", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(payload)
  });
  return rows?.[0] ?? payload[0];
}

async function missingConfigAnalysis(event) {
  const analysis = {
    source: ANALYSIS_SOURCE,
    status: "missing_config",
    summary: {
      disclaimer: "Falta configurar API_SPORTS_KEY en Vercel para calcular estadisticas reales."
    },
    teams: [],
    diagnostics: { missing: "API_SPORTS_KEY" }
  };
  return saveAnalysis(event, analysis);
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return send(response, { error: "Metodo no permitido" }, 405);
  }

  try {
    const missing = requiredEnv();
    if (missing.length) return send(response, { error: `Faltan variables en Vercel: ${missing.join(", ")}` }, 500);

    const body = await readJsonBody(request);
    if (!body.eventId) return send(response, { error: "Falta eventId" }, 400);

    const events = await supabaseFetch(`events?id=eq.${encodeURIComponent(body.eventId)}&limit=1`);
    const event = events?.[0];
    if (!event) return send(response, { error: "Evento no encontrado" }, 404);

    const cached = body.force ? null : await getCachedAnalysis(event.id);
    if (cached && cached.status === "ready") return send(response, { analysis: cached, cached: true });

    if (event.sport !== "football") {
      return send(response, {
        analysis: {
          event_id: event.id,
          sport: event.sport,
          source: "pending-integration",
          status: "insufficient_data",
          summary: { disclaimer: "Conector avanzado pendiente para este deporte." },
          teams: [],
          diagnostics: {}
        },
        cached: false
      });
    }

    if (!process.env.API_SPORTS_KEY && !process.env.API_FOOTBALL_KEY) {
      return send(response, { analysis: await missingConfigAnalysis(event), cached: false });
    }

    const analysis = await analyzeFootballEvent(event);
    const saved = await saveAnalysis(event, analysis);
    return send(response, { analysis: saved, cached: false });
  } catch (error) {
    console.error("analyze_error", {
      message: error?.message,
      stack: error?.stack?.split("\n").slice(0, 3).join(" | ")
    });
    return send(response, { error: error.message }, 500);
  }
}
