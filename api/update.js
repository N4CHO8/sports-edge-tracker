const SPORT_MAP = {
  mma: "ufc",
  ufc: "ufc",
  soccer: "football",
  football: "football",
  basketball: "basketball"
};
const DEFAULT_SPORT_KEYS = "mma_mixed_martial_arts,basketball_nba,soccer_fifa_world_cup";

function send(res, response, status = 200) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(response));
}

function missingEnvVars() {
  return ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ODDS_API_KEY"].filter((name) => !process.env[name]);
}

function normalizeSport(key) {
  const prefix = String(key).split("_")[0];
  return SPORT_MAP[prefix] ?? "football";
}

function normalizeSportKeys(keys) {
  const majorTournamentMode = String(process.env.ODDS_API_AUTO_MAJOR_TOURNAMENTS ?? "true").toLowerCase() !== "false";
  if (!majorTournamentMode) return Array.from(new Set(keys));

  const normalized = [...keys];
  const soccerIndex = normalized.findIndex((key) => key.startsWith("soccer_"));
  if (soccerIndex >= 0 && !normalized.includes("soccer_fifa_world_cup")) {
    normalized[soccerIndex] = "soccer_fifa_world_cup";
  }

  if (!normalized.some((key) => key.startsWith("soccer_"))) {
    normalized.push("soccer_fifa_world_cup");
  }

  const basketballIndex = normalized.findIndex((key) => key.startsWith("basketball_"));
  if (basketballIndex >= 0 && !normalized.includes("basketball_nba")) {
    normalized[basketballIndex] = "basketball_nba";
  }

  return Array.from(new Set(normalized));
}

function configuredSportKeys() {
  return normalizeSportKeys((process.env.ODDS_API_SPORT_KEYS || DEFAULT_SPORT_KEYS)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean));
}

function eventTimestamp(event) {
  const time = new Date(event.start_time).getTime();
  return Number.isFinite(time) ? time : null;
}

function isWithinLookahead(event, capturedAt) {
  const configuredDays = Number(process.env.ODDS_API_MAX_LOOKAHEAD_DAYS || 60);
  const maxDays = Number.isFinite(configuredDays) && configuredDays > 0 ? configuredDays : 60;
  const eventTime = eventTimestamp(event);
  if (eventTime === null) return false;

  const start = new Date(capturedAt).getTime() - 12 * 60 * 60 * 1000;
  const end = new Date(capturedAt).getTime() + maxDays * 24 * 60 * 60 * 1000;
  return eventTime >= start && eventTime <= end;
}

function hourBucket(value) {
  const date = new Date(value);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function normalizeName(value) {
  return decodeHtml(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sideMatchesOfficialName(officialSide, candidateName) {
  const official = normalizeName(officialSide);
  const candidate = normalizeName(candidateName);
  if (!official || official === "tbd" || !candidate) return false;
  if (candidate.includes(official)) return true;

  const officialParts = official.split(" ").filter(Boolean);
  return officialParts.length > 0 && officialParts.every((part) => candidate.includes(part));
}

function eventMatchesOfficialFight(event, fight) {
  const forward = sideMatchesOfficialName(fight.left, event.home_name)
    && sideMatchesOfficialName(fight.right, event.away_name);
  const reverse = sideMatchesOfficialName(fight.left, event.away_name)
    && sideMatchesOfficialName(fight.right, event.home_name);
  return forward || reverse;
}

async function fetchOfficialUfcFights() {
  if (String(process.env.ODDS_API_REQUIRE_UFC_OFFICIAL ?? "true").toLowerCase() === "false") {
    return { fights: [], skipped: true, warning: "Cruce oficial UFC desactivado" };
  }

  const url = process.env.UFC_EVENTS_URL || "https://www.ufc.com/events";
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; TodoAlVerde/1.0; +https://todoalverde.vercel.app)"
    }
  });

  if (!response.ok) {
    throw new Error(`UFC.com ${response.status}`);
  }

  const html = await response.text();
  const fights = [];
  const labels = html.matchAll(/data-fight-label="([^"]+)"/g);

  for (const match of labels) {
    const label = decodeHtml(match[1]).trim();
    const [left, right] = label.split(/\s+vs\.?\s+/i).map((side) => side?.trim());
    if (!left || !right || normalizeName(left) === "tbd" || normalizeName(right) === "tbd") continue;
    fights.push({ label, left, right });
  }

  return { fights, skipped: false };
}

