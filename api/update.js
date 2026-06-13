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

function missingEnvVars() {
  return ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ODDS_API_KEY"].filter((name) => !process.env[name]);
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

async function fetchOddsApi(capturedAt) {
  const sportKeys = (process.env.ODDS_API_SPORT_KEYS || "mma_mixed_martial_arts,basketball_nba,soccer_usa_mls")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const regions = process.env.ODDS_API_REGIONS || "us,eu";
  const markets = process.env.ODDS_API_MARKETS || "h2h";
  const oddsFormat = process.env.ODDS_API_ODDS_FORMAT || "decimal";
  const events = [];
  const odds = [];
  const diagnostics = [];

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

  return { events, odds, diagnostics };
}

async function persistPayload(payload, capturedAt) {
  await supabaseFetch("refresh_runs", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify([{ source: "the-odds-api", created_at: capturedAt }])
  });

  if (!payload.events.length) {
    return { events: [], odds: [], diagnostics: payload.diagnostics ?? [] };
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
    diagnostics: payload.diagnostics ?? []
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
