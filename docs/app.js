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
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(n);
}

function parseGermanNumber(value) {
  if (value === null || value === undefined) return 0;
  const s = String(value).trim();
  if (s === "") return 0;
  return Number(s.replace(/\./g, "").replace(",", ".")) || 0;
}

function kontogruppeNum(kg) {
  const m = String(kg ?? "").match(/^\s*(\d+)/);
  return m ? parseInt(m[1], 10) : NaN;
}

function uniqueSorted(arr) {
  return [...new Set(arr)]
    .filter(Boolean)
    .map(String)
    .sort((a, b) => a.localeCompare(b, "de"));
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
// Aggregation
// ==============================
function aggregateByKontogruppe(rows) {
  const map = new Map();

  for (const r of rows) {
    const kg = String(r.kontogruppe ?? "(ohne kontogruppe)");
    const betrag = r.betrag;

    if (!map.has(kg)) {
      map.set(kg, {
        kontogruppe: kg,
        aufwendungen: 0,
        ertraege: 0,
        saldo: 0,
      });
    }

    const obj = map.get(kg);

    if (betrag >= 0) obj.aufwendungen += betrag;
    else obj.ertraege += betrag;

    obj.saldo += betrag;
  }

  return [...map.values()].sort((a, b) => {
    const na = kontogruppeNum(a.kontogruppe);
    const nb = kontogruppeNum(b.kontogruppe);

    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    if (!isNaN(na)) return -1;
    if (!isNaN(nb)) return 1;
    return a.kontogruppe.localeCompare(b.kontogruppe, "de");
  });
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
// Diagramm (FIX: explizite Reihenfolge)
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
      barmode: "relative",
      margin: { l: 280, r: 20, t: 10, b: 40 },
      xaxis: {
        title: "EUR (Erträge < 0 | Aufwendungen > 0)",
        zeroline: true,
      },
      yaxis: {
        categoryorder: "array",
        categoryarray: y,     // ✅ exakt unsere Reihenfolge
        autorange: "reversed" // ✅ 1 oben, 13 unten
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
  const filtered = filterRows(raw, getSelectedGruppen());
  const agg = aggregateByKontogruppe(filtered);
  renderTable(agg);
  renderChart(agg);
}

// ==============================
// Init
// ==============================
async function main() {
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error(`Konnte ${DATA_URL} nicht laden`);

  raw = await res.json();
  if (!Array.isArray(raw)) throw new Error("JSON muss ein Array sein");

  raw = raw.map(r => ({
    ...r,
    betrag: parseGermanNumber(r.betrag),
  }));

  // Kostenstellen-Filter
  const sel = document.getElementById("gruppeSelect");
  uniqueSorted(raw.map(r => r.gruppe)).forEach(g => {
    const o = document.createElement("option");
    o.value = g;
    o.textContent = g;
    sel.appendChild(o);
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
  alert("Fehler: " + err.message);
});
