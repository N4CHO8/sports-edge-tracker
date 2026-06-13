const refreshButton = document.querySelector("#refreshButton");
const statusText = document.querySelector("#statusText");
const lastUpdated = document.querySelector("#lastUpdated");
const modeText = document.querySelector("#modeText");
const groupsCount = document.querySelector("#groupsCount");
const eventsCount = document.querySelector("#eventsCount");
const oddsCount = document.querySelector("#oddsCount");
const bestSignal = document.querySelector("#bestSignal");
const groupsList = document.querySelector("#groupsList");
const groupsEmpty = document.querySelector("#groupsEmpty");
const detailHeader = document.querySelector("#detailHeader");
const detailBody = document.querySelector("#detailBody");
const searchInput = document.querySelector("#searchInput");
const tabs = Array.from(document.querySelectorAll(".tab"));
const APP_TIME_ZONE = "America/Santiago";

let state = {
  activeSport: "all",
  query: "",
  selectedGroupId: null,
  events: [],
  odds: [],
  analyses: [],
  mode: "real"
};

const sportLabels = {
  ufc: "UFC",
  football: "Futbol",
  basketball: "Basquetbol"
};

const groupLabels = {
  ufc: "Cartelera",
  football: "Jornada",
  basketball: "Jornada"
};

const sportAnalysisPlans = {
  football: {
    title: "Modelo futbol",
    source: "Recomendado: API-Football/API-Sports",
    prompt: "Ultimos 20 partidos oficiales por seleccion: 1X2 estimado, GF/GC, Over/Under 2.5, BTTS, corners, tarjetas, posesion, remates al arco, forma ultimos 5 y dato caliente.",
    missing: ["Corners a favor/contra", "Tarjetas y arbitro", "Posesion", "Remates al arco", "BTTS historico"]
  },
  basketball: {
    title: "Modelo basquetbol",
    source: "Recomendado: nba_api o API-NBA",
    prompt: "Ultimos 20 partidos: probabilidad estimada de victoria/derrota, puntos a favor/contra, pace, rating ofensivo/defensivo, triples, rebotes, perdidas, forma ultimos 5 y jugador caliente.",
    missing: ["Box scores historicos", "Pace", "Ratings", "Jugadores disponibles", "Props por jugador"]
  },
  ufc: {
    title: "Modelo UFC",
    source: "Recomendado: UFCStats scraper",
    prompt: "Ultimas peleas oficiales por peleador: probabilidad estimada, metodo de victoria/derrota, sumisiones, KO/TKO, decisiones, golpes significativos, derribos, defensa, forma y dato caliente.",
    missing: ["Metodo de victoria", "Sumisiones", "KO/TKO", "Derribos", "Golpes significativos"]
  }
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function dayKey(value) {
  if (!value) return "sin-fecha";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(value));
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: APP_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatDay(value) {
  if (!value || value === "sin-fecha") return "Sin fecha";
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: "UTC",
    weekday: "short",
    day: "2-digit",
    month: "short"
  }).format(new Date(`${value}T12:00:00Z`));
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "-";
  return `${Math.round(value * 1000) / 10}%`;
}

function impliedProbability(odds) {
  const number = Number(odds);
  return number > 0 ? 1 / number : null;
}

function eventName(event) {
  return `${event.home_name ?? "Local"} vs ${event.away_name ?? "Visita"}`;
}

function latestOddsForEvent(event) {
  const rows = oddsForEvent(event);
  const latest = new Map();

  for (const odd of rows) {
    const key = `${odd.bookmaker}|${odd.market}|${odd.selection}`;
    const previous = latest.get(key);
    if (!previous || new Date(odd.captured_at ?? 0) >= new Date(previous.captured_at ?? 0)) {
      latest.set(key, odd);
    }
  }

  return Array.from(latest.values()).sort((a, b) => Number(b.odds_decimal) - Number(a.odds_decimal));
}

function oddsForEvent(event) {
  return state.odds.filter((odd) => odd.event_id === event.id || odd.source_event_id === event.source_event_id);
}

function getBestOdd(event) {
  const rows = latestOddsForEvent(event);
  const moneylineRows = rows.filter((odd) => odd.market === "h2h" && isSummarySelection(event, odd.selection));
  return moneylineRows[0] ?? rows[0] ?? null;
}

function isSummarySelection(event, selection) {
  return !(event.sport === "ufc" && normalizeSelection(selection) === "draw");
}

function normalizeSelection(value) {
  return String(value ?? "").trim().toLowerCase();
}

function average(values) {
  const numbers = values.map(Number).filter(Number.isFinite);
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
}

