// Les engagements client chez The Hive ne sont pas des mouvements de stock.
// Les anciennes réceptions sont archivées par normaliserDestinationsCommandes.
const copieEdition=value=>JSON.parse(JSON.stringify(value));
const cleArticle=v=>sKey(v.produitId,v.couleur,v.motif,v.taille);
const lieeStock=c=>!pourStock(c)&&!c.venteAnnulee&&!c.stockLibre&&c.statut!=='annulee';
const recueReservee=()=>0; // Aucune réception fournisseur n'est réservée à une vente.
const quantiteReservee=c=>lieeStock(c)?(c.qtyAffectee??c.qty):0;
const attenteReservee=c=>Math.max(0,quantiteReservee(c)-recueReservee(c));
const empreinteEdition=()=>JSON.stringify({produits,stock,ventes,commandesStock,logistique});
const etatEdition=()=>copieEdition({stock,ventes,commandesStock,logistique});
let editionClient=null,editionStock=null;

function besoinNonCouvert(v,data={commandesStock}){
  const couvert=data.commandesStock.filter(c=>c.venteId===v.id&&cleArticle(c)===cleArticle(v)).reduce((s,c)=>s+quantiteReservee(c),0);
  return Math.max(0,v.qty-(v.preleveStock??v.qty)-couvert);
}
function articleManquant(v){
  const received=commandesStock.filter(c=>c.venteId===v.id&&cleArticle(c)===cleArticle(v)).reduce((s,c)=>s+(!pourStock(c)&&c.statut==='commandee'?quantiteReservee(c):recueReservee(c)),0);
  return Math.max(0,v.qty-(v.preleveStock??v.qty)-received);
}
function articleApproEnCours(v){return articleManquant(v)>0;}
function nouvelleLigneStock(v,qty){
  return {id:crypto.randomUUID(),venteId:v.id,date:v.date,client:v.client,produitId:v.produitId,produitNom:v.produitNom,
    couleur:v.couleur,motif:v.motif,taille:v.taille,qty,recue:0,statut:'a_commander',destination:'client',
    ...(v.commandeClientId?{commandeClientId:v.commandeClientId,commandeClientRef:v.commandeClientRef}:{}),
    createdAt:new Date().toISOString()};
}
function revaliderLogistique(data,id,raison){
  const info=data.logistique.find(l=>l.commandeClientId===id);if(!info)return;
  info.statut='a_renseigner';info.updatedAt=new Date().toISOString();
  info.historique=[...(info.historique||[]),{at:info.updatedAt,statut:info.statut,modeLivraison:info.modeLivraison,raison}];
}
function prixEdition(ligne,type,cost,fixed){
  const rate=1+(ligne.tvaRate??TVA)/100;
  const brut=ligne.prixHT*rate*ligne.qty;
  const remise=ligne.remiseType==='pct'?brut*(ligne.remise||0)/100:Math.min(ligne.remise||0,brut);
  const caTTC=arrondiMontant(brut-remise),caHT=arrondiMontant(caTTC/rate);
  const frais=type==='TPE Physique'?caTTC*.0175:caTTC*.015+(fixed ? 0.25 : 0);
  if(![brut,remise,caTTC,caHT,frais].every(Number.isFinite))throw Error('Les montants saisis sont trop élevés.');
  return {prixTTC:arrondiMontant(ligne.prixHT*rate),caHT,caTTC,remiseMontantTTC:arrondiMontant(remise),
    remiseMontantHT:arrondiMontant(remise/rate),coutAchatUnitaire:cost,
    marge:arrondiMontant((ligne.prixHT-cost)*ligne.qty-remise/rate-frais)};
}
function coutAncien(v,index){
  if(Number.isFinite(v.coutAchatUnitaire))return v.coutAchatUnitaire;
  const frais=v.type==='TPE Physique'?v.caTTC*.0175:v.caTTC*.015+(index===0 ? 0.25 : 0);
  return Math.max(0,arrondiMontant((v.prixHT*v.qty-(v.remiseMontantHT||0)-frais-v.marge)/v.qty));
}
function preparerEditionClient(group,header,lines){
  const data=etatEdition(),old=group.lignes,ids=new Set(old.map(v=>v.id));
  const changed=new Set(old.filter(v=>{
    const l=lines.find(n=>n.id===v.id);return !l||cleArticle(l)!==cleArticle(v)||l.qty!==v.qty;
  }).map(v=>v.id));
  let physical=changed.size>0||lines.some(l=>!ids.has(l.id));
  const reprice=physical||header.type!==group.type||lines.some(l=>{
    const v=old.find(v=>v.id===l.id);
    return !v||l.prixHT!==v.prixHT||l.remise!==(v.remise||0)||l.remiseType!==v.remiseType;
  });
  // Libérer seulement les articles réellement prélevés/reçus des lignes modifiées.
  for(const v of old.filter(v=>changed.has(v.id))){
    data.stock[cleArticle(v)]=(data.stock[cleArticle(v)]||0)+(v.preleveStock??v.qty);
    const related=data.commandesStock.filter(c=>c.venteId===v.id&&lieeStock(c));
    for(const c of related){
      data.stock[cleArticle(c)]=(data.stock[cleArticle(c)]||0)+recueReservee(c);
      if(c.statut==='a_commander')continue;
      c.recueAffectee=0;c.qtyAffectee=0;c.stockLibre=pourStock(c);
      if(!pourStock(c))c.modificationFournisseurAConfirmer=true;
      if(!lines.some(l=>l.id===v.id))c.venteAnnulee=true;
    }
    const pendingIds=new Set(related.filter(c=>c.statut==='a_commander').map(c=>c.id));
    data.commandesStock=data.commandesStock.filter(c=>!pendingIds.has(c.id));
  }
  let next=nextVenteId;
  const newSales=lines.map((line,index)=>{
    const original=old.find(v=>v.id===line.id);
    const v={...original,...line,...header,id:original?.id??next++,commandeClientId:group.id,commandeClientRef:group.ref};
    delete v.editKey;
    if(!original||changed.has(original.id)){
      const key=cleArticle(v),available=Math.max(0,data.stock[key]||0);
      let missing=v.qty;
      // Les engagements client chez The Hive sont prioritaires et ne transitent pas par le stock.
      if(original)for(const c of data.commandesStock.filter(c=>c.venteId===original.id&&!pourStock(c)&&c.statut==='commandee'&&cleArticle(c)===key&&!c.venteAnnulee)){
        const qty=Math.min(missing,c.qty);c.qtyAffectee=qty;c.recueAffectee=0;missing-=qty;
      }
      v.preleveStock=Math.min(missing,available);data.stock[key]=available-v.preleveStock;
      missing-=v.preleveStock;
      // Un réapprovisionnement stock ne couvre pas une vente avant son entrée physique.
      if(missing)data.commandesStock.push(nouvelleLigneStock(v,missing));
    }
    if(reprice){
      const cost=original&&cleArticle(original)===cleArticle(v)?coutAncien(original,old.indexOf(original)):
        produits.find(p=>p.id===v.produitId)?.achat;
      if(!Number.isFinite(cost))throw Error('Le produit sélectionné doit exister dans le catalogue.');
      Object.assign(v,prixEdition(v,header.type,cost,index===0));
    }
    v.modifieeAt=new Date().toISOString();return v;
  });
  data.ventes=data.ventes.filter(v=>!ids.has(v.id));
  data.ventes.push(...newSales);data.ventes.sort((a,b)=>a.id-b.id);
  for(const c of data.commandesStock.filter(c=>ids.has(c.venteId))){
    const v=newSales.find(v=>v.id===c.venteId);
    if(v&&!c.venteAnnulee){c.client=header.client;c.date=header.date;c.commandeClientId=group.id;c.commandeClientRef=group.ref;}
  }
  if(physical)revaliderLogistique(data,group.id,'Articles ou quantités modifiés : suivi à revalider');
  const logistics=data.logistique.find(l=>l.commandeClientId===group.id);
  if(logistics&&header.envoi!==group.envoi)logistics.modeLivraison=header.envoi==='non'?'retrait':'livraison';
  const surplus=data.commandesStock.filter(c=>ids.has(c.venteId)&&pourStock(c)&&c.statut==='commandee')
    .reduce((s,c)=>s+Math.max(0,remainingOrder(c)-attenteReservee(c)),0);
  const suiviHive=data.commandesStock.some(c=>ids.has(c.venteId)&&!pourStock(c)&&c.modificationFournisseurAConfirmer);
  return {data,next,physical,surplus,suiviHive,newSales};
}
function appliquerEdition(data,next=nextVenteId){
  // Sauvegarde utilisateur déclenchée avant le remplacement, sans jetons ni secrets.
  exporterDonnees();
  stock=data.stock;ventes=data.ventes;commandesStock=data.commandesStock;logistique=data.logistique;
  nextVenteId=Math.max(next,...ventes.map(v=>v.id+1),...commandesStock.map(c=>c.venteId+1));
  save();renderHistorique();renderCommandes();renderMetrics();checkAlerts();calcPrix();
  if(commandeClientCible){
    const group=groupesCommandesClients().find(g=>g.id===commandeClientCible);
    if(!group)resetPanierClient();
    else for(const [id,key] of [['v-client','client'],['v-date','date'],['v-type','type'],['v-envoi','envoi']])document.getElementById(id).value=group[key];
  }
  const active=document.querySelector('.section.active')?.id.replace('sec-','');
  if(active)showSection(active);
}
function avertissementEdition(plan){
  return `${plan.physical?'\nLes prélèvements réels et les besoins de commande seront recalculés. Le suivi logistique sera à revalider.':''}${plan.surplus?`\nATTENTION : ${plan.surplus} article(s) pour le stock sont à suivre auprès du fournisseur.`:''}${plan.suiviHive?'\nLa commande client déjà passée reste chez The Hive, sans retour ni entrée en stock. Prévenez The Hive de la modification ou de l’annulation.':''}\nUne sauvegarde JSON est téléchargée avant application. Aucun mail ni remboursement n’est envoyé.`;
}
function supprimerCommandeClient(id){
  const group=groupesCommandesClients().find(g=>g.id===id);if(!group)return;
  const plan=preparerEditionClient(group,{client:group.client,date:group.date,type:group.type,envoi:group.envoi},[]);
  if(!confirm(`Supprimer la commande ${group.ref} de ${group.client} ?\n${group.lignes.length} ligne(s), ${fmt(group.lignes.reduce((s,v)=>s+v.caTTC,0))} TTC seront retirées des ventes.${avertissementEdition(plan)}`))return;
  appliquerEdition(plan.data,plan.next);
}
function supprimerLigneClient(id){
  const group=groupesCommandesClients().find(g=>g.lignes.some(v=>v.id===id));if(!group)return;
  if(group.lignes.length===1){supprimerCommandeClient(group.id);return;}
  const plan=preparerEditionClient(group,{client:group.client,date:group.date,type:group.type,envoi:group.envoi},group.lignes.filter(v=>v.id!==id));
  if(!confirm(`Supprimer l’article de la ligne #${id} dans ${group.ref} ?${avertissementEdition(plan)}`))return;
  appliquerEdition(plan.data,plan.next);
}
function optionsEdition(values,selected){
  return [...new Set([selected,...values].filter(v=>v!==undefined&&v!==null))].map(v=>`<option value="${escapeHtml(v)}"${String(v)===String(selected)?' selected':''}>${escapeHtml(v)}</option>`).join('');
}
function produitEdition(l){
  return produits.find(p=>p.id===l.produitId)||{id:l.produitId,nom:l.produitNom,couleurs:[l.couleur],motifs:[l.motif],tailles:[l.taille]};
}
function champEdition(l,key,label,type='text',extra=''){
  return `<label>${label}<input data-edit-field="${key}" type="${type}" value="${escapeHtml(l[key]??'')}" ${extra}></label>`;
}
function htmlLigneEdition(l,index){
  const p=produitEdition(l),choices=produits.some(p=>p.id===l.produitId)?produits:[p,...produits];
  return `<div class="edit-line" data-edit-line="${escapeHtml(l.editKey)}">
    <div class="edit-line-heading"><strong>Article ${index+1}</strong><button type="button" class="btn sm danger" data-remove-edit="${escapeHtml(l.editKey)}">Retirer cette ligne</button></div>
    <div class="edit-grid">
      <label class="edit-wide">Produit<select data-edit-field="produitId">${choices.map(p=>`<option value="${p.id}"${p.id===l.produitId?' selected':''}>${escapeHtml(p.nom)}</option>`).join('')}</select></label>
      <label>Couleur<select data-edit-field="couleur">${optionsEdition(p.couleurs,l.couleur)}</select></label>
      <label>Motif<select data-edit-field="motif">${optionsEdition(p.motifs,l.motif)}</select></label>
      <label>Taille<select data-edit-field="taille">${optionsEdition(p.tailles,l.taille)}</select></label>
      ${champEdition(l,'qty','Quantité','number','min="1" step="1" required')}
      ${champEdition(l,'prixHT','Prix unitaire HT (€)','number','min="0.0001" step="any" required')}
      ${champEdition(l,'remise','Remise','number','min="0" step="any" required')}
      <label>Type de remise<select data-edit-field="remiseType"><option value="pct"${l.remiseType==='pct'?' selected':''}>%</option><option value="eur"${l.remiseType==='eur'?' selected':''}>€ TTC</option></select></label>
      <label class="edit-wide">Commentaire<input data-edit-field="note" value="${escapeHtml(l.note||'')}" maxlength="1000"></label>
    </div></div>`;
}
function renderLignesEdition(){
  document.getElementById('edit-client-lines').innerHTML=editionClient.lines.map(htmlLigneEdition).join('');
}
function ouvrirEditionClient(id){
  const group=groupesCommandesClients().find(g=>g.id===id);if(!group)return;
  editionClient={id,empreinte:empreinteEdition(),lines:group.lignes.map(v=>({...copieEdition(v),remise:v.remise||0,editKey:crypto.randomUUID()}))};
  document.getElementById('edit-client-title').textContent=`Modifier ${group.ref}`;
  for(const [id,key] of [['edit-client-name','client'],['edit-client-date','date'],['edit-client-type','type'],['edit-client-delivery','envoi']])document.getElementById(id).value=group[key];
  document.getElementById('edit-client-feedback').textContent='';renderLignesEdition();
  document.getElementById('edit-client-dialog').showModal();
}
function enregistrerEditionClient(event){
  event.preventDefault();if(!editionClient)return;
  try{
    if(empreinteEdition()!==editionClient.empreinte)throw Error('Les données ont changé. Fermez puis rouvrez cette commande.');
    const group=groupesCommandesClients().find(g=>g.id===editionClient.id);if(!group)throw Error('Commande introuvable.');
    const header={client:document.getElementById('edit-client-name').value.trim(),date:document.getElementById('edit-client-date').value,
      type:document.getElementById('edit-client-type').value,envoi:document.getElementById('edit-client-delivery').value};
    if(!header.client||!header.date)throw Error('Le client et la date sont requis.');
    if(!editionClient.lines.length)throw Error('Conservez au moins une ligne, ou utilisez « Supprimer la commande ».');
    for(const l of editionClient.lines)if(!Number.isSafeInteger(l.qty)||l.qty<1||!Number.isFinite(l.prixHT)||l.prixHT<=0||
      !Number.isFinite(l.remise)||l.remise<0||(l.remiseType==='pct'&&l.remise>100)||!l.couleur||!l.motif||!l.taille)throw Error('Vérifiez les articles, quantités entières, prix et remises.');
    const plan=preparerEditionClient(group,header,editionClient.lines);
    if(!confirm(`Enregistrer les modifications de ${group.ref} ?\nClient : ${header.client}\n${plan.newSales.length} ligne(s), ${fmt(plan.newSales.reduce((s,v)=>s+v.caTTC,0))} TTC.${avertissementEdition(plan)}`))return;
    appliquerEdition(plan.data,plan.next);document.getElementById('edit-client-dialog').close();
  }catch(error){flash('edit-client-feedback',error.message,'err');}
}
function ouvrirEditionStock(id){
  const c=commandesStock.find(c=>c.id===id);if(!c)return;
  editionStock={id,empreinte:empreinteEdition()};
  document.getElementById('edit-stock-description').textContent=`${c.produitNom} · ${c.couleur} · ${c.motif} · ${c.taille} · Client : ${c.client}`;
  document.getElementById('edit-stock-qty').value=c.qty;document.getElementById('edit-stock-qty').min=Math.max(1,c.recue);
  document.getElementById('edit-stock-reference').value=c.reference||'';
  document.getElementById('edit-stock-note').value=c.noteFournisseur||'';
  document.getElementById('edit-stock-received').textContent=pourStock(c)
    ?`${c.recue} article(s) déjà reçu(s) pour le stock. Le total ne peut pas être inférieur à cette quantité.`
    :'Commande destinée au client, gérée par The Hive : aucune réception à saisir et aucune entrée en stock. L’article et le client se corrigent depuis la commande client liée.';
  document.getElementById('edit-stock-feedback').textContent='';
  document.getElementById('edit-stock-dialog').showModal();
}
function enregistrerEditionStock(event){
  event.preventDefault();if(!editionStock)return;
  try{
    if(empreinteEdition()!==editionStock.empreinte)throw Error('Les données ont changé. Fermez puis rouvrez cette ligne.');
    const data=etatEdition(),c=data.commandesStock.find(c=>c.id===editionStock.id);
    const qty=Number(document.getElementById('edit-stock-qty').value);
    if(!Number.isSafeInteger(qty)||qty<Math.max(1,c.recue))throw Error('La quantité doit être entière, positive et au moins égale au total reçu.');
    const oldQty=c.qty,received=recueReservee(c);
    const v=data.ventes.find(v=>v.id===c.venteId&&cleArticle(v)===cleArticle(c));
    let wanted=0;
    if(v&&lieeStock(c)){
      wanted=Math.max(0,v.qty-(v.preleveStock??v.qty)-data.commandesStock.filter(x=>x.id!==c.id&&x.venteId===v.id).reduce((s,x)=>s+quantiteReservee(x),0));
    }
    c.qty=qty;c.recueAffectee=received;c.qtyAffectee=Math.min(wanted,received+remainingOrder(c));
    if(pourStock(c)&&c.statut==='recue'&&qty>c.recue)c.statut='commandee';
    if(pourStock(c)&&c.statut==='commandee'&&qty===c.recue)c.statut='recue';
    c.reference=document.getElementById('edit-stock-reference').value.trim();c.noteFournisseur=document.getElementById('edit-stock-note').value.trim();
    if(qty!==oldQty&&['commandee','recue'].includes(c.statut))c.modificationFournisseurAConfirmer=true;
    c.modifieeAt=new Date().toISOString();
    if(v&&qty!==oldQty)revaliderLogistique(data,clientOrderKey(v),'Quantité fournisseur modifiée : suivi à revalider');
    const missing=v?besoinNonCouvert(v,data):0;
    if(!confirm(`Modifier cette ligne de commande ?\n${c.produitNom} · ${qty} article(s)${pourStock(c)?`, dont ${c.recue} reçu(s)`:' pour le client, hors stock'}.${missing?`\n${missing} article(s) de la vente ne seront plus couverts par une commande fournisseur.`:''}\nLa vente client et son montant ne sont pas modifiés.${c.modificationFournisseurAConfirmer?'\nContactez The Hive pour confirmer la nouvelle quantité. Aucun mail ne sera envoyé.':''}\nUne sauvegarde JSON est téléchargée avant application.`))return;
    appliquerEdition(data);document.getElementById('edit-stock-dialog').close();
  }catch(error){flash('edit-stock-feedback',error.message,'err');}
}
function supprimerCommandeStock(id){
  const data=etatEdition(),c=data.commandesStock.find(c=>c.id===id);if(!c)return;
  const v=data.ventes.find(v=>v.id===c.venteId&&cleArticle(v)===cleArticle(c));
  if(v)v.preleveStock=(v.preleveStock??v.qty)+recueReservee(c);
  data.commandesStock=data.commandesStock.filter(c=>c.id!==id);
  const missing=v?besoinNonCouvert(v,data):0;
  if(v)revaliderLogistique(data,clientOrderKey(v),'Ligne fournisseur supprimée : suivi à revalider');
  if(!confirm(`Supprimer cette ligne de commande ?\n${c.produitNom} · ${c.couleur} · ${c.motif} · ${c.taille}\nDestination : ${pourStock(c)?'stock BZAK':c.client} · Quantité : ${c.qty}${pourStock(c)?`, reçue : ${c.recue}`:''}.\n${pourStock(c)?'Les articles déjà reçus restent en stock.':'La vente reste enregistrée. Cette suppression ne modifie pas le stock.'}${missing?`\nATTENTION : ${missing} article(s) de la vente resteront sans commande fournisseur.`:''}${c.statut!=='a_commander'?'\nCette action N’ANNULE PAS la commande chez The Hive. Contactez le fournisseur si nécessaire.':''}\nUne sauvegarde JSON est téléchargée avant application.`))return;
  appliquerEdition(data);
}
function recreerBesoinsStock(){
  const data=etatEdition();let qty=0;
  for(const v of data.ventes){const n=besoinNonCouvert(v,data);if(n){data.commandesStock.push(nouvelleLigneStock(v,n));qty+=n;}}
  if(!qty)return;
  if(!confirm(`Recréer les besoins de commande pour ${qty} article(s) non couverts ?\nVérifiez qu’ils ne sont pas déjà commandés chez le fournisseur pour éviter un doublon.`))return;
  appliquerEdition(data);
}
function confirmerCorrectionFournisseur(id){
  const c=commandesStock.find(c=>c.id===id);if(!c)return;
  if(!confirm(`Confirmez-vous avoir convenu avec The Hive de la quantité ${c.qty} pour ${c.produitNom} ?\nAucun mail n’est envoyé par cette action.`))return;
  c.modificationFournisseurAConfirmer=false;save();renderCommandes();
}
function renderBesoinsNonCouverts(){
  const root=document.getElementById('uncovered-stock');if(!root)return;
  const missing=ventes.reduce((s,v)=>s+besoinNonCouvert(v),0);
  root.hidden=!missing;
  root.innerHTML=missing?`<div><strong>${missing} article(s) vendu(s) sans commande stock associée.</strong><br>Une suppression ou une baisse de quantité fournisseur peut laisser un besoin à traiter.</div><button class="btn" onclick="recreerBesoinsStock()">Recréer les besoins</button>`:'';
}
function validerAffectationsStock(data){
  for(const v of data.ventes||[]){
    if(v.preleveStock!==undefined&&(!Number.isSafeInteger(v.preleveStock)||v.preleveStock<0||v.preleveStock>v.qty))throw Error('Quantité client prélevée incohérente.');
    if(v.coutAchatUnitaire!==undefined&&(!Number.isFinite(v.coutAchatUnitaire)||v.coutAchatUnitaire<0))throw Error('Coût d’achat historique invalide.');
  }
  for(const c of data.commandesStock||[]){
    for(const key of ['recueAffectee','qtyAffectee'])if(c[key]!==undefined&&(!Number.isSafeInteger(c[key])||c[key]<0))throw Error('Affectation de stock invalide.');
    if(c.recueAffectee!==undefined&&c.recueAffectee>c.recue)throw Error('Réception affectée supérieure au reçu.');
    if(c.qtyAffectee!==undefined&&(c.qtyAffectee<(c.recueAffectee||0)||c.qtyAffectee-(c.recueAffectee||0)>c.qty-c.recue))throw Error('Réservation fournisseur incohérente.');
  }
}
function initEditionCommandes(){
  document.body.insertAdjacentHTML('beforeend',`
    <dialog class="order-dialog edit-dialog" id="edit-client-dialog" aria-labelledby="edit-client-title">
      <div class="dialog-heading"><h2 id="edit-client-title">Modifier une commande</h2><button class="btn" type="button" onclick="document.getElementById('edit-client-dialog').close()">Fermer</button></div>
      <form id="edit-client-form">
        <div class="edit-grid"><label>Client<input id="edit-client-name" required maxlength="200"></label><label>Date<input id="edit-client-date" type="date" required></label>
        <label>Canal<select id="edit-client-type"><option>TPE Physique</option><option>Site Internet</option></select></label>
        <label>Livraison<select id="edit-client-delivery"><option value="non">Retrait</option><option value="oui">Livraison</option></select></label></div>
        <p class="order-note">La TVA historique de chaque ligne est conservée. Les totaux, stocks et besoins liés sont recalculés lors de la validation. Une sauvegarde JSON est téléchargée avant application.</p>
        <div id="edit-client-lines"></div><button type="button" class="btn" id="edit-client-add">Ajouter un article</button>
        <div class="edit-footer"><button type="submit" class="btn primary">Enregistrer les modifications</button><button type="button" class="btn" onclick="document.getElementById('edit-client-dialog').close()">Annuler</button><span id="edit-client-feedback" role="status"></span></div>
      </form>
    </dialog>
    <dialog class="order-dialog" id="edit-stock-dialog" aria-labelledby="edit-stock-title">
      <div class="dialog-heading"><h2 id="edit-stock-title">Modifier la commande stock</h2><button type="button" class="btn" onclick="document.getElementById('edit-stock-dialog').close()">Fermer</button></div>
      <p id="edit-stock-description"></p><p id="edit-stock-received" class="order-note"></p>
      <form id="edit-stock-form"><div class="field"><label for="edit-stock-qty">Quantité totale fournisseur</label><input id="edit-stock-qty" type="number" min="1" step="1" required></div>
      <div class="field"><label for="edit-stock-reference">Référence de la commande</label><input id="edit-stock-reference" maxlength="150"></div>
      <div class="field"><label for="edit-stock-note">Note fournisseur</label><textarea id="edit-stock-note" maxlength="1000" rows="3"></textarea></div>
      <div class="edit-footer"><button type="submit" class="btn primary">Enregistrer les modifications</button><button type="button" class="btn" onclick="document.getElementById('edit-stock-dialog').close()">Annuler</button><span id="edit-stock-feedback" role="status"></span></div></form>
    </dialog>`);
  document.getElementById('edit-client-form').addEventListener('submit',enregistrerEditionClient);
  document.getElementById('edit-stock-form').addEventListener('submit',enregistrerEditionStock);
  document.getElementById('edit-client-dialog').addEventListener('close',()=>{editionClient=null;});
  document.getElementById('edit-stock-dialog').addEventListener('close',()=>{editionStock=null;});
  document.getElementById('edit-client-lines').addEventListener('input',modifierChampEdition);
  document.getElementById('edit-client-lines').addEventListener('change',modifierChampEdition);
  document.getElementById('edit-client-lines').addEventListener('click',event=>{
    const btn=event.target.closest('[data-remove-edit]');if(!btn)return;
    editionClient.lines=editionClient.lines.filter(l=>l.editKey!==btn.dataset.removeEdit);renderLignesEdition();
  });
  document.getElementById('edit-client-add').addEventListener('click',()=>{
    const p=produits[0];if(!p){flash('edit-client-feedback','Ajoutez d’abord un produit au catalogue.','err');return;}
    editionClient.lines.push({editKey:crypto.randomUUID(),produitId:p.id,produitNom:p.nom,couleur:p.couleurs[0],motif:p.motifs[0],taille:p.tailles[0],qty:1,prixHT:p.venteHT,remise:0,remiseType:'pct',tvaRate:TVA,note:''});renderLignesEdition();
  });
  document.getElementById('client-orders-history').addEventListener('click',event=>{
    const edit=event.target.closest('[data-edit-client]'),del=event.target.closest('[data-delete-client]');
    if(edit)ouvrirEditionClient(edit.dataset.editClient);if(del)supprimerCommandeClient(del.dataset.deleteClient);
  });
}
function modifierChampEdition(event){
  const field=event.target.dataset.editField;if(!field||!editionClient)return;
  const l=editionClient.lines.find(l=>l.editKey===event.target.closest('[data-edit-line]').dataset.editLine);if(!l)return;
  l[field]=['produitId','qty','prixHT','remise'].includes(field)?Number(event.target.value):event.target.value;
  if(field==='produitId'){
    const p=produits.find(p=>p.id===l.produitId);if(!p)return;
    Object.assign(l,{produitNom:p.nom,couleur:p.couleurs[0],motif:p.motifs[0],taille:p.tailles[0],prixHT:p.venteHT,remise:0});
    renderLignesEdition();
  }
}
