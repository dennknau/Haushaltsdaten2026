const DATA_URL = "./haushalt.json";

let raw = [];
let tab = null;

/* ---------- Feldzugriff (robust für Jahr/jahr etc.) ---------- */
function getField(r, ...keys) {
  for (const k of keys) {
    if (r && r[k] !== undefined && r[k] !== null) return r[k];
  }
  return "";
}

/* ---------- Helpers ---------- */
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
    .map(v => String(v ?? "").trim())
    .filter(v => v !== "")
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

/* ---------- UI Getter ---------- */
function getSelectedValue(id) {
  const el = document.getElementById(id);
  return el ? el.value : "";
}
function getSelectedMulti(id) {
  const el = document.getElementById(id);
  return el ? [...el.selectedOptions].map(o => o.value) : [];
}

/* ---------- Filterkaskade: Jahr -> gruppe1 -> gruppe ---------- */
function fillSelect(el, values) {
  el.innerHTML = "";
  values.forEach(v => el.add(new Option(v, v)));
}

function rebuildGruppe1Options() {
  const jahr = getSelectedValue("jahrSelect");
  const g1Select = document.getElementById("gruppe1Select");

  const g1Values = uniqueSorted(
    raw
      .filter(r => String(r.jahr) === String(jahr))
      .map(r => r.gruppe1)
  );

  fillSelect(g1Select, g1Values);
  if (g1Values.length) g1Select.value = g1Values[0];
}

function rebuildGruppeOptions() {
  const jahr = getSelectedValue("jahrSelect");
  const g1 = getSelectedValue("gruppe1Select");
  const gruppeSelect = document.getElementById("gruppeSelect");

  const gruppen = uniqueSorted(
    raw
      .filter(r => String(r.jahr) === String(jahr) && String(r.gruppe1) === String(g1))
      .map(r => r.gruppe)
  );

  gruppeSelect.innerHTML = "";
  for (const g of gruppen) {
    const opt = new Option(g, g);
    gruppeSelect.add(opt);
  }
}

