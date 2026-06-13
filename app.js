const refreshButton = document.querySelector("#refreshButton");
const statusText = document.querySelector("#statusText");
const lastUpdated = document.querySelector("#lastUpdated");
const modeText = document.querySelector("#modeText");
const eventsCount = document.querySelector("#eventsCount");
const oddsCount = document.querySelector("#oddsCount");
const bestSignal = document.querySelector("#bestSignal");
const eventsBody = document.querySelector("#eventsBody");
const emptyState = document.querySelector("#emptyState");
const searchInput = document.querySelector("#searchInput");
const tabs = Array.from(document.querySelectorAll(".tab"));

let state = {
  activeSport: "all",
  query: "",
  events: [],
  odds: [],
  mode: "demo"
};

const sportLabels = {
  ufc: "UFC",
  football: "Futbol",
  basketball: "Basquetbol"
};

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "-";
  return `${Math.round(value * 1000) / 10}%`;
}

function impliedProbability(odds) {
  const number = Number(odds);
  return number > 0 ? 1 / number : null;
}

function getBestOdd(event) {
  const eventOdds = state.odds.filter((odd) => odd.event_id === event.id || odd.source_event_id === event.source_event_id);
  if (!eventOdds.length) return null;
  return eventOdds.reduce((best, odd) => Number(odd.odds_decimal) > Number(best.odds_decimal) ? odd : best, eventOdds[0]);
}

function signalFor(odd) {
  if (!odd) return { label: "Sin cuota", className: "low" };
  const odds = Number(odd.odds_decimal);
  if (odds >= 2.4) return { label: "Revisar valor", className: "good" };
  if (odds >= 1.75) return { label: "Seguimiento", className: "watch" };
  return { label: "Baja paga", className: "low" };
}

function filteredEvents() {
  return state.events.filter((event) => {
    const matchesSport = state.activeSport === "all" || event.sport === state.activeSport;
    const haystack = `${event.league ?? ""} ${event.home_name ?? ""} ${event.away_name ?? ""}`.toLowerCase();
    return matchesSport && haystack.includes(state.query.toLowerCase());
  });
}

function render() {
  const rows = filteredEvents();
  const bestSignals = rows.map(getBestOdd).filter(Boolean).sort((a, b) => Number(b.odds_decimal) - Number(a.odds_decimal));

  eventsCount.textContent = String(state.events.length);
  oddsCount.textContent = String(state.odds.length);
  bestSignal.textContent = bestSignals[0] ? `${bestSignals[0].selection} ${Number(bestSignals[0].odds_decimal).toFixed(2)}` : "-";
  modeText.textContent = state.mode === "supabase" ? "Supabase" : "Demo/local";

  eventsBody.innerHTML = rows.map((event) => {
    const bestOdd = getBestOdd(event);
    const signal = signalFor(bestOdd);
    const probability = bestOdd ? impliedProbability(bestOdd.odds_decimal) : null;
    const eventName = `${event.home_name} vs ${event.away_name}`;

    return `
      <tr>
        <td><span class="sport-pill ${event.sport}">${sportLabels[event.sport] ?? event.sport}</span></td>
        <td>
          <div class="event-title">${eventName}</div>
          <div class="event-subtitle">${event.league ?? "Sin liga"} · ${event.source ?? "manual"}</div>
        </td>
        <td>${formatDate(event.start_time)}</td>
        <td>${bestOdd?.market ?? "h2h"}</td>
        <td>${bestOdd ? `${bestOdd.selection} · ${Number(bestOdd.odds_decimal).toFixed(2)}` : "-"}</td>
        <td>${formatPercent(probability)}</td>
        <td><span class="signal-pill ${signal.className}">${signal.label}</span></td>
      </tr>
    `;
  }).join("");

  emptyState.hidden = rows.length > 0;
}

async function loadEvents() {
  statusText.textContent = "Cargando datos guardados";
  const response = await fetch("/api/events");
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "No se pudieron cargar los datos");

  state.events = payload.events ?? [];
  state.odds = payload.odds ?? [];
  state.mode = payload.mode ?? "demo";
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
    state.mode = payload.mode ?? "demo";
    lastUpdated.textContent = formatDate(payload.capturedAt);
    statusText.textContent = payload.persisted ? "Actualizacion guardada" : "Actualizacion en modo demo";
    render();
  } catch (error) {
    statusText.textContent = error.message;
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener("click", refreshData);
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
