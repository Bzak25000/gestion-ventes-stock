// Les ventes restent des lignes : les anciennes sauvegardes, statistiques et annulations
// restent compatibles. commandeClientId regroupe les lignes d'une seule commande.
let panierClient=[];
let commandeClientCible='';
let articleClientModifie=false;
const clientOrderKey=v=>v.commandeClientId||`vente-${v.id}`;
const clientOrderRef=v=>v.commandeClientRef||`Vente #${v.id}`;
const arrondiMontant=n=>Math.round((n+Number.EPSILON)*100)/100;

function groupesCommandesClients(){
  const groups=new Map();
  ventes.forEach(v=>{
    const key=clientOrderKey(v);
    if(!groups.has(key))groups.set(key,{id:key,ref:clientOrderRef(v),client:v.client,date:v.date,type:v.type,envoi:v.envoi,lignes:[]});
    groups.get(key).lignes.push(v);
  });
  return [...groups.values()];
}
function lireArticleClient(){
  const produitId=Number(document.getElementById('v-produit').value);
  const prod=produits.find(p=>p.id===produitId);
  const ligne={
    produitId,produitNom:prod?.nom,couleur:document.getElementById('v-couleur').value,
    motif:document.getElementById('v-motif').value,taille:document.getElementById('v-taille').value,
    qty:Number(document.getElementById('v-qty').value),prixHT:Number(document.getElementById('v-prix-ht').value),
    remise:Number(document.getElementById('v-remise').value)||0,remiseType:document.getElementById('v-remise-type').value,
    note:document.getElementById('v-note').value.trim(),tvaRate:TVA
  };
  if(!prod||!ligne.couleur||!ligne.motif||!ligne.taille||!Number.isSafeInteger(ligne.qty)||ligne.qty<1||
    !Number.isFinite(ligne.prixHT)||ligne.prixHT<=0)throw Error('Article, quantité entière positive et prix positif requis.');
  if(!Number.isFinite(ligne.remise)||ligne.remise<0||(ligne.remiseType==='pct'&&ligne.remise>100))throw Error('Remise invalide.');
  return ligne;
}
function montantsArticleClient(ligne,type,fraisFixes=false){
  const taux=1+ligne.tvaRate/100;
  const prixTTC=ligne.prixHT*taux;
  const brut=prixTTC*ligne.qty;
  const remiseTTC=ligne.remiseType==='pct'?brut*ligne.remise/100:Math.min(ligne.remise,brut);
  const caTTC=arrondiMontant(brut-remiseTTC);
  const caHT=arrondiMontant(caTTC/taux);
  const frais=type==='TPE Physique'?caTTC*0.0175:caTTC*0.015+(fraisFixes?0.25:0);
  const prod=produits.find(p=>p.id===ligne.produitId);
  return {prixTTC:arrondiMontant(prixTTC),remiseMontantTTC:arrondiMontant(remiseTTC),remiseMontantHT:arrondiMontant(remiseTTC/taux),
    caTTC,caHT,marge:arrondiMontant((ligne.prixHT-(prod?.achat||0))*ligne.qty-remiseTTC/taux-frais)};
}
function ajouterArticlePanier(){
  try{
    panierClient.push({...lireArticleClient(),draftId:crypto.randomUUID()});
    articleClientModifie=false;
    document.getElementById('v-qty').value=1;
    document.getElementById('v-note').value='';
    document.getElementById('v-remise').value=0;
    renderPanierClient();calcPrix();
    flash('v-flash','Article ajouté au panier. Le stock sera mis à jour à l’enregistrement de la commande.','ok');
  }catch(error){flash('v-flash',error.message,'err');}
}
function retirerArticlePanier(id){
  panierClient=panierClient.filter(l=>l.draftId!==id);
  renderPanierClient();
}
function renderPanierClient(){
  const root=document.getElementById('client-cart');if(!root)return;
  const simulated={...stock};
  let manque=0;
  const rows=panierClient.map(l=>{
    const key=sKey(l.produitId,l.couleur,l.motif,l.taille);
    const dispo=Math.max(0,simulated[key]||0);
    const shortage=Math.max(0,l.qty-dispo);manque+=shortage;
    simulated[key]=Math.max(0,dispo-l.qty);
    return `<tr><td><strong>${escapeHtml(l.produitNom)}</strong><br><small>${escapeHtml(l.couleur)} · ${escapeHtml(l.motif)} · ${escapeHtml(l.taille)}</small></td><td>${l.qty}</td><td>${fmt(montantsArticleClient(l,'TPE Physique').caTTC)}</td><td>${shortage?`<span class="order-status pending">${shortage} à commander</span>`:'En stock'}</td><td><button class="btn sm danger" data-remove-cart="${escapeHtml(l.draftId)}" aria-label="Retirer ${escapeHtml(l.produitNom)} du panier">Retirer</button></td></tr>`;
  });
  root.innerHTML=panierClient.length?`
    <div class="card-title">Panier de la commande <span class="order-status">${panierClient.length} ligne(s)</span></div>
    <div class="cart-table"><table><thead><tr><th>Article</th><th>Qté</th><th>Total TTC</th><th>Disponibilité</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
    <div class="cart-total"><span>${panierClient.reduce((s,l)=>s+l.qty,0)} article(s) · ${manque} à commander</span><strong>${fmt(panierClient.reduce((s,l)=>s+montantsArticleClient(l,'TPE Physique').caTTC,0))} TTC</strong></div>
    ${articleClientModifie?'<div class="alert warning">L’article en cours a été modifié. Ajoutez-le au panier avant de valider, ou <button class="btn sm" onclick="articleClientModifie=false;renderPanierClient()">Ignorer cette saisie</button>.</div>':''}
    <p class="order-note">Le panier n’est pas encore enregistré. Le client, la date et le canal ci-dessus s’appliquent à toutes ces lignes.</p>`:
    '<p class="order-note">Pour une commande multi-articles, ajoutez chaque article au panier. Pour un seul article, vous pouvez enregistrer directement.</p>';
  document.getElementById('btn-enregistrer-vente').textContent=commandeClientCible?'Enregistrer les articles supplémentaires':'Enregistrer la commande';
}
function changerCommandeClient(key){
  if(panierClient.length&&!confirm('Changer de commande et vider le panier non enregistré ?')){
    document.getElementById('client-order-target').value=commandeClientCible;return;
  }
  const group=key?groupesCommandesClients().find(g=>g.id===key):null;
  if(key&&!group){alert('Cette commande n’existe plus.');return;}
  panierClient=[];articleClientModifie=false;commandeClientCible=key;
  document.getElementById('client-order-target').value=key;
  ['v-client','v-date','v-type','v-envoi'].forEach(id=>document.getElementById(id).disabled=!!key);
  document.getElementById('v-client').value=group?.client||'';
  if(group){
    document.getElementById('v-date').value=group.date;
    document.getElementById('v-type').value=group.type;
    document.getElementById('v-envoi').value=group.envoi;
  }else initDate();
  renderPanierClient();
}
function completerCommandeClient(key){
  changerCommandeClient(key);
  if(commandeClientCible===key){showSection('ventes');document.getElementById('client-order-target').scrollIntoView({block:'center'});}
}
function enregistrerCommandeClient(){
  try{
    if(panierClient.length&&articleClientModifie)throw Error('Ajoutez l’article en cours au panier, ou cliquez sur « Ignorer cette saisie », avant d’enregistrer.');
    const group=commandeClientCible?groupesCommandesClients().find(g=>g.id===commandeClientCible):null;
    if(commandeClientCible&&!group)throw Error('La commande cible n’existe plus. Sélectionnez une autre commande.');
    const client=group?.client||document.getElementById('v-client').value.trim();
    const date=group?.date||document.getElementById('v-date').value;
    const type=group?.type||document.getElementById('v-type').value;
    const envoi=group?.envoi||document.getElementById('v-envoi').value;
    if(!client||!date)throw Error('Indiquez le client et la date de la commande.');
    const lignes=panierClient.length?panierClient:[lireArticleClient()];
    if(lignes.some(l=>!produits.some(p=>p.id===l.produitId)))throw Error('Un produit du panier a été supprimé. Retirez-le avant de continuer.');
    const commandeClientId=group?.id||crypto.randomUUID();
    const commandeClientRef=group?.ref||`CL-${date.replaceAll('-','')}-${commandeClientId.slice(0,8).toUpperCase()}`;
    // Construire l'intégralité du changement avant de modifier les données enregistrées.
    const newStock={...stock},newSales=[],newOrders=[];
    let id=nextVenteId;
    for(const [index,l] of lignes.entries()){
      const {draftId,...line}=l;
      const key=sKey(line.produitId,line.couleur,line.motif,line.taille);
      const dispo=Math.max(0,newStock[key]||0),preleveStock=Math.min(dispo,line.qty);
      const missing=line.qty-preleveStock;
      const sale={...line,...montantsArticleClient(line,type,!group&&index===0),id:id++,date,client,type,envoi,preleveStock,
        commandeClientId,commandeClientRef,enregistreeAt:new Date().toISOString()};
      newSales.push(sale);newStock[key]=dispo-preleveStock;
      if(missing)newOrders.push({id:crypto.randomUUID(),venteId:sale.id,date,client,
        produitId:line.produitId,produitNom:line.produitNom,couleur:line.couleur,motif:line.motif,taille:line.taille,
        qty:missing,recue:0,statut:'a_commander',commandeClientId,commandeClientRef,createdAt:new Date().toISOString()});
    }
    // Lors de l'ajout à une vente ancienne, conserver sa référence et la relier explicitement.
    if(group&&typeof confirmerAjoutLogistique==='function'&&!confirmerAjoutLogistique(group.id))return;
    if(group){
      const oldIds=new Set(group.lignes.map(v=>v.id));
      group.lignes.forEach(v=>{v.commandeClientId=commandeClientId;v.commandeClientRef=commandeClientRef;});
      commandesStock.filter(c=>oldIds.has(c.venteId)).forEach(c=>{c.commandeClientId=commandeClientId;c.commandeClientRef=commandeClientRef;});
    }
    ventes.push(...newSales);commandesStock.push(...newOrders);stock=newStock;nextVenteId=id;
    const logReouvert=group&&typeof reouvrirLogistiqueApresAjout==='function'?reouvrirLogistiqueApresAjout(group.id):false;
    save();
    const missing=newOrders.reduce((s,c)=>s+c.qty,0);
    panierClient=[];articleClientModifie=false;commandeClientCible='';
    ['v-client','v-date','v-type','v-envoi'].forEach(id=>document.getElementById(id).disabled=false);
    document.getElementById('v-client').value='';document.getElementById('v-note').value='';
    document.getElementById('v-qty').value=1;document.getElementById('v-remise').value=0;
    initDate();onProduitChange();renderPanierClient();renderCommandesClients();renderCommandes();renderMetrics();checkAlerts();
    flash('v-flash',`${commandeClientRef} ${group?'complétée':'enregistrée'} : ${newSales.length} ligne(s), ${missing} article(s) à commander.${logReouvert?' Suivi logistique à revalider.':''}`,'ok');
  }catch(error){flash('v-flash',error.message,'err');}
}
function renderCommandesClients(){
  const groups=groupesCommandesClients();
  const select=document.getElementById('client-order-target');
  if(select){
    select.innerHTML='<option value="">Nouvelle commande</option>'+[...groups].reverse().map(g=>`<option value="${escapeHtml(g.id)}">${escapeHtml(g.ref)} · ${escapeHtml(g.client)} · ${g.lignes.length} ligne(s)</option>`).join('');
    select.value=commandeClientCible;
  }
  const zone=document.getElementById('client-orders-history');if(!zone)return;
  zone.innerHTML=`<div class="card-title">Commandes clients <span class="order-status">${groups.length} commande(s)</span></div>`+
    (groups.length?[...groups].reverse().map(g=>`
      <details class="client-order-group">
        <summary><span><strong>${escapeHtml(g.client)}</strong><small>${escapeHtml(g.ref)} · ${escapeHtml(g.date)} · ${g.lignes.length} ligne(s)</small></span><strong>${fmt(g.lignes.reduce((s,l)=>s+l.caTTC,0))} TTC</strong></summary>
        <div class="cart-table"><table><thead><tr><th>Article</th><th>Déclinaison</th><th>Qté</th><th>Total TTC</th></tr></thead><tbody>${g.lignes.map(l=>`<tr><td>${escapeHtml(l.produitNom)}</td><td>${escapeHtml(l.couleur)} · ${escapeHtml(l.motif)} · ${escapeHtml(l.taille)}</td><td>${l.qty}</td><td>${fmt(l.caTTC)}</td></tr>`).join('')}</tbody></table></div>
        <button class="btn" data-complete-client-order="${escapeHtml(g.id)}">Ajouter des articles à cette commande</button>
      </details>`).join(''):'<p class="orders-sub">Les commandes enregistrées apparaîtront ici, regroupées par référence et par client.</p>');
}
function resetPanierClient(){
  panierClient=[];articleClientModifie=false;commandeClientCible='';
  ['v-client','v-date','v-type','v-envoi'].forEach(id=>document.getElementById(id).disabled=false);
  renderPanierClient();renderCommandesClients();
}
function initCommandesClients(){
  const history=document.createElement('div');history.className='card';history.id='client-orders-history';
  document.querySelector('#sec-historique .page-title').after(history);
  history.addEventListener('click',event=>{
    const button=event.target.closest('[data-complete-client-order]');
    if(button)completerCommandeClient(button.dataset.completeClientOrder);
  });
  document.getElementById('client-cart').addEventListener('click',event=>{
    const button=event.target.closest('[data-remove-cart]');
    if(button)retirerArticlePanier(button.dataset.removeCart);
  });
  const fields=['v-produit','v-couleur','v-motif','v-taille','v-qty','v-prix-ht','v-prix-ttc','v-remise','v-remise-type','v-note'];
  fields.forEach(id=>['input','change'].forEach(eventName=>document.getElementById(id).addEventListener(eventName,()=>{
    articleClientModifie=true;renderPanierClient();
  })));
  window.addEventListener('beforeunload',event=>{if(panierClient.length){event.preventDefault();event.returnValue='';}});
  renderPanierClient();renderCommandesClients();
}