/* ---------- Aggregation nach Kontogruppe (für Tabelle + Pies) ---------- */
function aggregateByKontogruppe(rows) {
  const map = new Map();

  for (const r of rows) {
    const kg = String(r.kontogruppe ?? "(ohne kontogruppe)");
    const betrag = Number(r.betrag ?? 0);
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

/* ---------- Gesamtübersicht ---------- */
function setBarWidth(barEl, value, maxValue) {
  if (!barEl) return;
  const w = Math.min(100, (Math.abs(value) / Math.max(maxValue, 1)) * 100);
  barEl.style.width = `${w}%`;
}

function renderOverview(rows) {
  let ertraege = 0;
  let aufwendungen = 0;

  for (const r of rows) {
    const betrag = Number(r.betrag ?? 0);
    if (isErtragBySachkonto(r.sachkonto)) ertraege += -betrag;
    else aufwendungen += betrag;
  }

  const ergebnis = aufwendungen - ertraege;

  document.getElementById("sumErtrag").textContent = fmtEUR(ertraege);
  document.getElementById("sumAufwand").textContent = fmtEUR(aufwendungen);

  // Ergebnis-Text: Überschuss/Defizit
  let label = "Ausgeglichen";
  let displayValue = 0;
  if (ergebnis < 0) { label = "Überschuss"; displayValue = Math.abs(ergebnis); }
  else if (ergebnis > 0) { label = "Defizit"; displayValue = ergebnis; }

  document.getElementById("sumErgebnis").innerHTML = `<b>${fmtEUR(displayValue)} (${label})</b>`;

  const maxAbs = Math.max(Math.abs(ertraege), Math.abs(aufwendungen), Math.abs(ergebnis), 1);
  setBarWidth(document.getElementById("barErtrag"), ertraege, maxAbs);
  setBarWidth(document.getElementById("barAufwand"), aufwendungen, maxAbs);
  setBarWidth(document.getElementById("barErgebnis"), ergebnis, maxAbs);
}

/* ---------- Tabelle ---------- */
function renderTable(agg) {
  const kgSorter = (a, b) => {
    const na = kontogruppeNum(a);
    const nb = kontogruppeNum(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    if (!isNaN(na)) return -1;
    if (!isNaN(nb)) return 1;
    return String(a).localeCompare(String(b), "de");
  };

  if (!tab) {
    tab = new Tabulator("#table", {
      data: agg,
      layout: "fitColumns",
      height: false,
      columns: [
        { title: "kontogruppe", field: "kontogruppe", sorter: kgSorter, headerFilter: "input", widthGrow: 3 },
        { title: "betrag (Aufwendungen)", field: "aufwendungen", sorter: "number", hozAlign: "right", formatter: c => fmtEUR(c.getValue()) },
        { title: "betrag (Erträge)", field: "ertraege", sorter: "number", hozAlign: "right", formatter: c => fmtEUR(c.getValue()) },
      ],
    });
  } else {
    tab.replaceData(agg);
  }
}

/* ---------- Pies ---------- */
function renderPies(agg) {
  if (typeof Plotly === "undefined") return;

  const elE = document.getElementById("pieErtraege");
  const elA = document.getElementById("pieAufwendungen");
  if (!elE || !elA) return;

  const labels = agg.map(d => d.kontogruppe);

  // Pie braucht >= 0
  const valuesE = agg.map(d => Math.max(0, d.ertraege));
  const valuesA = agg.map(d => Math.max(0, d.aufwendungen));

  const ePairs = labels.map((l, i) => [l, valuesE[i]]).filter(([, v]) => v > 0);
  const aPairs = labels.map((l, i) => [l, valuesA[i]]).filter(([, v]) => v > 0);

  const layout = { margin: { l: 10, r: 10, t: 10, b: 10 }, showlegend: true };

  Plotly.react(
    elE,
    [{
      type: "pie",
      labels: ePairs.map(p => p[0]),
      values: ePairs.map(p => p[1]),
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
      labels: aPairs.map(p => p[0]),
      values: aPairs.map(p => p[1]),
      textinfo: "percent",
      hovertemplate: "%{label}<br>%{value:.2f} €<br>%{percent}<extra></extra>",
    }],
    layout,
    { responsive: true }
  );
}

/* ---------- Zentrale Render-Funktion ---------- */
function rerender() {
  const jahr = getSelectedValue("jahrSelect");
  const g1 = getSelectedValue("gruppe1Select");
  const gruppen = getSelectedMulti("gruppeSelect");

  const filtered = raw.filter(r => {
    const okJahr = String(r.jahr) === String(jahr);
    const okG1 = String(r.gruppe1) === String(g1);
    const okGruppe = gruppen.length ? gruppen.includes(String(r.gruppe)) : true;
    return okJahr && okG1 && okGruppe;
  });

  renderOverview(filtered);

  const agg = aggregateByKontogruppe(filtered);
  renderTable(agg);

  // Pies zuverlässig beim Laden
  requestAnimationFrame(() => renderPies(agg));
  setTimeout(() => renderPies(agg), 0);

  const status = document.getElementById("status");
  if (status) status.textContent = `Zeilen: ${filtered.length} | Kontogruppen: ${agg.length}`;
}

/* ---------- Init ---------- */
async function main() {
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error(`Konnte ${DATA_URL} nicht laden (HTTP ${res.status})`);

  const json = await res.json();
  if (!Array.isArray(json)) throw new Error(`${DATA_URL} muss ein JSON-Array [...] sein.`);

  // Normalisieren auf unsere internen Keys (jahr/gruppe1/gruppe/...)
  raw = json.map(r => ({
    jahr: String(getField(r, "Jahr", "jahr")).trim(),
    gruppe: String(getField(r, "gruppe", "Gruppe")).trim(),
    gruppe1: String(getField(r, "gruppe1", "Gruppe1", "gruppe_1", "Gruppe_1")).trim(),
    kontogruppe: String(getField(r, "kontogruppe", "KontoGruppe", "Kontogruppe")).trim(),
    sachkonto: String(getField(r, "sachkonto", "Sachkonto")).trim(),
    betrag: parseGermanNumber(getField(r, "betrag", "Betrag")),
  }));

  // Jahr-Select füllen
  const jahrSelect = document.getElementById("jahrSelect");
  const jahre = uniqueSorted(raw.map(r => r.jahr));
  fillSelect(jahrSelect, jahre);
  if (jahre.length) jahrSelect.value = jahre[0];

  // Events
  jahrSelect.addEventListener("change", () => {
    rebuildGruppe1Options();
    rebuildGruppeOptions();
    rerender();
  });

  document.getElementById("gruppe1Select").addEventListener("change", () => {
    rebuildGruppeOptions();
    // Auswahl Kostenstellen leeren, weil neue Liste
    const gruppeSelect = document.getElementById("gruppeSelect");
    [...gruppeSelect.options].forEach(o => (o.selected = false));
    rerender();
  });

  document.getElementById("gruppeSelect").addEventListener("change", rerender);

  document.getElementById("btnAll").addEventListener("click", () => {
    const gruppeSelect = document.getElementById("gruppeSelect");
    [...gruppeSelect.options].forEach(o => (o.selected = false));
    rerender();
  });

  // initial
  rebuildGruppe1Options();
  rebuildGruppeOptions();
  rerender();
}

main().catch(err => {
  console.error(err);
  alert("Fehler: " + (err?.message ?? err));
});
