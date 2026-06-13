const SPORT_MAP = {
  mma: "ufc",
  ufc: "ufc",
  soccer: "football",
  football: "football",
  basketball: "basketball"
};

function send(res, response, status = 200) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(response));
}

function hasSupabaseEnv() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function normalizeSport(key) {
  const prefix = String(key).split("_")[0];
  return SPORT_MAP[prefix] ?? "football";
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

  return response.status === 204 ? null : response.json();
}

function demoPayload(capturedAt) {
  const now = Date.now();
  const events = [
    {
      source_event_id: `demo-ufc-${new Date().toISOString().slice(0, 10)}`,
      sport: "ufc",
      league: "UFC",
      home_name: "Peleador A",
      away_name: "Peleador B",
      start_time: new Date(now + 4 * 86400000).toISOString(),
      commence_time: new Date(now + 4 * 86400000).toISOString(),
      source: "demo"
    },
    {
      source_event_id: `demo-football-${new Date().toISOString().slice(0, 10)}`,
      sport: "football",
      league: "Premier League",
      home_name: "Equipo Local",
      away_name: "Equipo Visita",
      start_time: new Date(now + 2 * 86400000).toISOString(),
      commence_time: new Date(now + 2 * 86400000).toISOString(),
      source: "demo"
    },
    {
      source_event_id: `demo-basketball-${new Date().toISOString().slice(0, 10)}`,
      sport: "basketball",
      league: "NBA",
      home_name: "Basket Local",
      away_name: "Basket Visita",
      start_time: new Date(now + 86400000).toISOString(),
      commence_time: new Date(now + 86400000).toISOString(),
      source: "demo"
    }
  ];

  const odds = [
    { source_event_id: events[0].source_event_id, bookmaker: "DemoBook", market: "h2h", selection: "Peleador B", odds_decimal: 2.35, captured_at: capturedAt },
    { source_event_id: events[1].source_event_id, bookmaker: "DemoBook", market: "h2h", selection: "Equipo Local", odds_decimal: 1.92, captured_at: capturedAt },
    { source_event_id: events[2].source_event_id, bookmaker: "DemoBook", market: "h2h", selection: "Basket Visita", odds_decimal: 2.55, captured_at: capturedAt }
  ];

  return { events, odds };
}

async function fetchOddsApi(capturedAt) {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) return demoPayload(capturedAt);

  const sportKeys = (process.env.ODDS_API_SPORT_KEYS || "mma_mixed_martial_arts,basketball_nba,soccer_epl")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const regions = process.env.ODDS_API_REGIONS || "us,eu";
  const markets = process.env.ODDS_API_MARKETS || "h2h";
  const oddsFormat = process.env.ODDS_API_ODDS_FORMAT || "decimal";

  const events = [];
  const odds = [];

  for (const sportKey of sportKeys) {
    const url = new URL(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds`);
    url.searchParams.set("apiKey", apiKey);
    url.searchParams.set("regions", regions);
    url.searchParams.set("markets", markets);
    url.searchParams.set("oddsFormat", oddsFormat);

    const response = await fetch(url);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`The Odds API ${response.status}: ${body}`);
    }

    const items = await response.json();
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

  return { events, odds };
}

async function persistPayload(payload, capturedAt) {
  await supabaseFetch("refresh_runs", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify([{ source: payload.events[0]?.source ?? "demo", created_at: capturedAt }])
  });

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
    odds: oddsRows
  };
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return send(response, { error: "Metodo no permitido" }, 405);
  }

  try {
    const capturedAt = new Date().toISOString();
    const payload = await fetchOddsApi(capturedAt);

    if (!hasSupabaseEnv()) {
      return send(response, { ...payload, capturedAt, mode: "demo", persisted: false });
    }

    const persisted = await persistPayload(payload, capturedAt);
    return send(response, { ...persisted, capturedAt, mode: "supabase", persisted: true });
  } catch (error) {
    return send(response, { error: error.message }, 500);
  }
}
