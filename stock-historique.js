// Historique du stock : état de base daté + journal des mouvements, en ajout seul.
// Chaque variation de stock (vente, réception, ajustement, suppression, import, synchronisation)
// est enregistrée avec la date, la quantité avant/après et son origine. Rien n'est jamais réécrit.
const HS_KEYS={journal:'appv4_mouvementsStock',base:'appv4_stockBase',ref:'appv4_stockRef'};
const HS_MOTIFS_MANUELS=[
  'Ajustement manuel',
  'Inventaire (comptage physique)',
  'Entrée en stock (réception hors commande)',
  'Cadeau / envoi influenceur',
  'Casse, perte ou vol',
  'Usage interne ou échantillon',
  'Transfert vers un événement',
  'Retour de stock d’un événement',
  'Correction d’erreur de saisie'
];
let mouvementsStock=hsLire(HS_KEYS.journal,[]);
let stockBase=hsLire(HS_KEYS.base,null);
let hsReference=hsLire(HS_KEYS.ref,null);
let hsContexte=null;
let hsImportAt=0;
let hsNoms={};
// Le motif revient à « Ajustement manuel » à chaque ouverture, pour éviter un motif oublié.
let hsMotifManuel=HS_MOTIFS_MANUELS[0];

function hsLire(key,fallback){try{const v=JSON.parse(appStorage.getItem(key)||'null');return v??fallback;}catch(_){return fallback;}}
function hsPersister(){
  appStorage.setItem(HS_KEYS.journal,JSON.stringify(mouvementsStock));
  appStorage.setItem(HS_KEYS.base,JSON.stringify(stockBase));
  appStorage.setItem(HS_KEYS.ref,JSON.stringify(hsReference));
}
function hsCopie(o){return JSON.parse(JSON.stringify(o||{}));}
function hsNum(v){return Number.isFinite(v)?v:0;}
function hsId(){return (crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2));}
// Empreinte de chaque ligne : toute modification ultérieure d'une ligne est détectée.
function hsEmpreinte(str){let h1=0xdeadbeef,h2=0x41c6ce57;for(let i=0;i<str.length;i++){const c=str.charCodeAt(i);h1=Math.imul(h1^c,2654435761);h2=Math.imul(h2^c,1597334677);}h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);return(4294967296*(2097151&h2)+(h1>>>0)).toString(16).padStart(14,'0');}
function hsContenu(m){const {h,...rest}=m;return JSON.stringify(rest,Object.keys(rest).sort());}
function hsMajNoms(){for(const p of produits)hsNoms[p.id]=p.nom;}
function hsDecomposer(cle){const [pid,couleur,motif,taille]=String(cle).split('||');return{produitId:Number(pid),couleur:couleur||'',motif:motif||'',taille:taille||''};}
function hsNomProduit(pid){return produits.find(p=>p.id===pid)?.nom||hsNoms[pid]||stockBase?.noms?.[pid]||`Produit #${pid}`;}

function hsCreerBase(){
  hsMajNoms();
  const at=new Date().toISOString();
  stockBase={at,stock:hsCopie(stock),noms:{...hsNoms},note:'État de base de l’historique du stock'};
  hsReference=hsCopie(stock);
  hsPersister();
}
function hsAjouterMouvement(cle,avant,apres,origine,at=new Date().toISOString()){
  const d=hsDecomposer(cle);
  const m={id:hsId(),at,cle,produitId:d.produitId,produit:hsNomProduit(d.produitId),couleur:d.couleur,motif:d.motif,taille:d.taille,
    avant,apres,delta:apres-avant,origine};
  m.h=hsEmpreinte(hsContenu(m));
  mouvementsStock.push(m);
  return m;
}
// Compare le stock actuel à la dernière référence connue et journalise chaque écart.
function hsEnregistrerEcarts(origine){
  if(!stockBase){return 0;}
  if(!hsReference)hsReference=hsCopie(stockBase.stock);
  const cles=new Set([...Object.keys(hsReference),...Object.keys(stock)]);
  const at=new Date().toISOString();let n=0;
  for(const k of cles){
    const avant=hsNum(hsReference[k]),apres=hsNum(stock[k]);
    if(avant!==apres){hsAjouterMouvement(k,avant,apres,origine,at);n++;}
  }
  hsReference=hsCopie(stock);
  hsMajNoms();
  return n;
}
function hsOrigineCourante(){return hsContexte||'Mouvement de stock (origine non précisée)';}

