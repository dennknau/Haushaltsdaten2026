const DATA_URL = "./data.json";
let raw = [];
let table;

function fmtEUR(n) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);
}

function uniqueSorted(arr) {
  return [...new Set(arr)].sort((a,b) => (a ?? "").localeCompare(b ?? "", "de"));
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

function aggregateByKontogruppe(rows) {
  const m = new Map();

  for (const r of rows) {
    const kg = String(r.kontogruppe ?? "(ohne kontogruppe)");
    const betrag = Number(r.betrag ?? 0);

    if (!m.has(kg)) m.set(kg, { kontogruppe: kg, aufwendungen: 0, ertraege: 0, saldo: 0 });
    const obj = m.get(kg);

    if (betrag >= 0) obj.aufwendungen += betrag;
    else obj.ertraege += betrag; // negativ
    obj.saldo += betrag;
  }

  const out = [...m.values()];

  // Sortierung nach führender Nummer "13 - ..."
  out.sort((a, b) => {
    const na = parseInt(a.kontogruppe, 10);
    const nb = parseInt(b.kontogruppe, 10);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.kontogruppe.localeCompare(b.kontogruppe, "de");
  });

  return out;
}

function renderTable(agg) {
  if (!table) {
    table = new Tabulator("#table", {
      data: agg,
      layout: "fitColumns",
      height: "520px",
      initialSort: [{ column: "kontogruppe", dir: "asc" }],
      columns: [
        { title: "Kontogruppe", field: "kontogruppe", headerFilter: "input", widthGrow: 3 },
        { title: "Aufwendungen", field: "aufwendungen", hozAlign: "right", sorter: "number",
          formatter: (cell) => fmtEUR(cell.getValue()) },
        { title: "Erträge", field: "ertraege", hozAlign: "right", sorter: "number",
          formatter: (cell) => fmtEUR(cell.getValue()) },
        { title: "Saldo", field: "saldo", hozAlign: "right", sorter: "number",
          formatter: (cell) => fmtEUR(cell.getValue()) },
      ],
    });
  } else {
    table.replaceData(agg);
  }
}

function renderChart(agg) {
  const y = agg.map(d => d.kontogruppe);

  const traceErtr = {
    type: "bar",
    orientation: "h",
    name: "Erträge",
    y,
    x: agg.map(d => d.ertraege),     // negativ -> links
    marker: { color: "green" },
  };

  const traceAufw = {
    type: "bar",
    orientation: "h",
    name: "Aufwendungen",
    y,
    x: agg.map(d => d.aufwendungen), // positiv -> rechts
    marker: { color: "red" },
  };

  Plotly.newPlot("chart", [traceErtr, traceAufw], {
    barmode: "relative",
    margin: { l: 260, r: 20, t: 10, b: 40 },
    xaxis: { title: "EUR (Erträge < 0, Aufwendungen > 0)", zeroline: true },
    legend: { orientation: "h" },
  }, { responsive: true });
}

function rerender() {
  const selected = getSelectedGruppen();
  const filtered = filterRows(raw, selected);
  const agg = aggregateByKontogruppe(filtered);
  renderChart(agg);
  renderTable(agg);
}

function populateGruppenSelect(rows) {
  const gruppen = uniqueSorted(rows.map(r => String(r.gruppe)));
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
  raw = await fetch(DATA_URL).then(r => r.json());

  // ✅ WICHTIG: "400,00" -> 400.00 (Zahl)
  raw = raw.map(r => ({
    ...r,
    betrag: Number(String(r.betrag).replace(/\./g, "").replace(",", "."))
  }));

  populateGruppenSelect(raw);

  document.getElementById("btnAll").addEventListener("click", () => {
    const sel = document.getElementById("gruppeSelect");
    [...sel.options].forEach(o => o.selected = false);
    rerender();
  });

  document.getElementById("btnApply").addEventListener("click", rerender);

  rerender();
}

main().catch(err => {
  console.error(err);
  alert("Fehler beim Laden/Rendern. Prüfe data.json und Konsole.");
});