function uniqueCount(rows, key) {
  return new Set(rows.map((row) => row[key]).filter(Boolean)).size;
}

function averageOddsForSelection(rows, selection) {
  return average(rows.filter((row) => row.selection === selection).map((row) => row.odds_decimal));
}

function formatMovement(value) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.01) return "Sin cambio";
  const direction = value > 0 ? "Subio" : "Bajo";
  return `${direction} ${Math.abs(value).toFixed(2)}`;
}

function marketStatsForEvent(event) {
  const rows = oddsForEvent(event).sort((a, b) => new Date(a.captured_at ?? 0) - new Date(b.captured_at ?? 0));
  const latestRows = latestOddsForEvent(event).filter((odd) => odd.market === "h2h" && isSummarySelection(event, odd.selection));
  const selections = Array.from(new Set(latestRows.map((odd) => odd.selection).filter(Boolean)));
  const selectionStats = selections.map((selection) => {
    const latestAverage = averageOddsForSelection(latestRows, selection);
    const firstCapture = rows.find((row) => row.selection === selection)?.captured_at;
    const firstRows = rows.filter((row) => row.selection === selection && row.captured_at === firstCapture);
    const firstAverage = averageOddsForSelection(firstRows, selection);

    return {
      selection,
      odds: latestAverage,
      probability: impliedProbability(latestAverage),
      movement: Number.isFinite(latestAverage) && Number.isFinite(firstAverage) ? latestAverage - firstAverage : null
    };
  }).sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0));

  return {
    snapshots: uniqueCount(rows, "captured_at"),
    bookmakers: uniqueCount(latestRows, "bookmaker"),
    favorite: selectionStats[0] ?? null,
    selections: selectionStats
  };
}

function signalFor(odd) {
  if (!odd) return { label: "Sin cuota", className: "low" };
  const odds = Number(odd.odds_decimal);
  if (odds >= 2.4) return { label: "Revisar valor", className: "good" };
  if (odds >= 1.75) return { label: "Seguimiento", className: "watch" };
  return { label: "Baja paga", className: "low" };
}

function matchesSearch(event) {
  const haystack = `${event.league ?? ""} ${eventName(event)} ${event.source ?? ""}`.toLowerCase();
  return haystack.includes(state.query.toLowerCase());
}

function filteredEvents() {
  return state.events.filter((event) => {
    const matchesSport = state.activeSport === "all" || event.sport === state.activeSport;
    return matchesSport && matchesSearch(event);
  });
}

function groupEvents(events) {
  const map = new Map();

  for (const event of events) {
    const date = dayKey(event.start_time);
    const league = event.league || "Sin liga";
    const key = `${event.sport}|${league}|${date}`;

    if (!map.has(key)) {
      map.set(key, {
        id: key,
        sport: event.sport,
        league,
        date,
        events: []
      });
    }

    map.get(key).events.push(event);
  }

  return Array.from(map.values())
    .map((group) => ({
      ...group,
      events: group.events.sort((a, b) => new Date(a.start_time ?? 0) - new Date(b.start_time ?? 0)),
      bestOdd: group.events.map(getBestOdd).filter(Boolean).sort((a, b) => Number(b.odds_decimal) - Number(a.odds_decimal))[0] ?? null
    }))
    .sort((a, b) => {
      const aTime = new Date(`${a.date === "sin-fecha" ? "9999-12-31" : a.date}T12:00:00`).getTime();
      const bTime = new Date(`${b.date === "sin-fecha" ? "9999-12-31" : b.date}T12:00:00`).getTime();
      return aTime - bTime || a.league.localeCompare(b.league);
    });
}

function groupTitle(group) {
  const kind = groupLabels[group.sport] ?? "Evento";
  return `${kind} ${sportLabels[group.sport] ?? group.sport}`;
}

function renderGroupCard(group) {
  const active = group.id === state.selectedGroupId ? " active" : "";
  const signal = signalFor(group.bestOdd);
  const best = group.bestOdd ? `${escapeHtml(group.bestOdd.selection)} ${Number(group.bestOdd.odds_decimal).toFixed(2)}` : "Sin cuotas";

  return `
    <button class="group-card${active}" type="button" data-group-id="${escapeHtml(group.id)}">
      <div class="group-card-top">
        <span class="sport-pill ${escapeHtml(group.sport)}">${escapeHtml(sportLabels[group.sport] ?? group.sport)}</span>
        <span class="group-date">${escapeHtml(formatDay(group.date))}</span>
      </div>
      <strong>${escapeHtml(groupTitle(group))}</strong>
      <span class="group-league">${escapeHtml(group.league)}</span>
      <div class="group-card-bottom">
        <span>${group.events.length} ${group.sport === "ufc" ? "peleas" : "partidos"}</span>
        <span class="signal-pill ${signal.className}">${best}</span>
      </div>
    </button>
  `;
}

