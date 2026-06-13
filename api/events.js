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
  const capturedAt = new Date().toISOString();
  const ufcTime = now + 4 * 86400000;
  const footballTime = now + 2 * 86400000;
  const basketballTime = now + 86400000;
  const events = [
    {
      id: "demo-ufc-1",
      source_event_id: "demo-ufc-1",
      sport: "ufc",
      league: "UFC Fight Night",
      home_name: "Peleador A",
      away_name: "Peleador B",
      start_time: new Date(ufcTime).toISOString(),
      source: "demo"
    },
    {
      id: "demo-ufc-2",
      source_event_id: "demo-ufc-2",
      sport: "ufc",
      league: "UFC Fight Night",
      home_name: "Peleador C",
      away_name: "Peleador D",
      start_time: new Date(ufcTime + 45 * 60000).toISOString(),
      source: "demo"
    },
    {
      id: "demo-football-1",
      source_event_id: "demo-football-1",
      sport: "football",
      league: "Premier League",
      home_name: "Equipo Local",
      away_name: "Equipo Visita",
      start_time: new Date(footballTime).toISOString(),
      source: "demo"
    },
    {
      id: "demo-football-2",
      source_event_id: "demo-football-2",
      sport: "football",
      league: "Premier League",
      home_name: "Equipo Norte",
      away_name: "Equipo Sur",
      start_time: new Date(footballTime + 2 * 3600000).toISOString(),
      source: "demo"
    },
    {
      id: "demo-basketball-1",
      source_event_id: "demo-basketball-1",
      sport: "basketball",
      league: "NBA",
      home_name: "Basket Local",
      away_name: "Basket Visita",
      start_time: new Date(basketballTime).toISOString(),
      source: "demo"
    },
    {
      id: "demo-basketball-2",
      source_event_id: "demo-basketball-2",
      sport: "basketball",
      league: "NBA",
      home_name: "Canasta Este",
      away_name: "Canasta Oeste",
      start_time: new Date(basketballTime + 3 * 3600000).toISOString(),
      source: "demo"
    }
  ];

  const odds = [
    { event_id: "demo-ufc-1", source_event_id: "demo-ufc-1", bookmaker: "DemoBook", market: "h2h", selection: "Peleador B", odds_decimal: 2.35, captured_at: capturedAt },
    { event_id: "demo-ufc-1", source_event_id: "demo-ufc-1", bookmaker: "DemoBook", market: "h2h", selection: "Peleador A", odds_decimal: 1.62, captured_at: capturedAt },
    { event_id: "demo-ufc-2", source_event_id: "demo-ufc-2", bookmaker: "DemoBook", market: "h2h", selection: "Peleador C", odds_decimal: 2.7, captured_at: capturedAt },
    { event_id: "demo-football-1", source_event_id: "demo-football-1", bookmaker: "DemoBook", market: "h2h", selection: "Equipo Local", odds_decimal: 1.92, captured_at: capturedAt },
    { event_id: "demo-football-2", source_event_id: "demo-football-2", bookmaker: "DemoBook", market: "h2h", selection: "Equipo Sur", odds_decimal: 2.15, captured_at: capturedAt },
    { event_id: "demo-basketball-1", source_event_id: "demo-basketball-1", bookmaker: "DemoBook", market: "h2h", selection: "Basket Visita", odds_decimal: 2.55, captured_at: capturedAt },
    { event_id: "demo-basketball-2", source_event_id: "demo-basketball-2", bookmaker: "DemoBook", market: "h2h", selection: "Canasta Este", odds_decimal: 1.78, captured_at: capturedAt }
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
