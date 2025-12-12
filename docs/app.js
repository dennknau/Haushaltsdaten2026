const DATA_URL = "./haushalt.json";

let raw = [];
let tab = null;

const ALL_VALUE = "__ALL__";

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

function extractSachkontoNumber(sachkonto) {
  const m = String(sachkonto ?? "").match(/^\s*(\d+)/);
  return m ? m[1] : "";
}

function isErtragBySachkonto(sachkonto) {
  const nr = extractSachkontoNumber(sachkonto);
  return nr.startsWith("5") || nr.startsWith("91");
}

function kontogruppeNum(kg) {
  const m = String(kg ?? "").match(/^\s*(\d+)/);
  return m ? parseInt(m[1], 10) : NaN;
}

/* ---------- DOM Helper ---------- */
const $ = id => document.getElementById(id);

/* ---------- Select Helper ---------- */
function fillSelect(el, values, withAll = false) {
  el.innerHTML = "";

  if (withAll) {
    el.add(new Option("Alle anzeigen", ALL_VALUE));
  }

  values.forEach(v => el.add(new Option(v, v)));
}

/* ---------- Kaskade ---------- */
function rebuildGruppe1Options() {
  const jahr = $("jahrSelect").value;

  const values = uniqueSorted(
    raw.filter(r => r.jahr === jahr).map(r => r.gruppe1)
  );

  fillSelect($("gruppe1Select"), values, true);
  $("gruppe1Select").value = ALL_VALUE;
}

function rebuildGruppeOptions() {
  const jahr = $("jahrSelect").value;
  const g1 = $("gruppe1Select").value;

  let rows = raw.filter(r => r.jahr === jahr);
  if (g1 !== ALL_VALUE) {
    rows = rows.filter(r => r.gruppe1 === g1);
  }

  const gruppen = uniqueSorted(rows.map(r => r.gruppe));
  const sel = $("gruppeSelect");
  sel.innerHTML = "";
  gruppen.forEach(g => sel.add(new Option(g, g)));
}

/* ---------- Aggregation ---------- */
function aggregateByKontogruppe(rows) {
  const map = new Map();

  for (const r of rows) {
    const kg = r.kontogruppe || "(ohne kontogruppe)";
    if (!map.has(kg)) map.set(kg, { kontogruppe: kg, aufwendungen: 0, ertraege: 0 });

    if (isErtragBySachkonto(r.sachkonto)) {
      map.get(kg).ertraege += -r.betrag;
    } else {
      map.get(kg).aufwendungen += r.betrag;
    }
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
function renderOverview(rows) {
  let er = 0, aw = 0;

  rows.forEach(r => {
    if (isErtragBySachkonto(r.sachkonto)) er += -r.betrag;
    else aw += r.betrag;
  });

  const erg = aw - er;

  $("sumErtrag").textContent = fmtEUR(er);
  $("sumAufwand").textContent = fmtEUR(aw);

  let label = "Ausgeglichen";
  let value = 0;
  if (erg < 0) { label = "Überschuss"; value = Math.abs(erg); }
  else if (erg > 0) { label = "Defizit"; value = erg; }

  $("sumErgebnis").innerHTML = `<b>${fmtEUR(value)} (${label})</b>`;
}

/* ---------- Tabelle ---------- */
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
  const labels = agg.map(a => a.kontogruppe);

  Plotly.react("pieErtraege", [{
    type: "pie",
    labels,
    values: agg.map(a => Math.max(0, a.ertraege)),
  }], { margin: { t: 10, b: 10 } });

  Plotly.react("pieAufwendungen", [{
    type: "pie",
    labels,
    values: agg.map(a => Math.max(0, a.aufwendungen)),
  }], { margin: { t: 10, b: 10 } });
}

/* ---------- Render ---------- */
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
  renderPies(agg);

  $("status").textContent = `Zeilen: ${rows.length} | Kontogruppen: ${agg.length}`;
}

/* ---------- Init ---------- */
fetch(DATA_URL)
  .then(r => r.json())
  .then(json => {
    raw = json.map(r => ({
      jahr: String(r.Jahr ?? r.jahr).trim(),
      gruppe1: String(r.gruppe1).trim(),
      gruppe: String(r.gruppe).trim(),
      kontogruppe: String(r.kontogruppe).trim(),
      sachkonto: String(r.sachkonto).trim(),
      betrag: parseGermanNumber(r.betrag),
    }));

    fillSelect($("jahrSelect"), uniqueSorted(raw.map(r => r.jahr)));
    $("jahrSelect").selectedIndex = 0;

    rebuildGruppe1Options();
    rebuildGruppeOptions();
    rerender();

    $("jahrSelect").onchange = () => {
      rebuildGruppe1Options();
      rebuildGruppeOptions();
      rerender();
    };

    $("gruppe1Select").onchange = () => {
      rebuildGruppeOptions();
      rerender();
    };

    $("gruppeSelect").onchange = rerender;
    $("resetGruppe").onclick = () => {
      [...$("gruppeSelect").options].forEach(o => o.selected = false);
      rerender();
    };
    $("resetGruppe1").onclick = () => {
      $("gruppe1Select").value = ALL_VALUE;
      rebuildGruppeOptions();
      rerender();
    };
    $("resetJahr").onclick = () => {
      $("jahrSelect").selectedIndex = 0;
      rebuildGruppe1Options();
      rebuildGruppeOptions();
      rerender();
    };
  });
