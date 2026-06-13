function send(res, response, status = 200) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(response));
}

function hasSupabaseEnv() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
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

function demoData() {
  const now = Date.now();
  const events = [
    {
      id: "demo-ufc-1",
      source_event_id: "demo-ufc-1",
      sport: "ufc",
      league: "UFC",
      home_name: "Peleador A",
      away_name: "Peleador B",
      start_time: new Date(now + 4 * 86400000).toISOString(),
      source: "demo"
    },
    {
      id: "demo-football-1",
      source_event_id: "demo-football-1",
      sport: "football",
      league: "Premier League",
      home_name: "Equipo Local",
      away_name: "Equipo Visita",
      start_time: new Date(now + 2 * 86400000).toISOString(),
      source: "demo"
    },
    {
      id: "demo-basketball-1",
      source_event_id: "demo-basketball-1",
      sport: "basketball",
      league: "NBA",
      home_name: "Basket Local",
      away_name: "Basket Visita",
      start_time: new Date(now + 86400000).toISOString(),
      source: "demo"
    }
  ];

  const odds = [
    { event_id: "demo-ufc-1", source_event_id: "demo-ufc-1", bookmaker: "DemoBook", market: "h2h", selection: "Peleador B", odds_decimal: 2.35 },
    { event_id: "demo-football-1", source_event_id: "demo-football-1", bookmaker: "DemoBook", market: "h2h", selection: "Equipo Local", odds_decimal: 1.92 },
    { event_id: "demo-basketball-1", source_event_id: "demo-basketball-1", bookmaker: "DemoBook", market: "h2h", selection: "Basket Visita", odds_decimal: 2.55 }
  ];

  return { events, odds };
}

export default async function handler(request, response) {
  try {
    if (!hasSupabaseEnv()) {
      return send(response, { ...demoData(), mode: "demo", lastUpdated: null });
    }

    const [events, odds, runs] = await Promise.all([
      supabaseFetch("events?select=*&order=start_time.asc&limit=120"),
      supabaseFetch("odds_snapshots?select=*&order=captured_at.desc&limit=600"),
      supabaseFetch("refresh_runs?select=created_at&order=created_at.desc&limit=1")
    ]);

    return send(response, {
      events,
      odds,
      mode: "supabase",
      lastUpdated: runs?.[0]?.created_at ?? null
    });
  } catch (error) {
    return send(response, { error: error.message }, 500);
  }
}
