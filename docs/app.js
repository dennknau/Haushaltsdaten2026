const DATA_URL = "./haushalt.json";

let raw = [];
let table;

/* ---------- Helper ---------- */
function fmtEUR(n) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);
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

/* ---------- Aggregation nach Kontogruppe ---------- */
function aggregateByKontogruppe(rows) {
  const map = new Map();

  for (const r of rows) {
    const kg = String(r.kontogruppe ?? "(ohne kontogruppe)");
    const betrag = r.betrag;
    const istErtrag = isErtragBySachkonto(r.sachkonto);

    if (!map.has(kg)) map.set(kg, { kontogruppe: kg, aufwendungen: 0, ertraege: 0 });
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

  return { ertraege, aufwendungen, ergebnis: aufwendungen - ertraege };
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

  if (o.ergebnis < 0) { label = "Überschuss"; displayValue = Math.abs(o.ergebnis); }
  else if (o.ergebnis > 0) { label = "Defizit"; displayValue = o.ergebnis; }

  ergebnisEl.innerHTML = `<b>${fmtEUR(displayValue)} (${label})</b>`;

  const maxAbs = Math.max(Math.abs(o.ertraege), Math.abs(o.aufwendungen), Math.abs(o.ergebnis), 1);
  setBarWidth(document.getElementById("barErtrag"), o.ertraege, maxAbs);
  setBarWidth(document.getElementById("barAufwand"), o.aufwendungen, maxAbs);
  setBarWidth(document.getElementById("barErgebnis"), o.ergebnis, maxAbs);
}

/* ---------- Tabelle (ohne Saldo) ---------- */
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
      height: false,
      columns: [
        { title: "Kontogruppe", field: "kontogruppe", sorter: kgSorter, headerFilter: "input", widthGrow: 3 },
        { title: "Aufwendungen", field: "aufwendungen", sorter: "number", hozAlign: "right", formatter: c => fmtEUR(c.getValue()) },
        { title: "Erträge", field: "ertraege", sorter: "number", hozAlign: "right", formatter: c => fmtEUR(c.getValue()) },
      ],
    });
    table.setSort([{ column: "kontogruppe", dir: "asc" }]);
  } else {
    table.replaceData(data);
    table.setSort([{ column: "kontogruppe", dir: "asc" }]);
  }
}

/* ---------- Kreisdiagramme ---------- */
function renderPies(agg) {
  // Wenn Plotly noch nicht da ist (sollte nicht passieren), abbrechen
  if (typeof Plotly === "undefined") return;

  const elE = document.getElementById("pieErtraege");
  const elA = document.getElementById("pieAufwendungen");
  if (!elE || !elA) return;

  const labels = agg.map(d => d.kontogruppe);

  // Plotly Pie braucht >= 0; negative Werte (Vorzeichenfehler) kappen wir auf 0
  const valuesErtraege = agg.map(d => Math.max(0, d.ertraege));
  const valuesAufwand = agg.map(d => Math.max(0, d.aufwendungen));

  const ertragPairs = labels.map((l, i) => [l, valuesErtraege[i]]).filter(([, v]) => v > 0);
  const aufwandPairs = labels.map((l, i) => [l, valuesAufwand[i]]).filter(([, v]) => v > 0);

  const layout = {
    margin: { l: 10, r: 10, t: 10, b: 10 },
    showlegend: true,
    legend: { orientation: "v" },
  };

  Plotly.react(
    elE,
    [{
      type: "pie",
      labels: ertragPairs.map(p => p[0]),
      values: ertragPairs.map(p => p[1]),
      textinfo: "percent",
      hovertemplate: "%{label}<br>%{value:.2f} €<br>%{percent}<extra></extra>",
    }],
    layout,
    { responsive: true }
  );

  Plotly.react(
    elA,
    [{
      type: "pie",
      labels: aufwandPairs.map(p => p[0]),
      values: aufwandPairs.map(p => p[1]),
      textinfo: "percent",
      hovertemplate: "%{label}<br>%{value:.2f} €<br>%{percent}<extra></extra>",
    }],
    layout,
    { responsive: true }
  );
}

/* ---------- Render ---------- */
function rerender() {
  const filtered = filterRows(raw, getSelectedGruppen());

  renderOverview(computeOverviewTotals(filtered));

  const agg = aggregateByKontogruppe(filtered);
  renderTable(agg);

  // ✅ Fix: Pies erst rendern, wenn Layout sicher steht
  requestAnimationFrame(() => renderPies(agg));
  setTimeout(() => renderPies(agg), 0);

  document.getElementById("status").textContent =
    `Zeilen: ${filtered.length} | Kontogruppen: ${agg.length}`;
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

  sel.addEventListener("change", rerender);

  document.getElementById("btnAll").onclick = () => {
    [...sel.options].forEach(o => (o.selected = false));
    rerender();
  };

  // ✅ initial render
  rerender();

  // Optional: bei Resize neu zeichnen (Plotly responsive ist an, aber das hilft manchmal zusätzlich)
  window.addEventListener("resize", () => {
    const agg = aggregateByKontogruppe(filterRows(raw, getSelectedGruppen()));
    renderPies(agg);
  });
}

main().catch(err => {
  console.error(err);
  alert("Fehler: " + (err?.message ?? err));
});
