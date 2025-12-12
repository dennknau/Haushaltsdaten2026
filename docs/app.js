const DATA_URL = "./haushalt.json";

let raw = [];
let tab = null;

/* ---------- Feldzugriff (robust) ---------- */
function getField(r, ...keys) {
  for (const k of keys) if (r && r[k] !== undefined && r[k] !== null) return r[k];
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

/* ---------- UI Getter ---------- */
function $id(id) { return document.getElementById(id); }
function getSelectedValue(id) { const el = $id(id); return el ? el.value : ""; }
function getSelectedMulti(id) { const el = $id(id); return el ? [...el.selectedOptions].map(o => o.value) : []; }

function fillSelect(el, values) {
  el.innerHTML = "";
  values.forEach(v => el.add(new Option(v, v)));
}

/* ---------- Kaskade ---------- */
function rebuildGruppe1Options() {
  const jahr = getSelectedValue("jahrSelect");
  const g1Select = $id("gruppe1Select");

  const g1Values = uniqueSorted(raw.filter(r => r.jahr === jahr).map(r => r.gruppe1));
  fillSelect(g1Select, g1Values);

  if (g1Values.length) g1Select.value = g1Values[0];
}

function rebuildGruppeOptions() {
  const jahr = getSelectedValue("jahrSelect");
  const g1 = getSelectedValue("gruppe1Select");
  const gruppeSelect = $id("gruppeSelect");

  const gruppen = uniqueSorted(
    raw.filter(r => r.jahr === jahr && r.gruppe1 === g1).map(r => r.gruppe)
  );

  gruppeSelect.innerHTML = "";
  gruppen.forEach(g => gruppeSelect.add(new Option(g, g)));
}

/* ---------- Daten & Aggregation ---------- */
function aggregateByKontogruppe(rows) {
  const map = new Map();

  for (const r of rows) {
    const kg = String(r.kontogruppe ?? "(ohne kontogruppe)");
    const betrag = Number(r.betrag ?? 0);
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

/* ---------- Übersicht ---------- */
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

  $id("sumErtrag").textContent = fmtEUR(ertraege);
  $id("sumAufwand").textContent = fmtEUR(aufwendungen);

  let label = "Ausgeglichen";
  let displayValue = 0;
  if (ergebnis < 0) { label = "Überschuss"; displayValue = Math.abs(ergebnis); }
  else if (ergebnis > 0) { label = "Defizit"; displayValue = ergebnis; }

  $id("sumErgebnis").innerHTML = `<b>${fmtEUR(displayValue)} (${label})</b>`;

  const maxAbs = Math.max(Math.abs(ertraege), Math.abs(aufwendungen), Math.abs(ergebnis), 1);
  setBarWidth($id("barErtrag"), ertraege, maxAbs);
  setBarWidth($id("barAufwand"), aufwendungen, maxAbs);
  setBarWidth($id("barErgebnis"), ergebnis, maxAbs);
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
        { title: "Kontogruppe", field: "kontogruppe", sorter: kgSorter, headerFilter: "input", widthGrow: 3 },
        { title: "Aufwendungen", field: "aufwendungen", sorter: "number", hozAlign: "right", formatter: c => fmtEUR(c.getValue()) },
        { title: "Erträge", field: "ertraege", sorter: "number", hozAlign: "right", formatter: c => fmtEUR(c.getValue()) },
      ],
    });
  } else {
    tab.replaceData(agg);
  }
}

/* ---------- Pies ---------- */
function renderPies(agg) {
  if (typeof Plotly === "undefined") return;

  const elE = $id("pieErtraege");
  const elA = $id("pieAufwendungen");
  if (!elE || !elA) return;

  const labels = agg.map(d => d.kontogruppe);
  const valuesE = agg.map(d => Math.max(0, d.ertraege));
  const valuesA = agg.map(d => Math.max(0, d.aufwendungen));

  const ePairs = labels.map((l, i) => [l, valuesE[i]]).filter(([, v]) => v > 0);
  const aPairs = labels.map((l, i) => [l, valuesA[i]]).filter(([, v]) => v > 0);

  const layout = { margin: { l: 10, r: 10, t: 10, b: 10 }, showlegend: true };

  Plotly.react(elE, [{
    type: "pie",
    labels: ePairs.map(p => p[0]),
    values: ePairs.map(p => p[1]),
    textinfo: "percent",
    hovertemplate: "%{label}<br>%{value:.2f} €<br>%{percent}<extra></extra>",
  }], layout, { responsive: true });

  Plotly.react(elA, [{
    type: "pie",
    labels: aPairs.map(p => p[0]),
    values: aPairs.map(p => p[1]),
    textinfo: "percent",
    hovertemplate: "%{label}<br>%{value:.2f} €<br>%{percent}<extra></extra>",
  }], layout, { responsive: true });
}