// Stock théorique = état de base + somme des mouvements jusqu'à une date donnée.
function hsStockA(dateIso){
  if(!stockBase)return{};
  const res=hsCopie(stockBase.stock);
  for(const m of mouvementsStock){if(dateIso&&m.at>dateIso)continue;res[m.cle]=hsNum(res[m.cle])+m.delta;}
  return res;
}
function hsControle(){
  const theorique=hsStockA(null);
  const cles=new Set([...Object.keys(theorique),...Object.keys(stock)]);
  const ecarts=[];
  for(const k of cles){if(hsNum(theorique[k])!==hsNum(stock[k]))ecarts.push({cle:k,theorique:hsNum(theorique[k]),reel:hsNum(stock[k])});}
  const alterees=mouvementsStock.filter(m=>m.h!==hsEmpreinte(hsContenu(m))).length;
  return{ecarts,alterees};
}

// ─── Enregistrement des origines ─────────────────────────────────────────────
function hsEnvelopper(nom,origine){
  const fn=window[nom];if(typeof fn!=='function')return;
  window[nom]=function(...args){
    const precedent=hsContexte;hsMajNoms();
    hsContexte=typeof origine==='function'?origine():origine;
    try{return fn.apply(this,args);}finally{hsContexte=precedent;}
  };
}
const HS_ORIGINES={
  enregistrerCommandeClient:'Vente enregistrée',
  ajouterVente:'Vente enregistrée',
  supprimerLigneClient:'Suppression d’une vente (remise en stock)',
  supprimerCommandeClient:'Suppression d’une commande client (remise en stock)',
  enregistrerEditionClient:'Modification d’une vente',
  enregistrerEditionStock:'Modification d’une commande fournisseur',
  supprimerCommandeStock:'Suppression d’une commande fournisseur',
  confirmerCorrectionFournisseur:'Correction d’une réception fournisseur',
  supprimerProduit:'Suppression d’un produit du catalogue',
  sauvegarderProduit:'Modification du catalogue produit',
  adjStock:()=>hsMotifManuel,
  setStockDirect:()=>hsMotifManuel
};
for(const [nom,origine] of Object.entries(HS_ORIGINES))hsEnvelopper(nom,origine);
document.addEventListener('submit',e=>{
  if(e.target?.id==='receive-form'){hsContexte='Réception fournisseur';setTimeout(()=>{if(hsContexte==='Réception fournisseur')hsContexte=null;},0);}
},true);
document.addEventListener('change',e=>{if(e.target?.id==='data-import')hsImportAt=Date.now();},true);

// ─── Persistance, Dropbox et import ──────────────────────────────────────────
const hsSaveOriginal=save;
save=function(){
  if(stockBase&&hsEnregistrerEcarts(hsOrigineCourante()))hsRafraichir();
  hsPersister();
  return hsSaveOriginal.apply(this,arguments);
};
const hsPayloadOriginal=dbxBuildPayload;
dbxBuildPayload=function(){return{...hsPayloadOriginal.apply(this,arguments),stockBase,mouvementsStock};};
function hsFusionner(data){
  if(data?.stockBase?.at&&data.stockBase.stock&&(!stockBase||data.stockBase.at<stockBase.at))stockBase=data.stockBase;
  if(Array.isArray(data?.mouvementsStock)){
    const ids=new Set(mouvementsStock.map(m=>m.id));
    for(const m of data.mouvementsStock){
      if(m&&typeof m.id==='string'&&typeof m.at==='string'&&typeof m.cle==='string'&&Number.isFinite(m.delta)&&!ids.has(m.id)){mouvementsStock.push(m);ids.add(m.id);}
    }
    mouvementsStock.sort((a,b)=>a.at<b.at?-1:a.at>b.at?1:0);
  }
}
const hsApplyOriginal=dbxApplyRemoteData;
dbxApplyRemoteData=function(data){
  if(!data)return hsApplyOriginal.apply(this,arguments);
  hsMajNoms();
  hsFusionner(data);
  const res=hsApplyOriginal.apply(this,arguments);
  let ajout=0;
  if(stockBase){
    // Écarts entre le stock reçu et ce que l'historique explique : journalisés, jamais masqués.
    const origine=Date.now()-hsImportAt<120000?'Import de données (fichier)':'Synchronisation Dropbox (écart non expliqué par l’historique)';
    const theorique=hsStockA(null);
    const cles=new Set([...Object.keys(theorique),...Object.keys(stock)]);
    const at=new Date().toISOString();
    for(const k of cles){const a=hsNum(theorique[k]),b=hsNum(stock[k]);if(a!==b){hsAjouterMouvement(k,a,b,origine,at);ajout++;}}
  }
  hsReference=hsCopie(stock);hsMajNoms();hsPersister();
  if(ajout)dbxScheduleUpload();
  hsRafraichir();
  return res;
};
// L'état de base n'est créé qu'après un échange Dropbox réussi : jamais depuis une copie locale périmée.
let hsDropboxOk=false;
const hsDownloadOriginal=dbxDownload;
dbxDownload=async function(){
  const d=await hsDownloadOriginal.apply(this,arguments);
  if(d)hsDropboxOk=true;
  return d;
};
const hsUploadOriginal=dbxUpload;
dbxUpload=async function(){
  const ok=await hsUploadOriginal.apply(this,arguments);
  if(ok)hsDropboxOk=true;
  return ok;
};
function hsCreerBaseSiPossible(){
  if(stockBase||(dbxAccessToken&&!dbxRemoteLoaded))return;
  hsCreerBase();dbxScheduleUpload();hsRafraichir();
}
const hsInitOriginal=dbxInit;
dbxInit=async function(){
  try{return await hsInitOriginal.apply(this,arguments);}
  finally{hsCreerBaseSiPossible();hsRafraichir();}
};
const hsManualSyncOriginal=dbxManualSync;
dbxManualSync=async function(){
  try{return await hsManualSyncOriginal.apply(this,arguments);}
  finally{hsCreerBaseSiPossible();}
};