function filterOfficialUfcEvents(events, officialFights) {
  if (!officialFights?.length) {
    return { events, removedCount: 0, removedSourceEventIds: [], matchedCount: 0, skipped: true };
  }

  const keptEvents = [];
  const removedSourceEventIds = [];
  let matchedCount = 0;

  for (const event of events) {
    if (event.sport !== "ufc") {
      keptEvents.push(event);
      continue;
    }

    if (officialFights.some((fight) => eventMatchesOfficialFight(event, fight))) {
      keptEvents.push({ ...event, league: "UFC" });
      matchedCount += 1;
    } else {
      removedSourceEventIds.push(event.source_event_id);
    }
  }

  return {
    events: keptEvents,
    removedCount: removedSourceEventIds.length,
    removedSourceEventIds,
    matchedCount,
    skipped: false
  };
}

function removeImpossibleCombatEvents(events) {
  const duplicatedParticipants = new Map();

  for (const event of events) {
    if (event.sport !== "ufc") continue;

    for (const participant of [event.home_name, event.away_name]) {
      if (!participant) continue;
      const key = `${participant}|${hourBucket(event.start_time)}`;
      if (!duplicatedParticipants.has(key)) duplicatedParticipants.set(key, new Set());
      duplicatedParticipants.get(key).add(event.source_event_id);
    }
  }

  const blockedEventIds = new Set();
  for (const eventIds of duplicatedParticipants.values()) {
    if (eventIds.size > 1) {
      for (const id of eventIds) blockedEventIds.add(id);
    }
  }

  return {
    events: events.filter((event) => !blockedEventIds.has(event.source_event_id)),
    removedCount: blockedEventIds.size,
    removedSourceEventIds: Array.from(blockedEventIds)
  };
}

