const DATA_URL = "./haushalt.json";

let raw = [];
let tab = null;

/* ---------- Helper ---------- */
const fmtEUR = n =>
  new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR"}).format(n);

const num = v => Number(String(v).replace(/\./g,"").replace(",", ".")) || 0;

const uniq = arr => [...new Set(arr)].filter(Boolean).sort();

/* ---------- Filter Getter ---------- */
const val = id => document.getElementById(id).value;
const multi = id => [...document.getElementById(id).selectedOptions].map(o=>o.value);

/* ---------- Klassifizierung ---------- */
const isErtrag = s => /^5|^91/.test(s?.match(/^\d+/)?.[0]||"");

/* ---------- Aggregation ---------- */
function aggregate(rows){
  const m = new Map();
  for(const r of rows){
    const k = r.kontogruppe;
    if(!m.has(k)) m.set(k,{kontogruppe:k,ertraege:0,aufwendungen:0});
    const o = m.get(k);
    if(isErtrag(r.sachkonto)) o.ertraege += -r.betrag;
    else o.aufwendungen += r.betrag;
  }
  return [...m.values()];
}

/* ---------- Rendering ---------- */
function renderAll(){
  const jahr = val("jahrSelect");
  const g1 = val("gruppe1Select");
  const gruppen = multi("gruppeSelect");

  let f = raw.filter(r =>
    r.jahr===jahr &&
    r.gruppe1===g1 &&
    (!gruppen.length || gruppen.includes(r.gruppe))
  );

  // Übersicht
  let er=0, aw=0;
  f.forEach(r=>{
    if(isErtrag(r.sachkonto)) er+=-r.betrag;
    else aw+=r.betrag;
  });
  const erg = aw-er;
  document.getElementById("sumErtrag").textContent = fmtEUR(er);
  document.getElementById("sumAufwand").textContent = fmtEUR(aw);
  document.getElementById("sumErgebnis").textContent =
    fmtEUR(Math.abs(erg)) + (erg<0?" (Überschuss)":erg>0?" (Defizit)":" (Ausgeglichen)");

  const agg = aggregate(f);

  // Tabelle
  if(!tab){
    tab = new Tabulator("#table",{
      data:agg,
      layout:"fitColumns",
      columns:[
        {title:"Kontogruppe",field:"kontogruppe"},
        {title:"Aufwendungen",field:"aufwendungen",formatter:c=>fmtEUR(c.getValue())},
        {title:"Erträge",field:"ertraege",formatter:c=>fmtEUR(c.getValue())},
      ]
    });
  } else tab.replaceData(agg);

  // Pies
  Plotly.react("pieErtraege",[{
    type:"pie",
    labels:agg.map(a=>a.kontogruppe),
    values:agg.map(a=>Math.max(0,a.ertraege))
  }]);

  Plotly.react("pieAufwendungen",[{
    type:"pie",
    labels:agg.map(a=>a.kontogruppe),
    values:agg.map(a=>Math.max(0,a.aufwendungen))
  }]);

  document.getElementById("status").textContent =
    `Zeilen: ${f.length} | Kontogruppen: ${agg.length}`;
}

/* ---------- Init ---------- */
fetch(DATA_URL).then(r=>r.json()).then(j=>{
  raw = j.map(r=>({...r,betrag:num(r.betrag)}));

  const jahre = uniq(raw.map(r=>r.jahr));
  const jahrSel = document.getElementById("jahrSelect");
  jahre.forEach(v=>jahrSel.add(new Option(v,v)));

  jahrSel.onchange = () => {
    const g1Sel = document.getElementById("gruppe1Select");
    g1Sel.innerHTML="";
    uniq(raw.filter(r=>r.jahr===jahrSel.value).map(r=>r.gruppe1))
      .forEach(v=>g1Sel.add(new Option(v,v)));
    g1Sel.onchange();
  };

  document.getElementById("gruppe1Select").onchange = () => {
    const gs = document.getElementById("gruppeSelect");
    gs.innerHTML="";
    uniq(raw.filter(r=>
      r.jahr===jahrSel.value &&
      r.gruppe1===val("gruppe1Select")
    ).map(r=>r.gruppe)).forEach(v=>gs.add(new Option(v,v)));
    renderAll();
  };

  document.getElementById("gruppeSelect").onchange = renderAll;
  document.getElementById("btnAll").onclick = () => {
    [...document.getElementById("gruppeSelect").options].forEach(o=>o.selected=false);
    renderAll();
  };

  jahrSel.selectedIndex=0;
  jahrSel.onchange();
});
