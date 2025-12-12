// ==============================
// Konfiguration
// ==============================
const DATA_URL = "./haushalt.json";

let raw = [];
let table;

// ==============================
// Helpers
// ==============================
function fmtEUR(n) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);
}

function parseGermanNumber(value) {
  if (value === null || value === undefined) return 0;
  const s = String(value).trim();
  if (s === "") return 0;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function kontogruppeNum(kg) {
  const m = String(kg ?? "").match(/^\s*(\d+)/);
  return m ? parseInt(m[1], 10) : NaN;
}

function uniqueSorted(arr) {
  return [...new Set(arr)]
    .filter(v => v !== undefined && v !== null && String(v).trim() !== "")
    .map(String)
    .sort((a, b) => a.localeCompare(b, "de"));
}

function setStatus(text) {
  const el = document.getElementById("status");
  if (el) el.textContent = text ?? "";
}

function extractSachkontoNumber(sachkonto) {
  const s = String(sachkonto ?? "");
  const m = s.match(/^\s*(\d+)/);
  return m ? m[1] : "";
}

function isErtragBySachkonto(sachkonto) {
  // Ertrag, wenn Sachkonto-Nummer mit "5" oder "91" beginnt
  const nr = extractSachkontoNumber(sachkonto);
  return nr.startsWith("5") || nr.startsWith("91");
}

function startsWithPrefix(sachkonto, prefix) {
  const nr = extractSachkontoNumber(sachkonto);
  return nr.startsWith(prefix);
}

// ==============================
// Filter
// ==============================
function getSelectedGruppen() {
  const sel = document.getElementById("gruppeSelect");
  return sel ? [...sel.selectedOptions].map(o => o.value) : [];
}

function filterRows(rows, gruppen) {
  if (!gruppen.length) return rows;
  const set = new Set(gruppen);
  return rows.filter(r => set.has(String(r.gruppe)));
}

// ==============================
// Aggregation pro Kontogruppe (mit Vorzeichenwirkung)
// - Erträge:      ertraege += -betrag
// - Aufwendungen: aufwendungen += betrag
// - Saldo: aufwendungen - ertraege
// ==============================
function aggregateByKontogruppe(rows) {
  const map = new Map();

  for (const r of rows) {
    const kg = String(r.kontogruppe ?? "(ohne kontogruppe)");
    const betrag = Number(r.betrag ?? 0);
    const istErtrag = isErtragBySachkonto(r.sachkonto);

    if (!map.has(kg)) {
      map.set(kg, { kontogruppe: kg, aufwendungen: 0, ertraege: 0, saldo: 0 });
    }
    const obj = map.get(kg);

    if (istErtrag) obj.ertraege += -betrag;      // ✅ Vorzeichen wirkt
    else obj.aufwendungen += betrag;             // ✅ Vorzeichen wirkt

    obj.saldo = obj.aufwendungen - obj.ertraege;
  }

  const out = [...map.values()];

  out.sort((a, b) => {
    const na = kontogruppeNum(a.kontogruppe);
    const nb = kontogruppeNum(b.kontogruppe);

    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    if (!isNaN(na) && isNaN(nb)) return -1;
    if (isNaN(na) && !isNaN(nb)) return 1;

    return a.kontogruppe.localeCompare(b.kontogruppe, "de");
  });

  return out;
}

// ==============================
// NEU: Gesamtübersicht berechnen
// - Erträge gesamt (ohne 91): nur Erträge, deren Sachkonto NICHT mit 91 beginnt
// - Aufwendungen gesamt (ohne 92): nur Aufwendungen, deren Sachkonto NICHT mit 92 beginnt
// - Ergebnis = Aufwand - Ertrag
//
// Erträge/Aufwand werden dabei mit Vorzeichenwirkung summiert:
//   Ertrag:      sum += -betrag
//   Aufwand:     sum += betrag
// ==============================
function computeOverviewTotals(rows) {
  let ertraegeOhne91 = 0;
  let aufwendungenOhne92 = 0;

  for (const r of rows) {
    const betrag = Number(r.betrag ?? 0);
    const istErtrag = isErtragBySachkonto(r.sachkonto);

    if (istErtrag) {
      // nur wenn NICHT 91...
      if (!startsWithPrefix(r.sachkonto, "91")) {
        ertraegeOhne91 += -betrag;
      }
    } else {
      // Aufwand, aber ohne 92...
      if (!startsWithPrefix(r.sachkonto, "92")) {
        aufwendungenOhne92 += betrag;
      }
    }
  }

  const ergebnis = aufwendungenOhne92 - ertraegeOhne91;
  return { ertraegeOhne91, aufwendungenOhne92, ergebnis };
}

function setBarWidth(barEl, value, maxValue) {
  if (!barEl) return;
  const denom = maxValue <= 0 ? 1 : maxValue;
  const w = Math.max(0, Math.min(100, (Math.abs(value) / denom) * 100));
  barEl.style.width = `${w}%`;
}

// ==============================
// Rendering: Summary
// ==============================
function renderOverview(overview) {
  const elErtrag = document.getElementById("sumErtrag");
  const elAufwand = document.getElementById("sumAufwand");
  const elErgebnis = document.getElementById("sumErgebnis");

  if (elErtrag) elErtrag.textContent = fmtEUR(overview.ertraegeOhne91);
  if (elAufwand) elAufwand.textContent = fmtEUR(overview.aufwendungenOhne92);
  if (elErgebnis) elErgebnis.innerHTML = `<b>${fmtEUR(overview.ergebnis)}</b>`;

  const barErtrag = document.getElementById("barErtrag");
  const barAufwand = document.getElementById("barAufwand");
  const barErgebnis = document.getElementById("barErgebnis");

  // Skalierung: größte absolute Zahl von Ertrag/Aufwand/Ergebnis
  const maxAbs = Math.max(
    Math.abs(overview.ertraegeOhne91),
    Math.abs(overview.aufwendungenOhne92),
    Math.abs(overview.ergebnis),
    1
  );

  setBarWidth(barErtrag, overview.ertraegeOhne91, maxAbs);
  setBarWidth(barAufwand, overview.aufwendungenOhne92, maxAbs);
  setBarWidth(barErgebnis, overview.ergebnis, maxAbs);
}

// ==============================
// Rendering: Detail-Tabelle
// ==============================
function renderTable(data) {
  const kgSorter = (a, b) => {
    const na = kontogruppeNum(a);
    const nb = kontogruppeNum(b);

    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    if (!isNaN(na) && isNaN(nb)) return -1;
    if (isNaN(na) && !isNaN(nb)) return 1;

    return String(a).localeCompare(String(b), "de");
  };

  if (!table) {
    table = new Tabulator("#table", {
      data,
      layout: "fitColumns",
      height: "520px",
      columns: [
        {
          title: "Kontogruppe",
          field: "kontogruppe",
          sorter: kgSorter,
          headerFilter: "input",
          widthGrow: 3,
        },
        {
          title: "Aufwendungen",
          field: "aufwendungen",
          sorter: "number",
          hozAlign: "right",
          formatter: c => fmtEUR(c.getValue()),
        },
        {
          title: "Erträge",
          field: "ertraege",
          sorter: "number",
          hozAlign: "right",
          formatter: c => fmtEUR(c.getValue()),
        },
        {
          title: "Saldo",
          field: "saldo",
          sorter: "number",
          hozAlign: "right",
          formatter: c => fmtEUR(c.getValue()),
        },
      ],
    });

    table.setSort([{ column: "kontogruppe", dir: "asc" }]);
  } else {
    table.replaceData(data);
    table.setSort([{ column: "kontogruppe", dir: "asc" }]);
  }
}

// ==============================
// Diagramm (wie bisher – unverändert)
// ==============================
function renderChart(data) {
  const y = data.map(d => d.kontogruppe);

  const traceErtraege = {
    type: "bar",
    orientation: "h",
    name: "Erträge",
    y,
    x: data.map(d => d.ertraege),
    marker: { color: "green" },
  };

  const traceAufwendungen = {
    type: "bar",
    orientation: "h",
    name: "Aufwendungen",
    y,
    x: data.map(d => d.aufwendungen),
    marker: { color: "red" },
  };

  Plotly.newPlot(
    "chart",
    [traceErtraege, traceAufwendungen],
    {
      barmode: "group",
      margin: { l: 280, r: 20, t: 10, b: 40 },
      xaxis: { title: "EUR", zeroline: true },
      yaxis: {
        categoryorder: "array",
        categoryarray: y,
        autorange: "reversed",
      },
      legend: { orientation: "h" },
    },
    { responsive: true }
  );
}

// ==============================
// Render-Pipeline
// ==============================
function rerender() {
  const selected = getSelectedGruppen();
  const filtered = filterRows(raw, selected);

  const overview = computeOverviewTotals(filtered);
  renderOverview(overview);

  const agg = aggregateByKontogruppe(filtered);
  setStatus(`Zeilen: ${filtered.length} | Kontogruppen: ${agg.length}`);

  renderTable(agg);
  renderChart(agg);
}

// ==============================
// Init
// ==============================
async function main() {
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error(`Konnte ${DATA_URL} nicht laden (HTTP ${res.status})`);

  raw = await res.json();
  if (!Array.isArray(raw)) throw new Error(`${DATA_URL} muss ein JSON-Array [...] sein.`);

  raw = raw.map(r => ({
    ...r,
    betrag: parseGermanNumber(r.betrag),
  }));

  // Filterliste
  const sel = document.getElementById("gruppeSelect");
  uniqueSorted(raw.map(r => r.gruppe)).forEach(g => {
    const opt = document.createElement("option");
    opt.value = g;
    opt.textContent = g;
    sel.appendChild(opt);
  });

  document.getElementById("btnAll").onclick = () => {
    [...sel.options].forEach(o => (o.selected = false));
    rerender();
  };

  document.getElementById("btnApply").onclick = rerender;

  rerender();
}

main().catch(err => {
  console.error(err);
  alert("Fehler: " + (err?.message ?? err));
});
