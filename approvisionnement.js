// Réapprovisionnement indépendant des ventes : aucune vente fictive n'est créée.
function initApprovisionnement(){
  document.body.insertAdjacentHTML('beforeend',`
    <dialog id="stock-create" class="order-dialog" aria-labelledby="stock-create-title">
      <div class="dialog-heading"><h2 id="stock-create-title">Commander pour le stock</h2><button type="button" class="btn" onclick="document.getElementById('stock-create').close()">Fermer</button></div>
      <p class="order-note">Ces articles sont destinés au stock BZAK, pas à une commande client. Ils entreront en stock uniquement lors de la réception.</p>
      <form id="stock-create-form">
        <div class="field"><label for="stock-create-product">Produit</label><select id="stock-create-product" required></select></div>
        <div class="field"><label for="stock-create-color">Couleur</label><select id="stock-create-color" required></select></div>
        <div class="field"><label for="stock-create-pattern">Motif</label><select id="stock-create-pattern" required></select></div>
        <div class="field"><label for="stock-create-size">Taille</label><select id="stock-create-size" required></select></div>
        <div class="field"><label for="stock-create-qty">Quantité à commander</label><input id="stock-create-qty" type="number" min="1" step="1" value="1" required></div>
        <div class="edit-footer"><button class="btn primary" type="submit">Ajouter à la liste à commander</button><span id="stock-create-feedback" role="status"></span></div>
      </form>
    </dialog>`);
  document.getElementById('stock-create-product').addEventListener('change',variantesCommandeStock);
  document.getElementById('stock-create-form').addEventListener('submit',event=>{
    event.preventDefault();
    const p=produits.find(p=>p.id===Number(document.getElementById('stock-create-product').value));
    const qty=Number(document.getElementById('stock-create-qty').value);
    const couleur=document.getElementById('stock-create-color').value,motif=document.getElementById('stock-create-pattern').value,taille=document.getElementById('stock-create-size').value;
    if(!p||!Number.isSafeInteger(qty)||qty<1||!p.couleurs.includes(couleur)||!p.motifs.includes(motif)||!p.tailles.includes(taille)){
      flash('stock-create-feedback','Vérifiez le produit, la déclinaison et la quantité entière positive.','err');return;
    }
    commandesStock.push({id:crypto.randomUUID(),venteId:0,date:new Date().toISOString().slice(0,10),client:'Stock BZAK',
      produitId:p.id,produitNom:p.nom,couleur,motif,taille,qty,recue:0,statut:'a_commander',destination:'stock',stockLibre:true,
      createdAt:new Date().toISOString()});
    save();filterOrders('a_commander');document.getElementById('stock-create').close();
    flash('orders-flash',`${qty} article(s) ajoutés à commander pour le stock. Aucune entrée en stock avant réception.`,'ok');
  });
}
function ouvrirCommandePourStock(){
  if(!produits.length){alert('Ajoutez un produit au catalogue avant de commander.');return;}
  document.getElementById('stock-create-form').reset();
  document.getElementById('stock-create-product').innerHTML=produits.map(p=>`<option value="${p.id}">${escapeHtml(p.nom)}</option>`).join('');
  document.getElementById('stock-create-feedback').textContent='';
  variantesCommandeStock();document.getElementById('stock-create').showModal();
}
function variantesCommandeStock(){
  const p=produits.find(p=>p.id===Number(document.getElementById('stock-create-product').value));if(!p)return;
  for(const [id,key] of [['color','couleurs'],['pattern','motifs'],['size','tailles']]){
    document.getElementById(`stock-create-${id}`).innerHTML=p[key].map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  }
}
