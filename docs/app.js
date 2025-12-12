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
  return [...new Set(arr)].filter(Boolean).map(String)
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

/* ---------- Aggregation ---------- */
function aggregateByKontogruppe(rows) {
  const map = new Map();

  for (const r of rows) {
    const kg = String(r.kontogruppe ?? "(ohne kontogruppe)");
    const betrag = r.betrag;
    const istErtrag = isErtragBySachkonto(r.sachkonto);

    if (!map.has(kg)) map.set(kg, { kontogruppe: kg, aufwendungen: 0, ertraege: 0, saldo: 0 });
    const o = map.get(kg);

    if (istErtrag) o.ertraege += -betrag;
    else o.aufwendungen += betrag;

    o.saldo = o.aufwendungen - o.ertraege;
  }

  return [...map.values()].sort((a, b) => {
    const na = kontogruppeNum(a.kontogruppe);
    const nb = kontogruppeNum(b.kontogruppe);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.kontogruppe.localeCompare(b.kontogruppe, "de");
  });
}

/* ---------- Overview ---------- */
function computeOverviewTotals(rows) {
  let ertraegeOhne91 = 0;
  let aufwendungenOhne92 = 0;

  for (const r of rows) {
    const betrag = r.betrag;
    const istErtrag = isErtragBySachkonto(r.sachkonto);

    if (istErtrag && !startsWithPrefix(r.sachkonto, "91")) ertraegeOhne91 += -betrag;
    if (!istErtrag && !startsWithPrefix(r.sachkonto, "92")) aufwendungenOhne92 += betrag;
  }

  return {
    ertraegeOhne91,
    aufwendungenOhne92,
    ergebnis: aufwendungenOhne92 - ertraegeOhne91,
  };
}

function setBarWidth(barEl, value, maxValue) {
  if (!barEl) return;
  const w = Math.min(100, (Math.abs(value) / Math.max(maxValue, 1)) * 100);
  barEl.style.width = `${w}%`;
}

function renderOverview(o) {
  document.getElementById("sumErtrag").textContent = fmtEUR(o.ertraegeOhne91);
  document.getElementById("sumAufwand").textContent = fmtEUR(o.aufwendungenOhne92);

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

  const maxAbs = Math.max(
    Math.abs(o.ertraegeOhne91),
    Math.abs(o.aufwendungenOhne92),
    Math.abs(o.ergebnis),
    1
  );

  setBarWidth(document.getElementById("barErtrag"), o.ertraegeOhne91, maxAbs);
  setBarWidth(document.getElementById("barAufwand"), o.aufwendungenOhne92, maxAbs);
  setBarWidth(document.getElementById("barErgebnis"), o.ergebnis, maxAbs);
}

/* ---------- Tabelle ---------- */
function renderTable(data) {
  if (!table) {
    table = new Tabulator("#table", {
      data,
      layout: "fitColumns",
      height: "520px",
      columns: [
        { title: "Kontogruppe", field: "kontogruppe", widthGrow: 3 },
        { title: "Aufwendungen", field: "aufwendungen", hozAlign: "right", formatter: c => fmtEUR(c.getValue()) },
        { title: "Erträge", field: "ertraege", hozAlign: "right", formatter: c => fmtEUR(c.getValue()) },
        { title: "Saldo", field: "saldo", hozAlign: "right", formatter: c => fmtEUR(c.getValue()) },
      ],
    });
  } else {
    table.replaceData(data);
  }
}

/* ---------- Render ---------- */
function rerender() {
  const filtered = filterRows(raw, getSelectedGruppen());
  renderOverview(computeOverviewTotals(filtered));
  renderTable(aggregateByKontogruppe(filtered));
  document.getElementById("status").textContent = `Zeilen: ${filtered.length}`;
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

  rerender();
}

main();