/* ---------- Render ---------- */
function rerender() {
  const jahr = getSelectedValue("jahrSelect");
  const g1 = getSelectedValue("gruppe1Select");
  const gruppen = getSelectedMulti("gruppeSelect");

  const filtered = raw.filter(r => {
    const okJahr = r.jahr === jahr;
    const okG1 = r.gruppe1 === g1;
    const okGruppe = gruppen.length ? gruppen.includes(r.gruppe) : true;
    return okJahr && okG1 && okGruppe;
  });

  renderOverview(filtered);

  const agg = aggregateByKontogruppe(filtered);
  renderTable(agg);

  requestAnimationFrame(() => renderPies(agg));
  setTimeout(() => renderPies(agg), 0);

  $id("status").textContent = `Zeilen: ${filtered.length} | Kontogruppen: ${agg.length}`;
}

/* ---------- Reset-Buttons ---------- */
function resetJahrToDefault() {
  const jahrSelect = $id("jahrSelect");
  if (jahrSelect.options.length) jahrSelect.selectedIndex = 0;

  rebuildGruppe1Options();
  rebuildGruppeOptions();
  clearKostenstellenSelection();
  rerender();
}

function resetGruppe1ToDefault() {
  const g1Select = $id("gruppe1Select");
  if (g1Select.options.length) g1Select.selectedIndex = 0;

  rebuildGruppeOptions();
  clearKostenstellenSelection();
  rerender();
}

function clearKostenstellenSelection() {
  const gruppeSelect = $id("gruppeSelect");
  [...gruppeSelect.options].forEach(o => (o.selected = false));
}

/* ---------- Init ---------- */
async function main() {
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error(`Konnte ${DATA_URL} nicht laden (HTTP ${res.status})`);

  const json = await res.json();
  if (!Array.isArray(json)) throw new Error(`${DATA_URL} muss ein JSON-Array [...] sein.`);

  // Normalisieren (Jahr kann groß geschrieben sein)
  raw = json.map(r => ({
    jahr: String(getField(r, "Jahr", "jahr")).trim(),
    gruppe: String(getField(r, "gruppe")).trim(),
    gruppe1: String(getField(r, "gruppe1")).trim(),
    kontogruppe: String(getField(r, "kontogruppe")).trim(),
    sachkonto: String(getField(r, "sachkonto")).trim(),
    betrag: parseGermanNumber(getField(r, "betrag")),
  }));

  // Jahr-Optionen
  const jahrSelect = $id("jahrSelect");
  const jahre = uniqueSorted(raw.map(r => r.jahr));
  fillSelect(jahrSelect, jahre);
  if (jahre.length) jahrSelect.selectedIndex = 0;

  // Kaskade initial
  rebuildGruppe1Options();
  rebuildGruppeOptions();

  // Events
  jahrSelect.addEventListener("change", () => {
    rebuildGruppe1Options();
    rebuildGruppeOptions();
    clearKostenstellenSelection();
    rerender();
  });

  $id("gruppe1Select").addEventListener("change", () => {
    rebuildGruppeOptions();
    clearKostenstellenSelection();
    rerender();
  });

  $id("gruppeSelect").addEventListener("change", rerender);

  // Reset je Filter
  $id("resetJahr").addEventListener("click", resetJahrToDefault);
  $id("resetGruppe1").addEventListener("click", resetGruppe1ToDefault);
  $id("resetGruppe").addEventListener("click", () => {
    clearKostenstellenSelection();
    rerender();
  });

  rerender();
}

main().catch(err => {
  console.error(err);
  alert("Fehler: " + (err?.message ?? err));
});
