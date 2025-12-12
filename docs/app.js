// docs/app.js
const DATA_URL = "./haushalt.json";

let raw = [];
let table;

function fmtEUR(n) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);
}

function uniqueSorted(arr) {
  return [...new Set(arr)]
    .filter(v => v !== undefined && v !== null && String(v).trim() !== "")
    .map(v => String(v))
    .sort((a, b) => a.localeCompare(b, "de"));
}

function parseGermanNumber(value) {
  // "1.234,56" -> 1234.56
  // "-400,00"  -> -400
  // 400        -> 400
  if (value === null || value === undefined) return 0;
  const s = String(value).trim();
  if (s === "") return 0;

  // Entfernt Tausenderpunkte und ersetzt Dezimalkomma
  const normalized = s.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
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

/**
 * Aggregation:
 * - Ergebnis pro kontogruppe:
 *   aufwendungen = Summe positiver Beträge
 *   ertraege     = Summe negativer Beträge (bleibt negativ)
 *   saldo        = Summe gesamt
 */
function aggregateByKontogruppe(rows) {
  const m = new Map();

  for (const r of rows) {
    const kg = String(r.kontogruppe ?? "(ohne kontogruppe)");
    const betrag = Number(r.betrag ?? 0);

    if (!m.has(kg)) {
      m.set(kg, { kontogruppe: kg, aufwendungen: 0, ertraege: 0, saldo: 0 });
    }
    const obj = m.get(kg);

    if (betrag >= 0) obj.aufwendungen += betrag;
    else obj.ertraege += betrag; // negativ
    obj.saldo += betrag;
  }

  const out = [...m.values()];

  // ✅ Korrekte Sortierung: führende Zahl numerisch (1,2,3,...,10,11,...)
  out.sort((a, b) => {
    const na = parseInt(a.kontogruppe.match(/^\d+/)?.[0], 10);
    const nb = parseInt(b.kontogruppe.match(/^\d+/)?.[0], 10);

    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    if (!isNaN(na) && isNaN(nb)) return -1;
    if (isNaN(na) && !isNaN(nb)) return 1;

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
        { title:
