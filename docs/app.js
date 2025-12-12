const DATA_URL = "./haushalt.json";

let raw = [];
let table;

// ------------------ Helpers ------------------
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
    .filter(v => v !== undefined && v !== null && String(v).trim() !== "")
    .map(String)
    .sort((a, b) => a.localeCompare(b, "de"));
}

function setStatus(text) {
  const el = document.getElementById("status");
  if (el) el.textContent = text ?? "";
}

function extractSachkontoNumber(sachkonto) {
  const s = String(sachkonto ?? "");
  const m = s.match(/^\s*(\d+)/);
  return m ? m[1] : "";
}

function isErtragBySachkonto(sachkonto) {
  const nr = extractSachkontoNumber(sachkonto);
  return nr.startsWith("5") || nr.startsWith("91");
}

function startsWithPrefix(sachkonto, prefix) {
  const nr = extractSachkontoNumber(sachkonto);
  return nr.startsWith(prefix);
}

// ------------------ Filter ------------------
function getSelectedGruppen() {
  const sel = document.getElementById("gruppeSelect");
  return sel ? [...sel.selectedOptions].map(o => o.value) : [];
}

function filterRows(rows, gruppen) {
  if (!gruppen.length) return rows;
  const set = new Set(gruppen);
  return rows.filter(r => set.has(String(r.gruppe)));
}

// ------------------ Aggregation: Detail (Kontogruppe) ------------------
function aggregateByKontogruppe(rows) {
  const map = new Map();

  for (const r of rows) {
    const kg = String(r.kontogruppe ?? "(ohne kontogruppe)");
    const betrag = Number(r.betrag ?? 0);
    const istErtrag = isErtragBySachkonto(r.sachkonto);

    if (!map.has(kg)) {
      map.set(kg, { kontogruppe: kg, aufwendungen: 0, ertraege: 0, saldo: 0 });
    }
    const obj = map.get(kg);

    // Vorzeichenwirkung:
    if (istErtrag) obj.ertraege += -betrag;
    else obj.aufwendungen += betrag;

    obj.saldo = obj.aufwendungen - obj.ertraege;
  }

  const out = [...map.values()].sort((a, b) => {
    const na = kontogruppeNum(a.kontogruppe);
    const nb = kontogruppeNum(b.kontogruppe);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    if (!isNaN(na) && isNaN(nb)) return -1;
    if (isNaN(na) && !isNaN(nb)) return 1;
    return a.kontogruppe.localeCompare(b.kontogruppe, "de");
  });

  return out;
}

// ------------------ Aggregation: Gesamtübersicht ------------------
function computeOverviewTotals(rows) {
  let ertraegeOhne91 = 0;
  let aufwendungenOhne92 = 0;

  for (const r of rows) {
    const betrag = Number(r.betrag ?? 0);
    const istErtrag = isErtragBySachkonto(r.sachkonto);

    if (istErtrag) {
      if (!startsWithPrefix(r.sachkonto, "91")) {
        ertraegeOhne91 += -betrag;   // Vorzeichenwirkung
      }
    } else {
      if (!startsWithPrefix(r.sachkonto, "92")) {
        aufwendungenOhne92 += betrag; // Vorzeichenwirkung
      }
    }
  }

  const ergebnis = aufwendungenOhne92 - ertraegeOhne91;
  return { ertraegeOhne91, aufwendungenOhne92, ergebnis };
}

function setBarWidth(barEl, value, maxValue) {
  if (!barEl) return;
  const denom = maxValue <= 0 ? 1 : maxValue;
  const w = Math.max(0, Math.min(100, (Math.abs(value) / denom) * 100));
  barEl.style.width = `${w}%`;
}

function renderOverview(overview) {
  const elErtrag = document.getElementById("sumErtrag");
  const elAufwand = document.getElementById("sumAufwand");
  const elErgebnis = document.getElementById("sumErgebnis");

  if (elErtrag) elErtrag.textContent = fmtEUR(overview.ertraegeOhne91);
  if (elAufwand) elAufwand.textContent = fmtEUR(overview.aufwendungenOhne92);
  if (elErgebnis) elErgebnis.innerHTML = `<b>${fmtEUR(overview.ergebnis)}</b>`;

  const barErtrag = document.getElementById("barErtrag");
  const barAufwand = document.getElementById("barAufwand");
  const barErgebnis = document.getElementById("barErgebnis");

  const maxAbs = Math.max(
    Math.abs(overview.ertraegeOhne91),
    Math.abs(overview.aufwendungenOhne92),
    Math.abs(overview.ergebnis),
    1
  );

  setBarWidth(barErtrag, overview.ertraegeOhne91, maxAbs);
  setBarWidth(barAufwand, overview.aufwendungenOhne92, maxAbs);
  setBarWidth(barErgebnis, overview.ergebnis, maxAbs);
}

// ------------------ Render: Tabelle ------------------
function renderTable(data) {
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
      data,
      layout: "fitColumns",
      height: "520px",
      columns: [
        { title: "Kontogruppe", field: "kontogruppe", sorter: kgSorter, headerFilter: "input", widthGrow: 3 },
        { title: "Aufwendungen", field: "aufwendungen", sorter: "number", hozAlign: "right", formatter: c => fmtEUR(c.getValue()) },
        { title: "Erträge", field: "ertraege", sorter: "number", hozAlign: "right", formatter: c => fmtEUR(c.getValue()) },
        { title: "Saldo", field: "saldo", sorter: "number", hozAlign: "right", formatter: c => fmtEUR(c.getValue()) },
      ],
    });

    table.setSort([{ column: "kontogruppe", dir: "asc" }]);
  } else {
    table.replaceData(data);
    table.setSort([{ column: "kontogruppe", dir: "asc" }]);
  }
}

// ------------------ Render-Pipeline ------------------
function rerender() {
  const selected = getSelectedGruppen();
  const filtered = filterRows(raw, selected);

  const overview = computeOverviewTotals(filtered);
  renderOverview(overview);

  const agg = aggregateByKontogruppe(filtered);
  setStatus(`Zeilen: ${filtered.length} | Kontogruppen: ${agg.length}`);

  renderTable(agg);
}

// ------------------ Init ------------------
async function main() {
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error(`Konnte ${DATA_URL} nicht laden (HTTP ${res.status})`);

  raw = await res.json();
  if (!Array.isArray(raw)) throw new Error(`${DATA_URL} muss ein JSON-Array [...] sein.`);

  raw = raw.map(r => ({
    ...r,
    betrag: parseGermanNumber(r.betrag),
  }));

  const sel = document.getElementById("gruppeSelect");

  // Optionen füllen
  uniqueSorted(raw.map(r => r.gruppe)).forEach(g => {
    const opt = document.createElement("option");
    opt.value = g;
    opt.textContent = g;
    sel.appendChild(opt);
  });

  // ✅ Sofortiges Aktualisieren beim Anklicken/Ändern der Auswahl
  sel.addEventListener("change", rerender);

  // Button "Alle anzeigen" bleibt
  document.getElementById("btnAll").onclick = () => {
    [...sel.options].forEach(o => (o.selected = false));
    rerender();
  };

  rerender();
}

main().catch(err => {
  console.error(err);
  alert("Fehler: " + (err?.message ?? err));
});
