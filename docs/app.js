const DATA_URL = "./haushalt.json";
const ALL_VALUE = "__ALL__";

let raw = [];
let tab = null;

/* ---------- Helpers ---------- */
const $ = (id) => document.getElementById(id);

function getField(r, ...keys) {
  for (const k of keys) if (r && r[k] !== undefined && r[k] !== null) return r[k];
  return "";
}

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

function uniqueSorted(arr) {
  return [...new Set(arr)]
    .map(v => String(v ?? "").trim())
    .filter(v => v !== "")
    .sort((a, b) => a.localeCompare(b, "de"));
}

function kontogruppeNum(kg) {
  const m = String(kg ?? "").match(/^\s*(\d+)/);
  return m ? parseInt(m[1], 10) : NaN;
}

function extractSachkontoNumber(sachkonto) {
  const m = String(sachkonto ?? "").match(/^\s*(\d+)/);
  return m ? m[1] : "";
}

function isErtragBySachkonto(sachkonto) {
  const nr = extractSachkontoNumber(sachkonto);
  return nr.startsWith("5") || nr.startsWith("91");
}

function fillSelect(el, values, withAll = false) {
  el.innerHTML = "";
  if (withAll) el.add(new Option("Alle anzeigen", ALL_VALUE));
  values.forEach(v => el.add(new Option(v, v)));
}

function clearMultiSelection(selectEl) {
  [...selectEl.options].forEach(o => (o.selected = false));
}

/* ---------- Build Select Options ---------- */
function rebuildGruppe1Options() {
  const jahr = $("jahrSelect").value;

  const g1Values = uniqueSorted(
    raw.filter(r => r.jahr === jahr).map(r => r.gruppe1)
  );

  // ✅ WICHTIG: "Alle anzeigen" IMMER oben
  fillSelect($("gruppe1Select"), g1Values, true);

  // ✅ Standard: "Alle anzeigen"
  $("gruppe1Select").value = ALL_VALUE;
}

function rebuildGruppeOptions() {
  const jahr = $("jahrSelect").value;
  const g1 = $("gruppe1Select").value;

  let rows = raw.filter(r => r.jahr === jahr);
  if (g1 !== ALL_VALUE) rows = rows.filter(r => r.gruppe1 === g1);

  const gruppen = uniqueSorted(rows.map(r => r.gruppe));
  fillSelect($("gruppeSelect"), gruppen, false);
}

