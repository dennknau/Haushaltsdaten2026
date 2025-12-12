const DATA_URL = "./haushalt.json";

let raw = [];
let table;        // Ergebnisübersicht (Kontogruppe)
let detailTable;  // Drilldown (Sachkonto)
let lastFilteredRows = [];
let selectedKontogruppe = null;

/* ---------- Helper ---------- */
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

function sachkontoNum(sk) {
  const m = String(sk ?? "").match(/^\s*(\d+)/);
  return m ? parseInt(m[1], 10) : NaN;
}

function uniqueSorted(arr) {
  return [...new Set(arr)]
    .filter(v => v !== undefined && v !== null && String(v).trim() !== "")
    .map(String)
    .sort((a, b) => a.localeCompare(b, "de"));
}

function extractSachkontoNumber(sachkonto) {
  const m = String(sachkonto ?? "").match(/^\s*(\d+)/);
  return m ? m[1] : "";
}

function isErtragBySachkonto(sachkonto) {
  const nr = extractSachkontoNumber(sachkonto);
  return nr.startsWith("5") || nr.startsWith("91");
}

function startsWithPrefix(sachkonto, prefix) {
  return extractSachkontoNumber(sachkonto).startsWith(prefix);
}

/* ---------- Filter ---------- */
function getSelectedGruppen() {
  const sel = document.getElementById("gruppeSelect");
  return sel ? [...sel.selectedOptions].map(o => o.value) : [];
}

function filterRows(rows, gruppen) {
  if (!gruppen.length) return rows;
  const set = new Set(gruppen);
  return rows.filter(r => set.has(String(r.gruppe)));
}

/* ---------- Aggregation (Kontogruppe) ---------- */
function aggregateByKontogruppe(rows) {
  const map = new Map();

  for (const r of rows) {
    const kg = String(r.kontogruppe ?? "(ohne kontogruppe)");
    const betrag = r.betrag;
    const istErtrag = isErtragBySachkonto(r.sachkonto);

    if (!map.has(kg)) {
      map.set(kg, { kontogruppe: kg, aufwendungen: 0, ertraege: 0 });
    }
    const o = map.get(kg);

    if (istErtrag) o.ertraege += -betrag;
    else o.aufwendungen += betrag;
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

/* ---------- Aggregation (Sachkonto Drilldown) ---------- */
function aggregateBySachkonto(rows) {
  const map = new Map();

  for (const r of rows) {
    const sk = String(r.sachkonto ?? "(ohne sachkonto)");
    const betrag = r.betrag;
    const istErtrag = isErtragBySachkonto(r.sachkonto);

    if (!map.has(sk)) {
      map.set(sk, { sachkonto: sk, aufwendungen: 0, ertraege: 0 });
    }
    const o = map.get(sk);

    if (istErtrag) o.ertraege += -betrag;
    else o.aufwendungen += betrag;
  }

  return [...map.values()].sort((a, b) => {
    const na = sachkontoNum(a.sachkonto);
    const nb = sachkontoNum(b.sachkonto);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    if (!isNaN(na)) return -1;
    if (!isNaN(nb)) return 1;
    return a.sachkonto.localeCompare(b.sachkonto, "de");
  });
}

/* ---------- Gesamtübersicht ---------- */
function computeOverviewTotals(rows) {
  let ertraege = 0;
  let aufwendungen = 0;

  for (const r of rows) {
    const betrag = r.betrag;
    const istErtrag = isErtragBySachkonto(r.sachkonto);

    if (istErtrag && !startsWithPrefix(r.sachkonto, "91")) ertraege += -betrag;
    if (!istErtrag && !startsWithPrefix(r.sachkonto, "92")) aufwendungen += betrag;
  }

  return {
    ertraege,
    aufwendungen,
    ergebnis: aufwendungen - ertraege,
  };
}

function setBarWidth(barEl, value, maxValue) {
  if (!barEl) return;
  const w = Math.min(100, (Math.abs(value) / Math.max(maxValue, 1)) * 100);
  barEl.style.width = `${w}%`;
}

function renderOverview(o) {
  document.getElementById("sumErtrag").textContent = fmtEUR(o.ertraege);
  document.getElementById("sumAufwand").textContent = fmtEUR(o.aufwendungen);

  const ergebnisEl = document.getElementById("sumErgebnis");
  let label = "Ausgeglichen";
  let displayValue = 0;

  if (o.ergebnis < 0) {
    label = "Überschuss";
    displayValue = Math.abs(o.ergebnis);
  } else if (o.ergebnis > 0) {
    label = "Defizit";
    displayValue = o.ergebnis;
  }

  ergebnisEl.innerHTML = `<b>${fmtEUR(displayValue)} (${label})</b>`;

  const maxAbs = Math.max(Math.abs(o.ertraege), Math.abs(o.aufwendungen), Math.abs(o.ergebnis), 1);
  setBarWidth(document.getElementById("barErtrag"), o.ertraege, maxAbs);
  setBarWidth(document.getElementById("barAufwand"), o.aufwendungen, maxAbs);
  setBarWidth(document.getElementById("barErgebnis"), o.ergebnis, maxAbs);
}

/* ---------- Kreisdiagramme ---------- */
function renderPies(agg) {
  const labels = agg.map(d => d.kontogruppe);

  // Pie braucht >= 0; negative Werte kappen wir auf 0
  const valuesErtraege = agg.map(d => Math.max(0, d.ertraege));
  const valuesAufwand = agg.map(d => Math.max(0, d.aufwendungen));

  const ertragPairs = labels.map((l, i) => [l, valuesErtraege[i]]).filter(([, v]) => v > 0);
  const aufwandPairs = labels.map((l, i) => [l, valuesAufwand[i]]).filter(([, v]) => v > 0);

  const layout = { margin: { l: 10, r: 10, t: 10, b: 10 }, showlegend: true };

  Plotly.newPlot("pieErtraege", [{
    type: "pie",
    labels: ertragPairs.map(p => p[0]),
    values: ertragPairs.map(p => p[1]),
    textinfo: "percent",
    hovertemplate: "%{label}<br>%{value:.2f} €<br>%{percent}<extra></extra>",
  }], layout, { responsive: true });

  Plotly.newPlot("pieAufwendungen", [{
    type: "pie",
    labels: aufwandPairs.map(p => p[0]),
    values: aufwandPairs.map(p => p[1]),
    textinfo: "percent",
    hovertemplate: "%{label}<br>%{value:.2f} €<br>%{percent}<extra></extra>",
  }], layout, { responsive: true });
}

/* ---------- Ergebnisübersicht (Kontogruppe) ---------- */
function renderTable(agg) {
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
      data: agg,
      layout: "fitColumns",
      height: false,
      columns: [
        { title: "Kontogruppe", field: "kontogruppe", sorter: kgSorter, headerFilter: "input", widthGrow: 3 },
        { title: "Aufwendungen", field: "aufwendungen", sorter: "number", hozAlign: "right", formatter: c => fmtEUR(c.getValue()) },
        { title: "Erträge", field: "ertraege", sorter: "number", hozAlign: "right", formatter: c => fmtEUR(c.getValue()) },
      ],
      rowClick: (_, row) => {
        const kg = row.getData().kontogruppe;

        // Toggle: gleicher Klick schließt wieder
        if (selectedKontogruppe === kg) {
          selectedKontogruppe = null;
          hideDetail();
          return;
        }

        selectedKontogruppe = kg;
        showDetailForKontogruppe(kg);
      },
    });

    table.setSort([{ column: "kontogruppe", dir: "asc" }]);
  } else {
    table.replaceData(agg);
    table.setSort([{ column: "kontogruppe", dir: "asc" }]);
  }
}