function applyQualityFilters(events, odds, capturedAt, officialUfcFights) {
  const withinWindow = events.filter((event) => isWithinLookahead(event, capturedAt));
  const removedByWindow = events.length - withinWindow.length;
  const removedByWindowIds = events
    .filter((event) => !isWithinLookahead(event, capturedAt))
    .map((event) => event.source_event_id);
  const officialUfc = filterOfficialUfcEvents(withinWindow, officialUfcFights);
  const combat = removeImpossibleCombatEvents(officialUfc.events);
  const allowedIds = new Set(combat.events.map((event) => event.source_event_id));
  const removedSourceEventIds = Array.from(new Set([
    ...removedByWindowIds,
    ...officialUfc.removedSourceEventIds,
    ...combat.removedSourceEventIds
  ]));

  return {
    events: combat.events,
    odds: odds.filter((odd) => allowedIds.has(odd.source_event_id)),
    removedSourceEventIds,
    diagnostics: {
      removedByWindow,
      officialUfc,
      removedImpossibleCombatEvents: combat.removedCount
    }
  };
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

async function fetchOddsApi(capturedAt) {
  const sportKeys = configuredSportKeys();
  const regions = process.env.ODDS_API_REGIONS || "us,eu";
  const markets = process.env.ODDS_API_MARKETS || "h2h";
  const oddsFormat = process.env.ODDS_API_ODDS_FORMAT || "decimal";
  const events = [];
  const odds = [];
  const diagnostics = [];
  let officialUfcFights = [];
  let officialUfcWarning = null;

  try {
    const official = await fetchOfficialUfcFights();
    officialUfcFights = official.fights;
    if (official.warning) officialUfcWarning = official.warning;
    diagnostics.push({
      source: "ufc.com/events",
      officialFights: official.fights.length,
      skipped: official.skipped
    });
  } catch (error) {
    officialUfcWarning = `No se pudo cruzar con UFC.com: ${error.message}`;
    diagnostics.push({
      source: "ufc.com/events",
      officialFights: 0,
      warning: officialUfcWarning
    });
  }

  for (const sportKey of sportKeys) {
    const url = new URL(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds`);
    url.searchParams.set("apiKey", process.env.ODDS_API_KEY);
    url.searchParams.set("regions", regions);
    url.searchParams.set("markets", markets);
    url.searchParams.set("oddsFormat", oddsFormat);

    const apiResponse = await fetch(url);
    const body = await apiResponse.text();
    if (!apiResponse.ok) {
      throw new Error(`The Odds API ${apiResponse.status}: ${body}`);
    }

    if (!body.trim()) {
      diagnostics.push({ sportKey, events: 0, warning: "Respuesta vacia desde The Odds API" });
      continue;
    }

    let items;
    try {
      items = JSON.parse(body);
    } catch (error) {
      throw new Error(`The Odds API devolvio JSON invalido para ${sportKey}: ${error.message}`);
    }

    diagnostics.push({ sportKey, events: Array.isArray(items) ? items.length : 0 });

    for (const item of items) {
      const event = {
        source_event_id: item.id,
        sport: normalizeSport(sportKey),
        league: item.sport_title || sportKey,
        home_name: item.home_team,
        away_name: item.away_team,
        start_time: item.commence_time,
        source: "the-odds-api"
      };
      events.push(event);

      for (const bookmaker of item.bookmakers ?? []) {
        for (const market of bookmaker.markets ?? []) {
          for (const outcome of market.outcomes ?? []) {
            odds.push({
              source_event_id: item.id,
              bookmaker: bookmaker.title,
              market: market.key,
              selection: outcome.name,
              odds_decimal: outcome.price,
              captured_at: capturedAt
            });
          }
        }
      }
    }
  }

  const filtered = applyQualityFilters(events, odds, capturedAt, officialUfcFights);

  return {
    events: filtered.events,
    odds: filtered.odds,
    removedSourceEventIds: filtered.removedSourceEventIds,
    diagnostics: [
      ...diagnostics,
      { filter: "max_lookahead_days", removed: filtered.diagnostics.removedByWindow },
      {
        filter: "official_ufc_card_match",
        removed: filtered.diagnostics.officialUfc.removedCount,
        matched: filtered.diagnostics.officialUfc.matchedCount,
        skipped: filtered.diagnostics.officialUfc.skipped,
        warning: officialUfcWarning
      },
      { filter: "impossible_combat_duplicates", removed: filtered.diagnostics.removedImpossibleCombatEvents }
    ]
  };
}

async function deleteRemovedSourceEvents(sourceEventIds) {
  const ids = Array.from(new Set(sourceEventIds ?? [])).filter(Boolean);
  if (!ids.length) return 0;

  const encodedIds = ids.map((id) => encodeURIComponent(id)).join(",");
  await supabaseFetch(`events?source=eq.the-odds-api&source_event_id=in.(${encodedIds})`, {
    method: "DELETE",
    headers: { prefer: "return=minimal" }
  });

  return ids.length;
}

async function persistPayload(payload, capturedAt) {
  await supabaseFetch("refresh_runs", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify([{ source: "the-odds-api", created_at: capturedAt }])
  });

  const prunedEvents = await deleteRemovedSourceEvents(payload.removedSourceEventIds);

  if (!payload.events.length) {
    return { events: [], odds: [], diagnostics: payload.diagnostics ?? [], prunedEvents };
  }

  const savedEvents = await supabaseFetch("events?on_conflict=sport,source,source_event_id", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(payload.events.map((event) => ({
      source_event_id: event.source_event_id,
      sport: event.sport,
      league: event.league,
      home_name: event.home_name,
      away_name: event.away_name,
      start_time: event.start_time,
      source: event.source
    })))
  });

  const eventIdBySource = new Map(savedEvents.map((event) => [event.source_event_id, event.id]));
  const oddsRows = payload.odds
    .map((odd) => ({
      event_id: eventIdBySource.get(odd.source_event_id),
      source_event_id: odd.source_event_id,
      bookmaker: odd.bookmaker,
      market: odd.market,
      selection: odd.selection,
      odds_decimal: odd.odds_decimal,
      captured_at: odd.captured_at
    }))
    .filter((odd) => odd.event_id);

  if (oddsRows.length) {
    await supabaseFetch("odds_snapshots", {
      method: "POST",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify(oddsRows)
    });
  }

  return {
    events: savedEvents,
    odds: oddsRows,
    diagnostics: payload.diagnostics ?? [],
    prunedEvents
  };
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return send(response, { error: "Metodo no permitido" }, 405);
  }

  try {
    const missing = missingEnvVars();
    if (missing.length) {
      return send(response, {
        error: `Faltan variables en Vercel: ${missing.join(", ")}`
      }, 500);
    }

    const capturedAt = new Date().toISOString();
    const payload = await fetchOddsApi(capturedAt);
    const persisted = await persistPayload(payload, capturedAt);
    const message = persisted.events.length
      ? `Se guardaron ${persisted.events.length} eventos y ${persisted.odds.length} cuotas.`
      : `The Odds API no devolvio eventos para los deportes configurados: ${(persisted.diagnostics ?? []).map((item) => item.sportKey).join(", ")}`;

    return send(response, {
      ...persisted,
      capturedAt,
      message,
      mode: "real",
      persisted: true
    });
  } catch (error) {
    return send(response, { error: error.message }, 500);
  }
}