/* ---------- Aggregation ---------- */
function aggregateByKontogruppe(rows) {
  const map = new Map();

  for (const r of rows) {
    const kg = String(r.kontogruppe ?? "(ohne kontogruppe)");
    if (!map.has(kg)) map.set(kg, { kontogruppe: kg, aufwendungen: 0, ertraege: 0 });

    const o = map.get(kg);
    if (isErtragBySachkonto(r.sachkonto)) o.ertraege += -r.betrag;
    else o.aufwendungen += r.betrag;
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

/* ---------- Overview + Bars ---------- */
function setBarWidth(barEl, value, maxValue) {
  if (!barEl) return;
  const w = Math.min(100, (Math.abs(value) / Math.max(maxValue, 1)) * 100);
  barEl.style.width = `${w}%`;
}

function renderOverview(rows) {
  let er = 0, aw = 0;
  for (const r of rows) {
    if (isErtragBySachkonto(r.sachkonto)) er += -r.betrag;
    else aw += r.betrag;
  }

  const erg = aw - er;

  $("sumErtrag").textContent = fmtEUR(er);
  $("sumAufwand").textContent = fmtEUR(aw);

  let label = "Ausgeglichen";
  let displayValue = 0;
  if (erg < 0) { label = "Überschuss"; displayValue = Math.abs(erg); }
  else if (erg > 0) { label = "Defizit"; displayValue = erg; }

  $("sumErgebnis").innerHTML = `<b>${fmtEUR(displayValue)} (${label})</b>`;

  const maxAbs = Math.max(Math.abs(er), Math.abs(aw), Math.abs(erg), 1);
  setBarWidth($("barErtrag"), er, maxAbs);
  setBarWidth($("barAufwand"), aw, maxAbs);
  setBarWidth($("barErgebnis"), erg, maxAbs);
}

/* ---------- Table ---------- */
function renderTable(agg) {
  if (!tab) {
    tab = new Tabulator("#table", {
      data: agg,
      layout: "fitColumns",
      height: false,
      columns: [
        { title: "Kontogruppe", field: "kontogruppe", widthGrow: 3 },
        { title: "Aufwendungen", field: "aufwendungen", hozAlign: "right", formatter: c => fmtEUR(c.getValue()) },
        { title: "Erträge", field: "ertraege", hozAlign: "right", formatter: c => fmtEUR(c.getValue()) },
      ],
    });
  } else {
    tab.replaceData(agg);
  }
}

/* ---------- Pies ---------- */
function renderPies(agg) {
  if (typeof Plotly === "undefined") return;

  const labels = agg.map(a => a.kontogruppe);

  Plotly.react("pieErtraege", [{
    type: "pie",
    labels,
    values: agg.map(a => Math.max(0, a.ertraege)),
    textinfo: "percent",
    hovertemplate: "%{label}<br>%{value:.2f} €<br>%{percent}<extra></extra>",
  }], { margin: { l: 10, r: 10, t: 10, b: 10 }, showlegend: true }, { responsive: true });

  Plotly.react("pieAufwendungen", [{
    type: "pie",
    labels,
    values: agg.map(a => Math.max(0, a.aufwendungen)),
    textinfo: "percent",
    hovertemplate: "%{label}<br>%{value:.2f} €<br>%{percent}<extra></extra>",
  }], { margin: { l: 10, r: 10, t: 10, b: 10 }, showlegend: true }, { responsive: true });
}

/* ---------- Main render pipeline ---------- */
function rerender() {
  const jahr = $("jahrSelect").value;
  const g1 = $("gruppe1Select").value;
  const gruppen = [...$("gruppeSelect").selectedOptions].map(o => o.value);

  let rows = raw.filter(r => r.jahr === jahr);
  if (g1 !== ALL_VALUE) rows = rows.filter(r => r.gruppe1 === g1);
  if (gruppen.length) rows = rows.filter(r => gruppen.includes(r.gruppe));

  renderOverview(rows);

  const agg = aggregateByKontogruppe(rows);
  renderTable(agg);

  // Pies sofort zuverlässig
  requestAnimationFrame(() => renderPies(agg));
  setTimeout(() => renderPies(agg), 0);

  $("status").textContent = `Zeilen: ${rows.length} | Kontogruppen: ${agg.length}`;
}

/* ---------- Init ---------- */
async function main() {
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error(`Konnte ${DATA_URL} nicht laden (HTTP ${res.status})`);
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error(`${DATA_URL} muss ein JSON-Array sein.`);

  // ✅ Robust: Jahr kann "Jahr" heißen, gruppe1 evtl. anders
  raw = json.map(r => ({
    jahr: String(getField(r, "Jahr", "jahr")).trim(),
    gruppe: String(getField(r, "gruppe", "Gruppe")).trim(),
    gruppe1: String(getField(r, "gruppe1", "Gruppe1", "gruppe_1", "Gruppe_1")).trim(),
    kontogruppe: String(getField(r, "kontogruppe", "Kontogruppe")).trim(),
    sachkonto: String(getField(r, "sachkonto", "Sachkonto")).trim(),
    betrag: parseGermanNumber(getField(r, "betrag", "Betrag")),
  }));

  // Jahr füllen
const jahre = uniqueSorted(raw.map(r => r.jahr));
fillSelect($("jahrSelect"), jahre);

// ✅ Standardjahr bevorzugt auf 2026 setzen
if (jahre.includes("2026")) {
  $("jahrSelect").value = "2026";
} else if (jahre.length) {
  $("jahrSelect").value = jahre[0];
}

  // Initial kaskadieren
  rebuildGruppe1Options();     // setzt automatisch auf "Alle anzeigen"
  rebuildGruppeOptions();
  clearMultiSelection($("gruppeSelect"));

  // Events
  $("jahrSelect").addEventListener("change", () => {
    rebuildGruppe1Options();   // wieder "Alle anzeigen"
    rebuildGruppeOptions();
    clearMultiSelection($("gruppeSelect"));
    rerender();
  });

  $("gruppe1Select").addEventListener("change", () => {
    rebuildGruppeOptions();
    clearMultiSelection($("gruppeSelect"));
    rerender();
  });

  $("gruppeSelect").addEventListener("change", rerender);

  // Reset Buttons
  $("resetJahr").addEventListener("click", () => {
    $("jahrSelect").selectedIndex = 0;
    rebuildGruppe1Options();
    rebuildGruppeOptions();
    clearMultiSelection($("gruppeSelect"));
    rerender();
  });

  $("resetGruppe1").addEventListener("click", () => {
    $("gruppe1Select").value = ALL_VALUE;  // ✅ wieder "Alle anzeigen"
    rebuildGruppeOptions();
    clearMultiSelection($("gruppeSelect"));
    rerender();
  });

  $("resetGruppe").addEventListener("click", () => {
    clearMultiSelection($("gruppeSelect"));
    rerender();
  });

  // Erstes Rendering
  rerender();
}

main().catch(err => {
  console.error(err);
  alert("Fehler: " + (err?.message ?? err));
});

