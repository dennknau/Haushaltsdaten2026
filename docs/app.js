const DATA_URL = "./haushalt.json";

let raw = [];
let table;        // Kontogruppe-Tabelle
let detailTable;  // Sachkonto-Tabelle
let lastFilteredRows = [];
let selectedKontogruppe = null;

// ---------------- Helpers ----------------
function $(id) { return document.getElementById(id); }

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

function extractLeadingNumber(text) {
  const m = String(text ?? "").match(/^\s*(\d+)/);
  return m ? m[1] : "";
}

function isErtragBySachkonto(sachkonto) {
  const nr = extractLeadingNumber(sachkonto);
  return nr.startsWith("5") || nr.startsWith("91");
}

function startsWithPrefix(sachkonto, prefix) {
  return extractLeadingNumber(sachkonto).startsWith(prefix);
}

// ---------------- Filter ----------------
function getSelectedGruppen() {
  const sel = $("gruppeSelect");
  return sel ? [...sel.selectedOptions].map(o => o.value) : [];
}

function filterRows(rows, gruppen) {
  if (!gruppen.length) return rows;
  const set = new Set(gruppen);
  return rows.filter(r => set.has(String(r.gruppe)));
}

// ---------------- Aggregationen ----------------
function aggregateByKontogruppe(rows) {
  const map = new Map();

  for (const r of rows) {
    const kg = String(r.kontogruppe ?? "(ohne kontogruppe)");
    const betrag = r.betrag;
    const istErtrag = isErtragBySachkonto(r.sachkonto);

    if (!map.has(kg)) map.set(kg, { kontogruppe: kg, aufwendungen: 0, ertraege: 0 });
    const o = map.get(kg);

    // Vorzeichenlogik
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

function aggregateBySachkonto(rows) {
  const map = new Map();

  for (const r of rows) {
    const sk = String(r.sachkonto ?? "(ohne sachkonto)");
    const betrag = r.betrag;
    const istErtrag = isErtragBySachkonto(r.sachkonto);

    if (!map.has(sk)) map.set(sk, { sachkonto: sk, aufwendungen: 0, ertraege: 0 });
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

// ---------------- Gesamtübersicht ----------------
function computeOverviewTotals(rows) {
  let ertraege = 0;
  let aufwendungen = 0;

  for (const r of rows) {
    const betrag = r.betrag;
    const istErtrag = isErtragBySachkonto(r.sachkonto);

    if (istErtrag && !startsWithPrefix(r.sachkonto, "91")) ertraege += -betrag;
    if (!istErtrag && !startsWithPrefix(r.sachkonto, "92")) aufwendungen += betrag;
  }

  return { ertraege, aufwendungen, ergebnis: aufwendungen - ertraege };
}

function setBarWidth(el, value, maxValue) {
  if (!el) return;
  const w = Math.min(100, (Math.abs(value) / Math.max(maxValue, 1)) * 100);
  el.style.width = `${w}%`;
}

function renderOverview(o) {
  if ($("sumErtrag")) $("sumErtrag").textContent = fmtEUR(o.ertraege);
  if ($("sumAufwand")) $("sumAufwand").textContent = fmtEUR(o.aufwendungen);

  const ergebnisEl = $("sumErgebnis");
  let label = "Ausgeglichen";
  let displayValue = 0;

  if (o.ergebnis < 0) { label = "Überschuss"; displayValue = Math.abs(o.ergebnis); }
  else if (o.ergebnis > 0) { label = "Defizit"; displayValue = o.ergebnis; }

  if (ergebnisEl) ergebnisEl.innerHTML = `<b>${fmtEUR(displayValue)} (${label})</b>`;

  const maxAbs = Math.max(Math.abs(o.ertraege), Math.abs(o.aufwendungen), Math.abs(o.ergebnis), 1);
  setBarWidth($("barErtrag"), o.ertraege, maxAbs);
  setBarWidth($("barAufwand"), o.aufwendungen, maxAbs);
  setBarWidth($("barErgebnis"), o.ergebnis, maxAbs);
}

// ---------------- Pies (stabil: Plotly.react) ----------------
function renderPies(agg) {
  if (typeof Plotly === "undefined") return;

  const labels = agg.map(d => d.kontogruppe);
  const ertragVals = agg.map(d => Math.max(0, d.ertraege)).filter((v, i) => v > 0 && labels[i]);
  const ertragLabs = labels.filter((_, i) => Math.max(0, agg[i].ertraege) > 0);

  const aufwVals = agg.map(d => Math.max(0, d.aufwendungen)).filter((v, i) => v > 0 && labels[i]);
  const aufwLabs = labels.filter((_, i) => Math.max(0, agg[i].aufwendungen) > 0);

  const layout = { margin: { l: 10, r: 10, t: 10, b: 10 }, showlegend: true };

  // Falls keine Daten: leeres Plotly-Chart anzeigen, statt Fehler
  const dataErtrag = ertragVals.length ? [{
    type: "pie",
    labels: ertragLabs,
    values: ertragVals,
    textinfo: "percent",
    hovertemplate: "%{label}<br>%{value:.2f} €<br>%{percent}<extra></extra>",
  }] : [{
    type: "pie",
    labels: ["Keine Erträge"],
    values: [1],
    textinfo: "label",
    hoverinfo: "skip",
  }];

  const dataAufw = aufwVals.length ? [{
    type: "pie",
    labels: aufwLabs,
    values: aufwVals,
    textinfo: "percent",
    hovertemplate: "%{label}<br>%{value:.2f} €<br>%{percent}<extra></extra>",
  }] : [{
    type: "pie",
    labels: ["Keine Aufwendungen"],
    values: [1],
    textinfo: "label",
    hoverinfo: "skip",
  }];

  Plotly.react("pieErtraege", dataErtrag, layout, { responsive: true });
  Plotly.react("pieAufwendungen", dataAufw, layout, { responsive: true });
}

// ---------------- Tabellen ----------------
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
        {
          title: "Kontogruppe",
          field: "kontogruppe",
          sorter: kgSorter,
          headerFilter: "input",
          widthGrow: 3,
        },
        { title: "Aufwendungen", field: "aufwendungen", sorter: "number", hozAlign: "right", formatter: c => fmtEUR(c.getValue()) },
        { title: "Erträge", field: "ertraege", sorter: "number", hozAlign: "right", formatter: c => fmtEUR(c.getValue()) },
      ],
      rowFormatter: (row) => {
        row.getElement().style.cursor = "pointer";
      },
      rowClick: (e, row) => {
        const kg = row.getData().kontogruppe;

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

// ---------------- Drilldown ----------------
function hideDetail() {
  const sec = $("detailSection");
  if (sec) sec.style.display = "none";
}

function showDetailForKontogruppe(kontogruppe) {
  const sec = $("detailSection");
  const title = $("detailTitle");
  const count = $("detailCount");

  const rows = lastFilteredRows.filter(r => String(r.kontogruppe ?? "") === String(kontogruppe));
  const agg = aggregateBySachkonto(rows);

  if (title) title.textContent = kontogruppe;
  if (count) count.textContent = `Sachkonten: ${agg.length} | Zeilen: ${rows.length}`;
  if (sec) sec.style.display = "";

  renderDetailTable(agg);
}

// ---------------- Render Pipeline ----------------
function rerender() {
  try {
    lastFilteredRows = filterRows(raw, getSelectedGruppen());

    const overview = computeOverviewTotals(lastFilteredRows);
    renderOverview(overview);

    const agg = aggregateByKontogruppe(lastFilteredRows);
    renderTable(agg);

    // Pie-Render nach Layout-Tick -> startet zuverlässig sofort
    requestAnimationFrame(() => renderPies(agg));

    if ($("status")) {
      $("status").textContent = `Zeilen: ${lastFilteredRows.length} | Kontogruppen: ${agg.length}`;
    }

    // Detailansicht bei Filterwechsel aktualisieren / schließen
    if (selectedKontogruppe) {
      const stillExists = lastFilteredRows.some(r => String(r.kontogruppe ?? "") === String(selectedKontogruppe));
      if (stillExists) showDetailForKontogruppe(selectedKontogruppe);
      else { selectedKontogruppe = null; hideDetail(); }
    }
  } catch (err) {
    console.error(err);
    alert("Fehler beim Rendern: " + (err?.message ?? err));
  }
}

// ---------------- Init ----------------
async function main() {
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error(`Konnte ${DATA_URL} nicht laden (HTTP ${res.status})`);

  const json = await res.json();
  if (!Array.isArray(json)) throw new Error("haushalt.json muss ein JSON-Array [...] sein.");

  raw = json.map(r => ({ ...r, betrag: parseGermanNumber(r.betrag) }));

  const sel = $("gruppeSelect");
  if (!sel) throw new Error("Element #gruppeSelect fehlt in index.html.");

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

  const btnAll = $("btnAll");
  if (btnAll) {
    btnAll.onclick = () => {
      [...sel.options].forEach(o => (o.selected = false));
      selectedKontogruppe = null;
      hideDetail();
      rerender();
    };
  }

  // ✅ Initialer Render garantiert nach DOM/Layout
  requestAnimationFrame(() => rerender());
}

main().catch(err => {
  console.error(err);
  alert("Fehler: " + (err?.message ?? err));
});