function renderOddsTable(event) {
  const odds = latestOddsForEvent(event);

  if (!odds.length) {
    return `<div class="odds-empty">Todavia no hay cuotas guardadas para este evento.</div>`;
  }

  return `
    <div class="odds-table">
      <div class="odds-row odds-head">
        <span>Casa</span>
        <span>Mercado</span>
        <span>Seleccion</span>
        <span>Cuota</span>
        <span>Prob.</span>
      </div>
      ${odds.map((odd) => `
        <div class="odds-row">
          <span>${escapeHtml(odd.bookmaker)}</span>
          <span>${escapeHtml(odd.market)}</span>
          <span>${escapeHtml(odd.selection)}</span>
          <strong>${Number(odd.odds_decimal).toFixed(2)}</strong>
          <span>${formatPercent(impliedProbability(odd.odds_decimal))}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderMarketStats(event) {
  const stats = marketStatsForEvent(event);
  const favorite = stats.favorite;

  return `
    <div class="analysis-grid">
      <div>
        <span class="label">Favorito por mercado</span>
        <strong>${favorite ? escapeHtml(favorite.selection) : "-"}</strong>
      </div>
      <div>
        <span class="label">Prob. implicita</span>
        <strong>${favorite ? formatPercent(favorite.probability) : "-"}</strong>
      </div>
      <div>
        <span class="label">Movimiento cuota</span>
        <strong>${favorite ? escapeHtml(formatMovement(favorite.movement)) : "-"}</strong>
      </div>
      <div>
        <span class="label">Historico</span>
        <strong>${stats.snapshots} capturas / ${stats.bookmakers} casas</strong>
      </div>
    </div>
    ${stats.selections.length ? `
      <div class="selection-stats">
        ${stats.selections.map((item) => `
          <div class="selection-stat">
            <span>${escapeHtml(item.selection)}</span>
            <strong>${formatPercent(item.probability)}</strong>
            <small>${escapeHtml(formatMovement(item.movement))}</small>
          </div>
        `).join("")}
      </div>
    ` : ""}
  `;
}

function renderResearchPlan(event) {
  const plan = sportAnalysisPlans[event.sport];
  if (!plan) return "";
  const analysis = analysisForEvent(event);
  const isReady = analysis?.status === "ready";
  const isMissingConfig = analysis?.status === "missing_config";
  const chipClass = isReady ? "ready" : isMissingConfig ? "warning" : "missing";
  const chipText = isReady ? "Datos reales" : isMissingConfig ? "Falta API key" : "Sin datos suficientes";

  return `
    <div class="research-panel">
      <div class="research-head">
        <div>
          <span class="label">${escapeHtml(plan.title)}</span>
          <strong>Informe avanzado</strong>
        </div>
        <span class="data-chip ${chipClass}">${chipText}</span>
      </div>
      ${isReady ? renderAnalysisResult(analysis) : `
        <p>${escapeHtml(isMissingConfig ? analysis.summary?.disclaimer : plan.prompt)}</p>
        <div class="research-foot">
          <span>${escapeHtml(plan.source)}</span>
          <span>Faltan: ${plan.missing.map(escapeHtml).join(", ")}</span>
        </div>
        <button class="secondary-button analyze-button" type="button" data-event-id="${escapeHtml(event.id)}">
          ${event.sport === "football" ? "Calcular analisis con API" : "Conector pendiente"}
        </button>
      `}
    </div>
  `;
}

function analysisForEvent(event) {
  return state.analyses
    .filter((analysis) => analysis.event_id === event.id)
    .sort((a, b) => new Date(b.calculated_at ?? 0) - new Date(a.calculated_at ?? 0))[0] ?? null;
}

function formatNumber(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "sin datos";
}

function percentText(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.round(number * 10) / 10}%` : "sin datos";
}

function formResultLabel(result) {
  return {
    G: "Gano",
    E: "Empato",
    P: "Perdio"
  }[result] ?? result;
}

function renderFormBadges(form) {
  if (!form || form === "sin datos suficientes") return `<span class="form-empty">Sin forma reciente</span>`;
  return form.split("-").map((result) => `
    <span class="form-badge ${escapeHtml(result.toLowerCase())}" title="${escapeHtml(formResultLabel(result))}">
      ${escapeHtml(result)}
    </span>
  `).join("");
}

function outcomeSummary(outcome) {
  if (!outcome) return "";
  const options = [
    { label: "gana el local", value: Number(outcome.homeWin) },
    { label: "empate", value: Number(outcome.draw) },
    { label: "gana la visita", value: Number(outcome.awayWin) }
  ].filter((item) => Number.isFinite(item.value));
  const best = options.sort((a, b) => b.value - a.value)[0];
  return best ? `Lectura rapida: el resultado mas probable segun el modelo es que ${best.label} (${percentText(best.value)}).` : "";
}

function analysisStat(label, value, hint = "") {
  return `
    <div class="analysis-stat">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${hint ? `<small>${escapeHtml(hint)}</small>` : ""}
    </div>
  `;
}

function teamRead(team) {
  const scoredRate = Number(team.scoredRate);
  const overRate = Number(team.over25Rate);
  if (Number.isFinite(scoredRate) && scoredRate >= 80) return "Viene marcando con mucha frecuencia.";
  if (Number.isFinite(overRate) && overRate >= 55) return "Sus partidos tienden a tener varios goles.";
  return "Lectura conservadora: revisar junto con cuotas y contexto del partido.";
}

function renderAnalysisResult(analysis) {
  const outcome = analysis.summary?.outcome;
  const teams = Array.isArray(analysis.teams) ? analysis.teams : [];

  return `
    ${outcome ? `
      <div class="probability-strip">
        <span class="probability-pill green">Gana local ${percentText(outcome.homeWin)}</span>
        <span class="probability-pill yellow">Empate ${percentText(outcome.draw)}</span>
        <span class="probability-pill red">Gana visita ${percentText(outcome.awayWin)}</span>
      </div>
      <p class="analysis-note">${escapeHtml(outcomeSummary(outcome))}</p>
      <p class="analysis-disclaimer">${escapeHtml(outcome.note ?? analysis.summary?.disclaimer ?? "")}</p>
    ` : `<p>${escapeHtml(analysis.summary?.disclaimer ?? "sin datos suficientes")}</p>`}
    <div class="team-analysis-list">
      ${teams.map((team) => `
        <div class="team-analysis">
          <div class="team-analysis-head">
            <div>
              <strong>${escapeHtml(team.team ?? team.teamName ?? "Equipo")}</strong>
              <span>${escapeHtml(teamRead(team))}</span>
            </div>
            <div class="form-strip" aria-label="Forma ultimos 5 partidos">
              ${renderFormBadges(team.form5)}
            </div>
          </div>
          <div class="analysis-mini-grid">
            ${analysisStat("Goles a favor", formatNumber(team.gfPerMatch), "promedio por partido")}
            ${analysisStat("Goles en contra", formatNumber(team.gaPerMatch), "promedio recibido")}
            ${analysisStat("Mas de 2.5 goles", percentText(team.over25Rate), "partidos con 3+ goles")}
            ${analysisStat("Ambos anotan", percentText(team.bttsRate), "los dos equipos marcaron")}
            ${analysisStat("Corners a favor", formatNumber(team.cornersFor), team.cornersLine ?? "sin linea")}
            ${analysisStat("Tarjetas propias", formatNumber(team.cardsFor), team.cardsLine ?? "sin linea")}
            ${analysisStat("Posesion", percentText(team.possession), "promedio de la muestra")}
            ${analysisStat("Remates al arco", formatNumber(team.shotsOnGoal), "promedio por partido")}
          </div>
          <p class="hot-fact"><span>Dato fuerte:</span> ${escapeHtml(team.hotFact ?? "Sin dato caliente suficiente.")}</p>
        </div>
      `).join("")}
    </div>
  `;
}

function renderEventDetail(event) {
  const bestOdd = getBestOdd(event);
  const signal = signalFor(bestOdd);

  return `
    <article class="event-card">
      <div class="event-card-header">
        <div>
          <span class="event-time">${escapeHtml(formatDate(event.start_time))}</span>
          <h3>${escapeHtml(eventName(event))}</h3>
          <p>${escapeHtml(event.league ?? "Sin liga")} / ${escapeHtml(event.source ?? "manual")}</p>
        </div>
        <span class="signal-pill ${signal.className}">${escapeHtml(signal.label)}</span>
      </div>
      <div class="event-summary">
        <div>
          <span class="label">Mejor cuota disponible</span>
          <strong>${bestOdd ? `${escapeHtml(bestOdd.selection)} ${Number(bestOdd.odds_decimal).toFixed(2)}` : "-"}</strong>
        </div>
        <div>
          <span class="label">Probabilidad implicita</span>
          <strong>${bestOdd ? formatPercent(impliedProbability(bestOdd.odds_decimal)) : "-"}</strong>
        </div>
        <div>
          <span class="label">Mercado</span>
          <strong>${escapeHtml(bestOdd?.market ?? "h2h")}</strong>
        </div>
      </div>
      ${renderMarketStats(event)}
      <details class="odds-disclosure">
        <summary>Ver casas de apuesta</summary>
        ${renderOddsTable(event)}
      </details>
      ${renderResearchPlan(event)}
    </article>
  `;
}

function renderDetail(group) {
  if (!group) {
    detailHeader.innerHTML = `
      <div>
        <span class="label">Detalle</span>
        <h2>Sin grupo seleccionado</h2>
      </div>
    `;
    detailBody.innerHTML = `<div class="empty-state">Selecciona una cartelera o jornada para revisar cada pelea o partido.</div>`;
    return;
  }

  const noun = group.sport === "ufc" ? "peleas" : "partidos";
  const best = group.bestOdd ? `${escapeHtml(group.bestOdd.selection)} ${Number(group.bestOdd.odds_decimal).toFixed(2)}` : "Sin cuotas";

  detailHeader.innerHTML = `
    <div>
      <span class="label">${escapeHtml(groupTitle(group))}</span>
      <h2>${escapeHtml(group.league)}</h2>
      <p>${escapeHtml(formatDay(group.date))} / ${group.events.length} ${noun} / mejor cuota: ${best}</p>
    </div>
    <span class="sport-pill ${escapeHtml(group.sport)}">${escapeHtml(sportLabels[group.sport] ?? group.sport)}</span>
  `;

  detailBody.innerHTML = group.events.map(renderEventDetail).join("");
}

function render() {
  const events = filteredEvents();
  const groups = groupEvents(events);
  const allBestOdds = events.map(getBestOdd).filter(Boolean).sort((a, b) => Number(b.odds_decimal) - Number(a.odds_decimal));

  if (!groups.some((group) => group.id === state.selectedGroupId)) {
    state.selectedGroupId = groups[0]?.id ?? null;
  }

  groupsCount.textContent = String(groups.length);
  eventsCount.textContent = String(events.length);
  oddsCount.textContent = String(state.odds.length);
  bestSignal.textContent = allBestOdds[0] ? `${allBestOdds[0].selection} ${Number(allBestOdds[0].odds_decimal).toFixed(2)}` : "-";
  modeText.textContent = state.mode === "real" ? "Supabase + Odds API" : "Config incompleta";

  groupsList.innerHTML = groups.map(renderGroupCard).join("");
  groupsEmpty.hidden = groups.length > 0;

  renderDetail(groups.find((group) => group.id === state.selectedGroupId));
}

async function loadEvents() {
  statusText.textContent = "Cargando datos guardados";
  const response = await fetch("/api/events");
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "No se pudieron cargar los datos");

  state.events = payload.events ?? [];
  state.odds = payload.odds ?? [];
  state.analyses = payload.analyses ?? [];
  state.mode = payload.mode ?? "real";
  if (payload.lastUpdated) lastUpdated.textContent = formatDate(payload.lastUpdated);
  statusText.textContent = "Datos listos";
  render();
}

async function refreshData() {
  refreshButton.disabled = true;
  statusText.textContent = "Actualizando desde fuentes deportivas";

  try {
    const response = await fetch("/api/update", { method: "POST" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "No se pudo actualizar");

    state.events = payload.events ?? [];
    state.odds = payload.odds ?? [];
    state.analyses = payload.analyses ?? state.analyses;
    state.mode = payload.mode ?? "real";
    lastUpdated.textContent = formatDate(payload.capturedAt);
    statusText.textContent = payload.message ?? (payload.persisted ? "Actualizacion real guardada" : "No se guardaron datos");
    render();
  } catch (error) {
    statusText.textContent = error.message;
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener("click", refreshData);
groupsList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-group-id]");
  if (!card) return;
  state.selectedGroupId = card.dataset.groupId;
  render();
});

detailBody.addEventListener("click", async (event) => {
  const button = event.target.closest(".analyze-button");
  if (!button || button.disabled) return;

  button.disabled = true;
  button.textContent = "Calculando...";

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: button.dataset.eventId })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "No se pudo calcular el analisis");

    const analysis = payload.analysis;
    state.analyses = [
      analysis,
      ...state.analyses.filter((item) => !(item.event_id === analysis.event_id && item.source === analysis.source))
    ];
    render();
  } catch (error) {
    statusText.textContent = error.message;
    button.disabled = false;
    button.textContent = "Reintentar analisis";
  }
});

searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    state.activeSport = tab.dataset.sport;
    render();
  });
});

loadEvents().catch((error) => {
  statusText.textContent = error.message;
  render();
});
