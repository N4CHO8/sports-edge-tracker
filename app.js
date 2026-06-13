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

let state = {
  activeSport: "all",
  query: "",
  selectedGroupId: null,
  events: [],
  odds: [],
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
  return new Date(value).toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatDay(value) {
  if (!value || value === "sin-fecha") return "Sin fecha";
  return new Intl.DateTimeFormat("es-CL", {
    weekday: "short",
    day: "2-digit",
    month: "short"
  }).format(new Date(`${value}T12:00:00`));
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
  const rows = state.odds.filter((odd) => odd.event_id === event.id || odd.source_event_id === event.source_event_id);
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

function getBestOdd(event) {
  const rows = latestOddsForEvent(event);
  return rows[0] ?? null;
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
          <span class="label">Mejor cuota</span>
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
      ${renderOddsTable(event)}
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
    state.mode = payload.mode ?? "real";
    lastUpdated.textContent = formatDate(payload.capturedAt);
    statusText.textContent = payload.persisted ? "Actualizacion real guardada" : "No se guardaron datos";
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