// ─── Interface ───────────────────────────────────────────────────────────────
function hsDate(iso){return new Date(iso).toLocaleString('fr-FR',{timeZone:'Europe/Paris',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});}
function hsEsc(s){return typeof escapeHtml==='function'?escapeHtml(String(s??'')):String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function hsCsv(rows,nom){
  const txt='\ufeff'+rows.map(r=>r.map(v=>{const s=String(v??'');return /[;"\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}).join(';')).join('\r\n');
  downloadBlob(new Blob([txt],{type:'text/csv;charset=utf-8'}),nom);
}
function hsLignesEtat(etat){
  return Object.entries(etat).filter(([,q])=>q).map(([k,q])=>{const d=hsDecomposer(k);return[hsNomProduit(d.produitId),d.couleur,d.motif,d.taille,q];})
    .sort((a,b)=>a.join('|').localeCompare(b.join('|'),'fr'));
}
function hsExporterBase(){
  if(!stockBase)return;
  hsCsv([[`État de base du stock BZAK au ${hsDate(stockBase.at)}`],['Produit','Couleur','Motif','Taille','Quantité'],...hsLignesEtat(stockBase.stock)],`stock-base-${stockBase.at.slice(0,10)}.csv`);
}
function hsExporterEtatDate(){
  const v=document.getElementById('hs-date-etat').value;if(!v){alert('Choisissez une date.');return;}
  const fin=new Date(v+'T23:59:59.999').toISOString();
  if(stockBase&&fin<stockBase.at){alert(`L’historique commence le ${hsDate(stockBase.at)}. Choisissez une date postérieure.`);return;}
  const etat=hsStockA(fin);
  hsCsv([[`Stock BZAK au ${new Date(v).toLocaleDateString('fr-FR')} (fin de journée), reconstitué depuis l’état de base du ${hsDate(stockBase.at)}`],['Produit','Couleur','Motif','Taille','Quantité'],...hsLignesEtat(etat)],`stock-au-${v}.csv`);
}
function hsFiltres(){
  const pid=document.getElementById('hs-f-produit')?.value||'';
  const du=document.getElementById('hs-f-du')?.value||'';
  const au=document.getElementById('hs-f-au')?.value||'';
  const orig=document.getElementById('hs-f-origine')?.value||'';
  return mouvementsStock.filter(m=>(!pid||String(m.produitId)===pid)&&(!du||m.at>=new Date(du+'T00:00:00').toISOString())&&(!au||m.at<=new Date(au+'T23:59:59.999').toISOString())&&(!orig||m.origine===orig));
}
function hsExporterJournal(){
  const rows=hsFiltres().map(m=>[hsDate(m.at),m.produit,m.couleur,m.motif,m.taille,m.avant,m.delta>0?`+${m.delta}`:m.delta,m.apres,m.origine,m.id,m.h]);
  hsCsv([['Date','Produit','Couleur','Motif','Taille','Stock avant','Mouvement','Stock après','Origine','Identifiant','Empreinte'],...rows],`mouvements-stock-${new Date().toISOString().slice(0,10)}.csv`);
}
function hsInstallerInterface(){
  const navStock=[...document.querySelectorAll('nav .nav-item')].find(n=>/showSection\('stock'\)/.test(n.getAttribute('onclick')||''));
  if(navStock&&!document.getElementById('nav-stock-historique')){
    navStock.insertAdjacentHTML('afterend',`<div class="nav-item" id="nav-stock-historique" onclick="showSection('stock-historique')"><i class="fas fa-clipboard-list"></i> Historique stock</div>`);
  }
  const apres=document.getElementById('sec-stock');
  if(apres&&!document.getElementById('sec-stock-historique')){
    apres.insertAdjacentHTML('afterend',`
<div id="sec-stock-historique" class="section">
  <div class="page-title"><i class="fas fa-clipboard-list"></i> Historique du stock</div>
  <div class="card"><div class="card-title"><i class="fas fa-flag"></i> État de base</div><div id="hs-base"></div></div>
  <div class="card"><div class="card-title"><i class="fas fa-check-double"></i> Contrôle de cohérence</div><div id="hs-controle"></div></div>
  <div class="card"><div class="card-title"><i class="fas fa-calendar-day"></i> Stock à une date</div>
    <div class="hs-row"><input type="date" id="hs-date-etat"><button class="btn sm" onclick="hsExporterEtatDate()">Télécharger l’état (CSV)</button></div>
    <p class="hs-note">Reconstitue le stock en fin de journée à partir de l’état de base et des mouvements enregistrés.</p></div>
  <div class="card"><div class="card-title"><i class="fas fa-list"></i> Journal des mouvements <span id="hs-count" class="hs-count"></span></div>
    <div class="hs-row">
      <select id="hs-f-produit" onchange="hsRenderJournal()"><option value="">Tous les produits</option></select>
      <select id="hs-f-origine" onchange="hsRenderJournal()"><option value="">Toutes les origines</option></select>
      <label>Du <input type="date" id="hs-f-du" onchange="hsRenderJournal()"></label>
      <label>Au <input type="date" id="hs-f-au" onchange="hsRenderJournal()"></label>
      <button class="btn sm" onclick="hsExporterJournal()">Exporter (CSV)</button>
    </div>
    <div class="table-wrap"><table><thead><tr><th>Date</th><th>Produit</th><th>Couleur</th><th>Motif</th><th>Taille</th><th>Avant</th><th>Mouvement</th><th>Après</th><th>Origine</th></tr></thead><tbody id="hs-body"></tbody></table></div>
  </div>
</div>`);
  }
  const titreStock=document.querySelector('#sec-stock .page-title');
  if(titreStock&&!document.getElementById('hs-motif-manuel')){
    titreStock.insertAdjacentHTML('afterend',`<div class="hs-motif card"><label for="hs-motif-manuel"><i class="fas fa-pen"></i> Motif des ajustements manuels (+ / − et saisie directe)</label>
      <select id="hs-motif-manuel" onchange="hsMotifManuel=this.value">${HS_MOTIFS_MANUELS.map(m=>`<option${m===hsMotifManuel?' selected':''}>${hsEsc(m)}</option>`).join('')}</select>
      <span class="hs-note">Chaque modification est enregistrée dans l’Historique stock avec ce motif.</span></div>`);
  }
  if(!document.getElementById('hs-style')){
    document.head.insertAdjacentHTML('beforeend',`<style id="hs-style">
      .hs-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}
      .hs-row select,.hs-row input{padding:6px 8px;border:1px solid var(--border,#ddd);border-radius:6px;font:inherit}
      .hs-note{font-size:12px;color:var(--text-muted,#777);margin:6px 0 0}
      .hs-count{font-weight:400;color:var(--text-muted,#777);font-size:12px}
      .hs-ok{color:#1a7f37;font-weight:600}.hs-ko{color:#b42318;font-weight:600}
      .hs-plus{color:#1a7f37;font-weight:600}.hs-moins{color:#b42318;font-weight:600}
      .hs-motif{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 14px}
      .hs-motif label{font-weight:600;font-size:13px}
      .hs-motif select{padding:6px 8px;border:1px solid var(--border,#ddd);border-radius:6px;font:inherit}
    </style>`);
  }
  const showOriginal=showSection;
  showSection=function(id){
    if(id==='stock-historique'){
      document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
      document.getElementById('sec-stock-historique').classList.add('active');
      hsRenderHistorique();
    } else showOriginal.apply(this,arguments);
    // Surlignage robuste du menu, quel que soit l'ordre des entrées.
    document.querySelectorAll('nav .nav-item').forEach(n=>n.classList.toggle('active',(n.getAttribute('onclick')||'').includes(`showSection('${id}')`)));
  };
}
function hsRenderHistorique(){
  const base=document.getElementById('hs-base');if(!base)return;
  if(!stockBase){base.innerHTML=`<p class="hs-note">${dbxAccessToken?'L’état de base sera créé dès que les données auront été synchronisées avec Dropbox. Si la session Dropbox a expiré, reconnectez-vous.':'L’état de base sera créé dès la fin du chargement des données.'}</p>`;document.getElementById('hs-controle').innerHTML='';return;}
  const unites=Object.values(stockBase.stock).reduce((s,q)=>s+hsNum(q),0);
  const refs=Object.values(stockBase.stock).filter(q=>q).length;
  base.innerHTML=`<p>Historique démarré le <strong>${hsDate(stockBase.at)}</strong> : ${unites} unité(s) sur ${refs} déclinaison(s) en stock.</p>
    <button class="btn sm" onclick="hsExporterBase()">Télécharger l’état de base (CSV)</button>`;
  const c=hsControle();
  document.getElementById('hs-controle').innerHTML=(c.ecarts.length||c.alterees)
    ?`<p class="hs-ko">${c.ecarts.length?`${c.ecarts.length} écart(s) entre l’historique et le stock actuel.`:''} ${c.alterees?`${c.alterees} ligne(s) du journal modifiée(s) après enregistrement.`:''}</p>`
    :`<p class="hs-ok">Cohérent : état de base + ${mouvementsStock.length} mouvement(s) = stock actuel. Aucune ligne du journal modifiée.</p>`;
  const selP=document.getElementById('hs-f-produit'),valP=selP.value;
  const pids=[...new Set([...produits.map(p=>p.id),...mouvementsStock.map(m=>m.produitId)])];
  selP.innerHTML='<option value="">Tous les produits</option>'+pids.map(id=>`<option value="${id}">${hsEsc(hsNomProduit(id))}</option>`).join('');selP.value=valP;
  const selO=document.getElementById('hs-f-origine'),valO=selO.value;
  selO.innerHTML='<option value="">Toutes les origines</option>'+[...new Set(mouvementsStock.map(m=>m.origine))].sort().map(o=>`<option>${hsEsc(o)}</option>`).join('');selO.value=valO;
  const d=document.getElementById('hs-date-etat');if(!d.value)d.value=new Date().toISOString().slice(0,10);
  hsRenderJournal();
}
function hsRenderJournal(){
  const body=document.getElementById('hs-body');if(!body)return;
  const liste=hsFiltres().slice().reverse();
  document.getElementById('hs-count').textContent=`(${liste.length} mouvement${liste.length>1?'s':''})`;
  body.innerHTML=liste.length?liste.slice(0,500).map(m=>`<tr><td>${hsDate(m.at)}</td><td>${hsEsc(m.produit)}</td><td>${hsEsc(m.couleur)}</td><td>${hsEsc(m.motif)}</td><td>${hsEsc(m.taille)}</td><td>${m.avant}</td><td class="${m.delta>0?'hs-plus':'hs-moins'}">${m.delta>0?'+':''}${m.delta}</td><td>${m.apres}</td><td>${hsEsc(m.origine)}</td></tr>`).join('')
    +(liste.length>500?`<tr><td colspan="9" class="hs-note">500 derniers mouvements affichés. Utilisez l’export CSV pour la liste complète.</td></tr>`:'')
    :'<tr><td colspan="9" class="hs-note">Aucun mouvement depuis l’état de base.</td></tr>';
}
function hsRafraichir(){if(document.getElementById('sec-stock-historique')?.classList.contains('active'))hsRenderHistorique();}

// ─── Démarrage ───────────────────────────────────────────────────────────────
hsMajNoms();
hsInstallerInterface();
if(stockBase){
  // Écart laissé par une ancienne version ouverte dans un autre onglet : journalisé au chargement.
  if(hsEnregistrerEcarts('Écart constaté au chargement (modification sans historique)'))hsPersister();
} else if(!dbxAccessToken){hsCreerBase();}
