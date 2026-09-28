const LOG_ETAPES=[
  {id:'textile',label:'Textile en cours de commande',icon:'fa-box-open'},
  {id:'marquage',label:'En cours de marquage',icon:'fa-shirt'},
  {id:'pret',label:'Prêt à livrer',icon:'fa-box'},
  {id:'livre',label:'Livré',icon:'fa-circle-check'}
];
const LOG_MODES=[
  {id:'a_preciser',label:'À préciser'},
  {id:'retrait',label:'Retrait sur place'},
  {id:'main_propre',label:'Remise en main propre'},
  {id:'livraison',label:'Livraison (à préciser)'},
  {id:'domicile',label:'Livraison à domicile'},
  {id:'postal',label:'Envoi postal / transporteur'},
  {id:'relais',label:'Point relais'},
  {id:'autre',label:'Autre mode'}
];
let logEdition=null;
const logLibelle=statut=>LOG_ETAPES.find(e=>e.id===statut)?.label||'Statut à renseigner';
const logModeLibelle=mode=>LOG_MODES.find(m=>m.id===mode)?.label||'À préciser';
function infosLogistique(groupe){
  const item=logistique.find(l=>l.commandeClientId===groupe.id);
  return item||{commandeClientId:groupe.id,statut:'a_renseigner',
    modeLivraison:groupe.envoi==='non'?'retrait':groupe.envoi==='oui'?'livraison':'a_preciser',
    precisionLivraison:'',note:'',updatedAt:null,historique:[]};
}
function nettoyerLogistique(){
  const keys=new Set(ventes.map(v=>v.commandeClientId||`vente-${v.id}`));
  logistique=logistique.filter(l=>keys.has(l.commandeClientId));
}
function logManque(groupe){
  const ids=new Set(groupe.lignes.map(v=>v.id));
  return commandesStock.filter(c=>ids.has(c.venteId)&&c.statut!=='annulee').reduce((s,c)=>s+remainingOrder(c),0);
}
function logEmpreinte(groupe){
  return JSON.stringify({lignes:groupe.lignes.map(l=>[l.id,l.qty,l.envoi]),suivi:infosLogistique(groupe)});
}
function dateSuiviLogistique(date){
  return date?new Date(date).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';
}
function initLogistique(){
  const section=document.createElement('section');section.id='sec-logistique';section.className='section';
  section.innerHTML=`
    <div class="orders-heading"><div><h2 class="page-title"><i class="fas fa-truck"></i> Logistique</h2>
    <p class="orders-sub">Une vue par commande client, du textile jusqu’à la livraison.</p></div><span id="log-total" class="order-status"></span></div>
    <div class="log-kpis">${LOG_ETAPES.map(e=>`<button class="log-kpi" data-log-filter="${e.id}" aria-label="Afficher : ${e.label}"><span><i class="fas ${e.icon}" aria-hidden="true"></i> ${e.label}</span><strong id="log-count-${e.id}">0</strong></button>`).join('')}</div>
    <div class="card log-filters">
      <div class="field"><label for="log-search">Rechercher une commande</label><input id="log-search" type="search" placeholder="Client, référence ou article…" oninput="renderLogistique()"></div>
      <div class="field"><label for="log-status-filter">Avancement</label><select id="log-status-filter" onchange="renderLogistique()"><option value="all">Toutes les commandes</option><option value="en_cours">Non livrées</option><option value="a_renseigner">Statut à renseigner</option>${LOG_ETAPES.map(e=>`<option value="${e.id}">${e.label}</option>`).join('')}</select></div>
      <div class="field"><label for="log-mode-filter">Mode de livraison</label><select id="log-mode-filter" onchange="renderLogistique()"><option value="all">Tous les modes</option>${LOG_MODES.map(m=>`<option value="${m.id}">${m.label}</option>`).join('')}</select></div>
      <button class="btn" id="log-reset" onclick="reinitialiserFiltresLogistique()">Réinitialiser</button>
    </div>
    <p class="log-help" id="log-help"></p><div id="log-feedback" role="status" aria-live="polite"></div>
    <div id="log-orders"></div>`;
  document.querySelector('main').append(section);
  section.addEventListener('click',event=>{
    if(event.target.closest('[data-log-new]')){showSection('ventes');return;}
    const filter=event.target.closest('[data-log-filter]');
    if(filter){document.getElementById('log-status-filter').value=filter.dataset.logFilter;renderLogistique();return;}
    const button=event.target.closest('[data-log-edit]');
    if(button)ouvrirSuiviLogistique(button.dataset.logEdit,button.dataset.logStage);
  });
  document.body.insertAdjacentHTML('beforeend',`
    <dialog class="order-dialog log-dialog" id="log-dialog" aria-labelledby="log-dialog-title">
      <div class="dialog-heading"><h2 id="log-dialog-title">Mettre à jour la logistique</h2><button class="btn sm" type="button" onclick="document.getElementById('log-dialog').close()">Fermer</button></div>
      <p id="log-dialog-order" class="orders-sub"></p>
      <form id="log-form">
        <div class="field"><label for="log-stage-input">Avancement de la commande entière</label><select id="log-stage-input"><option value="a_renseigner">Statut à renseigner</option>${LOG_ETAPES.map(e=>`<option value="${e.id}">${e.label}</option>`).join('')}</select></div>
        <div class="field"><label for="log-mode-input">Mode de livraison</label><select id="log-mode-input">${LOG_MODES.map(m=>`<option value="${m.id}">${m.label}</option>`).join('')}</select></div>
        <div class="field"><label for="log-precision-input">Précisions de livraison (facultatif)</label><input id="log-precision-input" maxlength="300" placeholder="Transporteur, point relais, créneau de retrait…"></div>
        <div class="field"><label for="log-note-input">Note logistique (facultatif)</label><textarea id="log-note-input" maxlength="1000" rows="3" placeholder="Consignes, marquage ou suivi de préparation…"></textarea></div>
        <p class="order-note">Ce suivi est déclaratif : il ne modifie pas les quantités en stock, les réceptions fournisseur ou le chiffre d’affaires. Aucun message n’est envoyé.</p>
        <div class="btn-row"><button type="submit" class="btn primary" id="log-save">Enregistrer le suivi</button><button type="button" class="btn" onclick="document.getElementById('log-dialog').close()">Annuler</button><span id="log-form-feedback" role="status"></span></div>
      </form>
    </dialog>`);
  document.getElementById('log-form').addEventListener('submit',enregistrerSuiviLogistique);
  document.getElementById('log-dialog').addEventListener('close',()=>{logEdition=null;});
  renderLogistique();
}
function reinitialiserFiltresLogistique(){
  document.getElementById('log-search').value='';
  document.getElementById('log-status-filter').value='all';
  document.getElementById('log-mode-filter').value='all';renderLogistique();
}
function renderLogistique(){
  const root=document.getElementById('log-orders');if(!root)return;
  const groups=groupesCommandesClients();
  const filter=document.getElementById('log-status-filter').value;
  const mode=document.getElementById('log-mode-filter').value;
  const search=document.getElementById('log-search').value.trim().toLocaleLowerCase('fr');
  for(const e of LOG_ETAPES){
    document.getElementById(`log-count-${e.id}`).textContent=groups.filter(g=>infosLogistique(g).statut===e.id).length;
    const button=document.querySelector(`[data-log-filter="${e.id}"]`);
    button.classList.toggle('selected',filter===e.id);button.setAttribute('aria-pressed',String(filter===e.id));
  }
  const pending=groups.filter(g=>infosLogistique(g).statut==='a_renseigner').length;
  const rows=groups.filter(g=>{
    const info=infosLogistique(g);
    return (filter==='all'||(filter==='en_cours'?info.statut!=='livre':info.statut===filter))&&
      (mode==='all'||info.modeLivraison===mode)&&
      [g.ref,g.client,g.date,...g.lignes.flatMap(l=>[l.produitNom,l.couleur,l.motif,l.taille]),info.precisionLivraison,info.note]
        .join(' ').toLocaleLowerCase('fr').includes(search);
  }).reverse();
  document.getElementById('log-total').textContent=`${rows.length} / ${groups.length} commande(s)`;
  document.getElementById('log-help').textContent=pending
    ?`${pending} commande(s) sans statut logistique renseigné. Le mode retrait / livraison est repris de la commande ; utilisez « Modifier le suivi » pour confirmer l’avancement.`
    :'Cliquez sur une étape ou sur « Modifier le suivi » pour actualiser la commande. Les changements sont conservés dans les sauvegardes.';
  root.innerHTML=rows.length?rows.map(g=>{
    const info=infosLogistique(g),stageIndex=LOG_ETAPES.findIndex(e=>e.id===info.statut),manque=logManque(g);
    return `<article class="card log-order" data-log-order="${escapeHtml(g.id)}">
      <div class="log-order-heading"><div><h3>${escapeHtml(g.client)}</h3><p>${escapeHtml(g.ref)} · ${escapeHtml(g.date)} · ${g.lignes.reduce((s,l)=>s+l.qty,0)} article(s)</p></div>
      <span class="log-status log-status-${escapeHtml(info.statut)}">${logLibelle(info.statut)}</span></div>
      <ol class="log-progress" aria-label="Avancement de la commande">${LOG_ETAPES.map((e,i)=>`
        <li class="${i<stageIndex?'passed':i===stageIndex?'current':''}"><button type="button" data-log-edit="${escapeHtml(g.id)}" data-log-stage="${e.id}" ${i===stageIndex?'aria-current="step"':''} aria-label="${escapeHtml(g.ref)} : ${e.label}">
        <span class="log-step-number" aria-hidden="true">${i<stageIndex?'<i class="fas fa-check"></i>':i+1}</span><span>${e.label}</span></button></li>`).join('')}</ol>
      <div class="log-delivery"><div><span class="log-detail-label">Mode de livraison</span><strong><i class="fas ${['retrait','main_propre'].includes(info.modeLivraison)?'fa-handshake':'fa-truck'}" aria-hidden="true"></i> ${logModeLibelle(info.modeLivraison)}</strong>${info.precisionLivraison?`<p>${escapeHtml(info.precisionLivraison)}</p>`:''}</div>
      <button class="btn" data-log-edit="${escapeHtml(g.id)}">Modifier le suivi</button></div>
      ${info.note?`<p class="log-note-text">${escapeHtml(info.note)}</p>`:''}
      ${manque?`<p class="log-supply-warning"><i class="fas fa-box-open" aria-hidden="true"></i> ${manque} article(s) restent non réceptionné(s) dans « Commande stock ».</p>`:''}
      <details class="log-details"><summary>Détail des ${g.lignes.length} ligne(s) de la commande</summary><ul>${g.lignes.map(l=>`<li><span><strong>${escapeHtml(l.produitNom)}</strong><small>${escapeHtml(l.couleur)} · ${escapeHtml(l.motif)} · ${escapeHtml(l.taille)}</small></span><strong>× ${l.qty}</strong></li>`).join('')}</ul></details>
      ${info.updatedAt?`<p class="log-updated">Dernière mise à jour : ${dateSuiviLogistique(info.updatedAt)}</p>`:''}
      ${info.historique?.length?`<details class="log-history"><summary>Historique du suivi (${info.historique.length})</summary><ul>${[...info.historique].reverse().map(h=>`<li>${dateSuiviLogistique(h.at)} · ${logLibelle(h.statut)} · ${logModeLibelle(h.modeLivraison)}${h.raison?` · ${escapeHtml(h.raison)}`:''}</li>`).join('')}</ul></details>`:''}
    </article>`;
  }).join(''):`<div class="card order-empty"><strong>${groups.length?'Aucune commande ne correspond aux filtres':'Aucune commande enregistrée'}</strong>${groups.length?'Réinitialisez les filtres pour retrouver toutes les commandes.':'Vos commandes clients apparaîtront ici dès leur enregistrement, avec tous leurs articles regroupés.'}<div class="btn-row">${groups.length?'<button class="btn" onclick="reinitialiserFiltresLogistique()">Réinitialiser les filtres</button>':'<button class="btn primary" data-log-new>Enregistrer une commande</button>'}</div></div>`;
}
function ouvrirSuiviLogistique(id,stage){
  const group=groupesCommandesClients().find(g=>g.id===id);if(!group)return;
  const info=infosLogistique(group);
  logEdition={id,empreinte:logEmpreinte(group)};
  document.getElementById('log-dialog-order').textContent=`${group.client} · ${group.ref} · ${group.lignes.length} ligne(s)`;
  document.getElementById('log-stage-input').value=LOG_ETAPES.some(e=>e.id===stage)?stage:info.statut;
  document.getElementById('log-mode-input').value=info.modeLivraison;
  document.getElementById('log-precision-input').value=info.precisionLivraison||'';
  document.getElementById('log-note-input').value=info.note||'';
  document.getElementById('log-form-feedback').textContent='';
  document.getElementById('log-dialog').showModal();
}
function enregistrerSuiviLogistique(event){
  event.preventDefault();if(!logEdition)return;
  const group=groupesCommandesClients().find(g=>g.id===logEdition.id);
  if(!group||logEmpreinte(group)!==logEdition.empreinte){
    flash('log-form-feedback','La commande a changé. Fermez puis rouvrez ce suivi avant de le modifier.','err');return;
  }
  const statut=document.getElementById('log-stage-input').value;
  const modeLivraison=document.getElementById('log-mode-input').value;
  const precisionLivraison=document.getElementById('log-precision-input').value.trim();
  const note=document.getElementById('log-note-input').value.trim();
  if(!['a_renseigner',...LOG_ETAPES.map(e=>e.id)].includes(statut)||!LOG_MODES.some(m=>m.id===modeLivraison))return;
  if(modeLivraison==='autre'&&!precisionLivraison){flash('log-form-feedback','Précisez le mode de livraison choisi.','err');return;}
  if(statut==='livre'&&modeLivraison==='a_preciser'){flash('log-form-feedback','Indiquez le mode de livraison avant de marquer la commande livrée.','err');return;}
  const manque=logManque(group);
  if(['pret','livre'].includes(statut)&&manque&&!confirm(`${manque} article(s) sont encore non réceptionné(s) dans « Commande stock ».\nConfirmer malgré tout « ${logLibelle(statut)} » pour toute la commande ?\nCette action ne met pas à jour les réceptions fournisseur.`))return;
  const old=infosLogistique(group),now=new Date().toISOString();
  const entry={commandeClientId:group.id,statut,modeLivraison,precisionLivraison,note,updatedAt:now,
    historique:[...(old.historique||[]),{at:now,statut,modeLivraison}]};
  const index=logistique.findIndex(l=>l.commandeClientId===group.id);
  if(index<0)logistique.push(entry);else logistique[index]=entry;
  if(modeLivraison!=='a_preciser'){
    const envoi=['retrait','main_propre'].includes(modeLivraison)?'non':'oui';
    group.lignes.forEach(l=>l.envoi=envoi);
    if(commandeClientCible===group.id)document.getElementById('v-envoi').value=envoi;
  }
  save();document.getElementById('log-dialog').close();
  flash('log-feedback',`Suivi enregistré pour ${group.ref} : ${logLibelle(statut)}.`,'ok');
}
function confirmerAjoutLogistique(id){
  const info=logistique.find(l=>l.commandeClientId===id);
  return !info||!['pret','livre'].includes(info.statut)||
    confirm(`Cette commande est « ${logLibelle(info.statut)} ».\nAjouter des articles remettra son statut logistique à renseigner, afin de revalider la commande complète. Continuer ?`);
}
function reouvrirLogistiqueApresAjout(id){
  const info=logistique.find(l=>l.commandeClientId===id);
  if(!info||!['pret','livre'].includes(info.statut))return false;
  info.statut='a_renseigner';info.updatedAt=new Date().toISOString();
  info.historique=[...(info.historique||[]),{at:info.updatedAt,statut:info.statut,modeLivraison:info.modeLivraison,raison:'Articles ajoutés : avancement à revalider'}];
  return true;
}
function validerDonneesLogistique(items){
  const statuts=['a_renseigner',...LOG_ETAPES.map(e=>e.id)];
  const modes=LOG_MODES.map(m=>m.id);
  const dateValide=d=>typeof d==='string'&&Number.isFinite(Date.parse(d));
  if(!Array.isArray(items)||!items.every(l=>l&&typeof l.commandeClientId==='string'&&l.commandeClientId.trim()&&statuts.includes(l.statut)&&modes.includes(l.modeLivraison)&&
    (l.precisionLivraison===undefined||typeof l.precisionLivraison==='string')&&(l.note===undefined||typeof l.note==='string')&&
    (!l.updatedAt||dateValide(l.updatedAt))&&
    (l.historique===undefined||Array.isArray(l.historique)&&l.historique.every(h=>h&&dateValide(h.at)&&statuts.includes(h.statut)&&modes.includes(h.modeLivraison)&&(h.raison===undefined||typeof h.raison==='string')))
  ))throw Error('Données logistiques invalides.');
  if(new Set(items.map(l=>l.commandeClientId)).size!==items.length)throw Error('Suivis logistiques en doublon.');
}
