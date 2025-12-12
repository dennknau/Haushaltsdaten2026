// docs/app.js
const DATA_URL = "./haushalt.json";

let raw = [];
let table;

function fmtEUR(n) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);
}

function uniqueSorted(arr) {
  return [...new Set(arr)]
    .filter(v => v !== undefined && v !== null && String(v).trim() !== "")
    .map(v => String(v))
    .sort((a, b) => a.localeCompare(b, "de"));
}

function parseGermanNumber(value) {
  // "1.234,56" -> 1234.56
  // "-400,00"  -> -400
  // 400        -> 400
  if (value === null || value === undefined) return 0;
  const s = String(value).trim();
  if (s === "") return 0;

  const normalized = s.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function kontogruppeNum(kg) {
  // Extrahiert führende Zahl aus "13 - ..." oder "13..."
  const m = String(kg ?? "").match(/^\s*(\d+)/);
  return m ? parseInt(m[1], 10) : NaN;
}

function getSelectedGruppen() {
  const sel = document.getElementById("gruppeSelect");
  return [...sel.selectedOptions].map(o => o.value);
}

function filterRows(rows, selectedGruppen) {
  if (!selectedGruppen || selectedGruppen.length === 0) return rows;
  const set = new Set(selectedGruppen);
  return rows.filter(r => set.has(String(r.gruppe)));
}

/**
 * Aggregation:
 * - Ergebnis pro kontogruppe:
 *   aufwendungen = Summe positiver Beträge
 *   ertraege     = Summe negativer Beträge (bleibt negativ)
 *   saldo        = Summe gesamt
 */
function aggregateByKontogruppe(rows) {
  const m = new Map();

  for (const r of rows) {
    const kg = String(r.kontogruppe ?? "(ohne kontogruppe)");
    const betrag = Number(r.betrag ?? 0);

    if (!m.has(kg)) {
      m.set(kg, { kontogruppe: kg, aufwendungen: 0, ertraege: 0, saldo: 0 });
    }
    const obj = m.get(kg);

    if (betrag >= 0) obj.aufwendungen += betrag;
    else obj.ertraege += betrag; // negativ
    obj.saldo += betrag;
  }

  const out = [...m.values()];

  // ✅ Korrekte Sortierung für Chart (und grundsätzlich)
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

function renderTable(agg) {
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
      data: agg,
      layout: "fitColumns",
      height: "520px",
      columns: [
        {
          title: "Kontogruppe",
          field: "kontogruppe",
          headerFilter: "input",
          widthGrow: 3,
          sorter: kgSorter, // ✅ numerische Sortierung in Tabulator
        },
        {
          title: "Aufwendungen",
          field: "aufwendungen",
          hozAlign: "right",
          sorter: "number",
          formatter: (cell) => fmtEUR(cell.getValue()),
        },
        {
          title: "Erträge",
          field: "ertraege",
          hozAlign: "right",
          sorter: "number",
          formatter: (cell) => fmtEUR(cell.getValue()),
        },
        {
          title: "Saldo",
          field: "saldo",
          hozAlign: "right",
          sorter: "number",
          formatter: (cell) => fmtEUR(cell.getValue()),
        },
      ],
    });

    // ✅ Erzwingt unsere Sortierung nach dem initialen Rendern
    table.setSort([{ column: "kontogruppe", dir: "asc" }]);
  } else {
    table.replaceData(agg);
    table.setSort([{ column: "kontogruppe", dir: "asc" }]);
  }
}

function renderChart(agg) {
  const y = agg.map(d => d.kontogruppe);

  const traceErtr = {
    type: "bar",
    orientation: "h",
    name: "Erträge",
    y,
    x: agg.map(d => d.ertraege), // negativ -> links
    marker: { color: "green" },
    hovertemplate: "%{y}<br>Erträge: %{x:.2f} €<extra></extra>",
  };

  const traceAufw = {
    type: "bar",
    orientation: "h",
    name: "Aufwendungen",
    y,
    x: agg.map(d => d.aufwendungen), // positiv -> rechts
    marker: { color: "red" },
    hovertemplate: "%{y}<br>Aufwendungen: %{x:.2f} €<extra></extra>",
  };

  Plotly.newPlot(
    "chart",
    [traceErtr, traceAufw],
    {
      barmode: "relative",
      margin: { l: 260, r: 20, t: 10, b: 40 },
      xaxis: { title: "EUR (Erträge < 0, Aufwendungen > 0)", zeroline: true },
      legend: { orientation: "h" },
    },
    { responsive: true }
  );
}

function rerender() {
  const selected = getSelectedGruppen();
  const filtered = filterRows(raw, selected);
  const agg = aggregateByKontogruppe(filtered);
  renderTable(agg);
  renderChart(agg);
}

function populateGruppenSelect(rows) {
  const gruppen = uniqueSorted(rows.map(r => r.gruppe));
  const sel = document.getElementById("gruppeSelect");
  sel.innerHTML = "";

  for (const g of gruppen) {
    const opt = document.createElement("option");
    opt.value = g;
    opt.textContent = g;
    sel.appendChild(opt);
  }
}

async function main() {
  raw = await fetch(DATA_URL).then(r => {
    if (!r.ok) throw new Error(`Konnte ${DATA_URL} nicht laden (HTTP ${r.status})`);
    return r.json();
  });

  // Beträge normalisieren (String "400,00" -> Zahl 400.00)
  raw = raw.map(r => ({
    ...r,
    betrag: parseGermanNumber(r.betrag),
  }));

  populateGruppenSelect(raw);

  document.getElementById("btnAll").addEventListener("click", () => {
    const sel = document.getElementById("gruppeSelect");
    [...sel.options].forEach(o => (o.selected = false));
    rerender();
  });

  document.getElementById("btnApply").addEventListener("click", rerender);

  rerender();
}

main().catch(err => {
  console.error(err);
  alert("Fehler: " + (err?.message ?? err));
});