/* ---------- Drilldown (Sachkonten) ---------- */
function hideDetail() {
  const sec = document.getElementById("detailSection");
  if (sec) sec.style.display = "none";
}

function showDetailForKontogruppe(kontogruppe) {
  const sec = document.getElementById("detailSection");
  const title = document.getElementById("detailTitle");
  const count = document.getElementById("detailCount");

  const rows = lastFilteredRows.filter(r => String(r.kontogruppe ?? "") === String(kontogruppe));
  const agg = aggregateBySachkonto(rows);

  if (title) title.textContent = kontogruppe;
  if (count) count.textContent = `Sachkonten: ${agg.length} | Zeilen: ${rows.length}`;
  if (sec) sec.style.display = "";

  renderDetailTable(agg);
}

function renderDetailTable(agg) {
  const skSorter = (a, b) => {
    const na = sachkontoNum(a);
    const nb = sachkontoNum(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    if (!isNaN(na)) return -1;
    if (!isNaN(nb)) return 1;
    return String(a).localeCompare(String(b), "de");
  };

  if (!detailTable) {
    detailTable = new Tabulator("#detailTable", {
      data: agg,
      layout: "fitColumns",
      height: false,
      columns: [
        { title: "Sachkonto", field: "sachkonto", sorter: skSorter, headerFilter: "input", widthGrow: 3 },
        { title: "Aufwendungen", field: "aufwendungen", sorter: "number", hozAlign: "right", formatter: c => fmtEUR(c.getValue()) },
        { title: "Erträge", field: "ertraege", sorter: "number", hozAlign: "right", formatter: c => fmtEUR(c.getValue()) },
      ],
    });

    detailTable.setSort([{ column: "sachkonto", dir: "asc" }]);
  } else {
    detailTable.replaceData(agg);
    detailTable.setSort([{ column: "sachkonto", dir: "asc" }]);
  }
}

/* ---------- Render ---------- */
function rerender() {
  lastFilteredRows = filterRows(raw, getSelectedGruppen());

  const overview = computeOverviewTotals(lastFilteredRows);
  renderOverview(overview);

  const agg = aggregateByKontogruppe(lastFilteredRows);
  renderTable(agg);
  renderPies(agg);

  document.getElementById("status").textContent =
    `Zeilen: ${lastFilteredRows.length} | Kontogruppen: ${agg.length}`;

  // Wenn Filter geändert wurde: Detailansicht aktualisieren oder schließen
  if (selectedKontogruppe) {
    const stillExists = lastFilteredRows.some(r => String(r.kontogruppe ?? "") === String(selectedKontogruppe));
    if (stillExists) showDetailForKontogruppe(selectedKontogruppe);
    else {
      selectedKontogruppe = null;
      hideDetail();
    }
  }
}

/* ---------- Init ---------- */
async function main() {
  const res = await fetch(DATA_URL);
  raw = (await res.json()).map(r => ({ ...r, betrag: parseGermanNumber(r.betrag) }));

  const sel = document.getElementById("gruppeSelect");
  uniqueSorted(raw.map(r => r.gruppe)).forEach(g => {
    const o = document.createElement("option");
    o.value = g;
    o.textContent = g;
    sel.appendChild(o);
  });

  sel.addEventListener("change", () => {
    selectedKontogruppe = null;
    hideDetail();
    rerender();
  });

  document.getElementById("btnAll").onclick = () => {
    [...sel.options].forEach(o => (o.selected = false));
    selectedKontogruppe = null;
    hideDetail();
    rerender();
  };

  rerender();
}

main();
