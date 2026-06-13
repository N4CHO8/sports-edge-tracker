function send(res, response, status = 200) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(response));
}

function missingEnvVars() {
  return ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((name) => !process.env[name]);
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

export default async function handler(request, response) {
  try {
    const missing = missingEnvVars();
    if (missing.length) {
      return send(response, {
        error: `Faltan variables en Vercel: ${missing.join(", ")}`
      }, 500);
    }

    const [events, odds, runs] = await Promise.all([
      supabaseFetch("events?select=*&order=start_time.asc&limit=240"),
      supabaseFetch("odds_snapshots?select=*&order=captured_at.desc&limit=1200"),
      supabaseFetch("refresh_runs?select=created_at&order=created_at.desc&limit=1")
    ]);

    return send(response, {
      events,
      odds,
      mode: "real",
      lastUpdated: runs?.[0]?.created_at ?? null
    });
  } catch (error) {
    return send(response, { error: error.message }, 500);
  }
}
