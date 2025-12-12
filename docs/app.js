// ==============================
// Konfiguration
// ==============================
const DATA_URL = "./haushalt.json";

let raw = [];
let table;

// ==============================
// Hilfsfunktionen
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

// ==============================
// Neue Logik: Erträge über Sachkonto-Prefix
// Ertrag, wenn Sachkonto mit "5" oder "91" beginnt.
// ==============================
function extractSachkontoNumber(sachkonto) {
  // erwartet z.B. "6900100 - Beiträge ..." oder "9100000 - ..."
  const s = String(sachkonto ?? "");
  const m = s.match(/^\s*(\d+)/); // führende Ziffern
  return m ? m[1] : "";
}

function isErtragBySachkonto(sachkonto) {
  const nr = extractSachkontoNumber(sachkonto);
  return nr.startsWith("5") || nr.startsWith("91");
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
// Aggregation pro Kontogruppe
// - aufwendungen: Summe der Aufwands-Sachkonten (positiv dargestellt)
// - ertraege:     Summe der Ertrags-Sachkonten (positiv dargestellt)
// - saldo:        aufwendungen - ertraege
// ==============================
function aggregateByKontogruppe(rows) {
  const map = new Map();

  for (const r of rows) {
    const kg = String(r.kontogruppe ?? "(ohne kontogruppe)");
    const betrag = Number(r.betrag ?? 0); // bereits geparst
    const istErtrag = isErtragBySachkonto(r.sachkonto);

    if (!map.has(kg)) {
      map.set(kg, { kontogruppe: kg, aufwendungen: 0, ertraege: 0, saldo: 0 });
    }
    const obj = map.get(kg);

    // Wir summieren als positive "Volumina", unabhängig vom Vorzeichen:
    const absVal = Math.abs(betrag);

    if (istErtrag) obj.ertraege += absVal;
    else obj.aufwendungen += absVal;

    obj.saldo = obj.aufwendungen - obj.ertraege;
  }

  const out = [...map.values()];

  out.sort((a, b) => {
    const na = kontogruppeNum(a.kontogruppe);
    const nb = kontogruppeNum(b.kontogruppe);

    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    if (!isNaN(na)) return -1;
    if (!isNaN(nb)) return 1;
    return a.kontogruppe.localeCompare(b.kontogruppe, "de");
  });

  return out;
}

// ==============================
// Tabelle
// ==============================
function renderTable(data) {
  const kgSorter = (a, b) => {
    const na = kontogruppeNum(a);
    const nb = kontogruppeNum(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    if (!isNaN(na)) return -1;
    if (!isNaN(nb)) return 1;
    return String(a).localeCompare(String(b), "de");
  };

  if (!table) {
    table = new Tabulator("#table", {
      data,
      layout: "fitColumns",
      height: "520px",
      columns: [
        { title: "Kontogruppe", field: "kontogruppe", sorter: kgSorter, headerFilter: "input", widthGrow: 3 },
        { title: "Aufwendungen", field: "aufwendungen", sorter: "number", hozAlign: "right",
          formatter: c => fmtEUR(c.getValue()) },
        { title: "Erträge", field: "ertraege", sorter: "number", hozAlign: "right",
          formatter: c => fmtEUR(c.getValue()) },
        { title: "Saldo", field: "saldo", sorter: "number", hozAlign: "right",
          formatter: c => fmtEUR(c.getValue()) },
      ],
    });

    table.setSort([{ column: "kontogruppe", dir: "asc" }]);
  } else {
    table.replaceData(data);
    table.setSort([{ column: "kontogruppe", dir: "asc" }]);
  }
}

// ==============================
// Diagramm (Erträge grün, Aufwendungen rot)
// Jetzt sind beide Serien positiv; wir zeigen sie als gruppierte Balken.
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
      barmode: "group", // beide positiv -> nebeneinander
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

  // Beträge normalisieren
  raw = raw.map(r => ({
    ...r,
    betrag: parseGermanNumber(r.betrag),
  }));

  // Filter-Liste befüllen
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
