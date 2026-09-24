const HIVE_EMAIL = 'justin@atelierthehive.fr';
let preparedOrder = null;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const remainingOrder = c => Math.max(0, c.qty - (c.recue || 0));
const isPendingOrder = c => c.statut === 'a_commander' && !c.venteAnnulee;
const orderLabel = c => c.statut === 'annulee' ? 'Annulée' : c.statut === 'recue' ? 'Reçue' : c.statut === 'commandee' ? (c.recue ? 'Réception partielle' : 'Commandée') : 'À commander';

function initCommandes() {
  const nav = document.createElement('div');
  nav.className = 'nav-item';
  nav.setAttribute('role', 'button'); nav.tabIndex = 0;
  nav.innerHTML = '<i class="fas fa-clipboard-list"></i> Commande stock <span class="nav-badge" id="commandes-badge" hidden></span>';
  nav.onclick = () => showSection('commandes');
  document.querySelector("nav .nav-item[onclick=\"showSection('stock')\"]").after(nav);
  const section = document.createElement('section');
  section.id = 'sec-commandes'; section.className = 'section';
  section.innerHTML = `
    <div class="orders-heading">
      <div><h2 class="page-title"><i class="fas fa-clipboard-list"></i> Commande stock</h2>
      <p class="orders-sub">Les articles manquants, rattachés à chaque vente et à chaque client.</p></div>
      <span class="order-status sent">Fournisseur : The Hive</span>
    </div>
    <div class="orders-metrics">
      <div class="metric"><div class="metric-label">À commander</div><div class="metric-value orange" id="orders-pending">0</div><div class="orders-sub">article(s)</div></div>
      <div class="metric"><div class="metric-label">En attente</div><div class="metric-value" id="orders-sent">0</div><div class="orders-sub">article(s) commandé(s)</div></div>
      <div class="metric"><div class="metric-label">Clients en attente</div><div class="metric-value green" id="orders-clients">0</div><div class="orders-sub">à approvisionner</div></div>
    </div>
    <div class="card">
      <div class="orders-toolbar">
        <input type="search" id="orders-search" aria-label="Rechercher un article ou un client" placeholder="Rechercher un article, un client…" oninput="renderCommandes()">
        <select id="orders-filter" aria-label="Filtrer les commandes" onchange="renderCommandes()">
          <option value="active">Commandes en cours</option><option value="a_commander">À commander</option><option value="commandee">Commandées</option><option value="recue">Reçues</option><option value="all">Tout l’historique</option>
        </select>
        <button class="btn primary" id="prepare-order" onclick="preparerCommande()"><i class="fas fa-envelope"></i> Préparer le mail</button>
      </div>
      <div class="order-table"><table>
        <thead><tr><th><input type="checkbox" id="orders-all" aria-label="Sélectionner toutes les lignes à commander affichées" onchange="selectAllOrders(this.checked)"></th><th>Vente / date</th><th>Article et déclinaison</th><th>Client</th><th>À fournir</th><th>Reçu</th><th>Statut</th><th>Suivi</th></tr></thead>
        <tbody id="orders-body"></tbody>
      </table></div>
      <p class="order-note">Seule la quantité manquante est commandée. Les réceptions sont réservées au client : elles ne gonflent pas le stock disponible.</p>
      <p class="order-note">Le mail est modifiable avant envoi à ${HIVE_EMAIL}. Aucun envoi automatique. Après l’envoi réel, confirmez-le pour éviter les doublons.</p>
      <span id="orders-flash" role="status"></span>
    </div>`;
  document.querySelector('main').append(section);
  document.body.insertAdjacentHTML('beforeend', `
    <dialog id="order-mail" class="order-dialog" aria-labelledby="order-mail-title">
      <div class="dialog-heading"><h2 id="order-mail-title">Vérifier la commande</h2><button class="btn sm" onclick="closeOrderMail()" aria-label="Fermer l’aperçu du mail">Fermer</button></div>
      <p id="order-mail-summary" class="orders-sub" style="margin-bottom:16px"></p>
      <div class="field"><label for="order-to">Destinataire</label><input id="order-to" type="email" readonly value="${HIVE_EMAIL}"></div>
      <div class="field"><label for="order-subject">Objet</label><input id="order-subject" maxlength="200"></div>
      <div class="field"><label for="order-body">Message à contrôler avant envoi</label><textarea id="order-body"></textarea></div>
      <p class="order-note" id="mail-length-warning"></p>
      <div class="btn-row">
        <button class="btn primary" id="open-mail" onclick="ouvrirMailCommande()">Ouvrir dans ma messagerie</button>
        <button class="btn" onclick="telechargerMailCommande()">Télécharger le brouillon .eml</button>
        <button class="btn" onclick="copierMailCommande()">Copier le message</button>
      </div>
      <div class="alert warning" style="margin-top:16px">L’ouverture ou le téléchargement ne prouve pas l’envoi. Envoyez le mail dans votre messagerie, puis confirmez ci-dessous.</div>
      <div class="btn-row"><button class="btn" id="confirm-sent" onclick="confirmerEnvoiCommande()">J’ai envoyé ce mail : marquer comme commandé</button><span id="mail-flash" role="status"></span></div>
    </dialog>
    <dialog id="order-receive" class="order-dialog" aria-labelledby="order-receive-title">
      <div class="dialog-heading"><h2 id="order-receive-title">Réceptionner les articles</h2><button class="btn sm" onclick="document.getElementById('order-receive').close()">Fermer</button></div>
      <p id="receive-description"></p>
      <form id="receive-form">
        <div class="field" style="margin-top:16px"><label for="receive-qty">Quantité reçue maintenant</label><input id="receive-qty" type="number" min="1" step="1" required></div>
        <p id="receive-destination" class="order-note"></p>
        <div class="btn-row"><button class="btn primary" type="submit">Confirmer la réception</button><span id="receive-flash" role="status"></span></div>
      </form>
    </dialog>`);
  document.getElementById('orders-body').addEventListener('change', updateOrderSelection);
  document.getElementById('orders-body').addEventListener('click', event => {
    const button = event.target.closest('button[data-order-action]');
    if (!button) return;
    if (button.dataset.orderAction === 'receive') ouvrirReception(button.dataset.id);
    if (button.dataset.orderAction === 'cancel') confirmerAnnulationFournisseur(button.dataset.id);
  });
  document.getElementById('order-body').addEventListener('input', updateMailLength);
  document.getElementById('order-subject').addEventListener('input', updateMailLength);
  document.getElementById('order-mail').addEventListener('close', () => { preparedOrder = null; });
  document.querySelectorAll('.nav-item').forEach(el => {
    el.tabIndex = 0; el.setAttribute('role', 'button');
    el.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); el.click(); } };
  });
  document.getElementById('storage-warning').hidden = storagePersistent;
  document.getElementById('environment-note').textContent = window.location.origin === 'https://bzak25000.github.io'
    ? 'Commandes stock · Version 2' : 'Aperçu indépendant · Utilisez votre adresse GitHub pour la gestion courante';
  renderCommandes();
}

function renderCommandes() {
  if (!document.getElementById('orders-body')) return;
  const active = commandesStock.filter(c => c.statut !== 'annulee' && remainingOrder(c) > 0);
  const pending = active.filter(isPendingOrder);
  const count = pending.reduce((s,c) => s + remainingOrder(c), 0);
  document.getElementById('orders-pending').textContent = count;
  document.getElementById('orders-sent').textContent = active.filter(c=>c.statut==='commandee').reduce((s,c)=>s+remainingOrder(c),0);
  document.getElementById('orders-clients').textContent = new Set(active.filter(c=>!c.venteAnnulee).map(c=>c.client.trim().toLocaleLowerCase('fr'))).size;
  const badge = document.getElementById('commandes-badge');
  badge.textContent = count; badge.hidden = !count;
  const filter = document.getElementById('orders-filter').value;
  const search = document.getElementById('orders-search').value.trim().toLocaleLowerCase('fr');
  const rows = commandesStock.filter(c =>
    (filter === 'all' || (filter === 'active' ? ['a_commander','commandee'].includes(c.statut) : c.statut === filter)) &&
    [c.produitNom,c.couleur,c.motif,c.taille,c.client,c.venteId,c.reference].join(' ').toLocaleLowerCase('fr').includes(search));
  document.getElementById('orders-body').innerHTML = rows.length ? [...rows].reverse().map(c=>`
    <tr>
      <td>${isPendingOrder(c)?`<input type="checkbox" class="order-check" value="${escapeHtml(c.id)}" aria-label="Commander pour ${escapeHtml(c.client)}, vente ${c.venteId}" checked>`:''}</td>
      <td>#${c.venteId}<br><small>${escapeHtml(c.date)}</small></td>
      <td class="order-details"><strong>${escapeHtml(c.produitNom)}</strong><small>${escapeHtml(c.couleur)} · ${escapeHtml(c.motif)} · ${escapeHtml(c.taille)}</small></td>
      <td class="order-details">${escapeHtml(c.client)}${c.venteAnnulee?'<small style="color:var(--danger)">Vente annulée : suivi fournisseur requis</small>':''}</td>
      <td><strong>${c.qty}</strong></td><td>${c.recue||0} / ${c.qty}</td>
      <td><span class="order-status ${isPendingOrder(c)?'pending':c.statut==='recue'?'received':'sent'}">${orderLabel(c)}</span>${c.reference?`<small style="display:block">${escapeHtml(c.reference)}</small>`:''}</td>
      <td><div class="order-actions">${c.statut==='commandee'&&remainingOrder(c)>0?`<button class="btn sm" data-order-action="receive" data-id="${escapeHtml(c.id)}">Réceptionner</button>${c.venteAnnulee?`<button class="btn sm danger" data-order-action="cancel" data-id="${escapeHtml(c.id)}">Annulation fournisseur</button>`:''}`:''}</div></td>
    </tr>`).join('') : '<tr><td colspan="8"><div class="order-empty"><strong>Aucune commande à afficher</strong>Une vente sans stock suffisant crée automatiquement une ligne ici.<br>Vous pouvez aussi modifier les filtres pour retrouver une commande.</div></td></tr>';
  updateOrderSelection();
}
function selectedOrderRows() {
  const ids = new Set([...document.querySelectorAll('.order-check:checked')].map(el=>el.value));
  return commandesStock.filter(c=>ids.has(c.id) && isPendingOrder(c));
}
function updateOrderSelection() {
  const checks = [...document.querySelectorAll('.order-check')];
  const checked = checks.filter(el=>el.checked);
  const all = document.getElementById('orders-all');
  all.checked = checks.length>0 && checks.length===checked.length;
  all.indeterminate = checked.length>0 && checked.length<checks.length;
  all.disabled = checks.length===0;
  const button = document.getElementById('prepare-order');
  const qty = selectedOrderRows().reduce((s,c)=>s+remainingOrder(c),0);
  button.disabled = !qty;
  button.textContent = qty ? `Préparer le mail (${qty} article${qty>1?'s':''})` : 'Préparer le mail';
}
function selectAllOrders(checked) {
  document.querySelectorAll('.order-check').forEach(el=>el.checked=checked);
  updateOrderSelection();
}
function orderFingerprint(rows) {
  return JSON.stringify(rows.map(c=>[c.id,c.venteId,c.produitNom,c.couleur,c.motif,c.taille,c.client,c.qty,c.recue,c.statut,c.venteAnnulee]));
}
function preparerCommande() {
  const rows = selectedOrderRows();
  if (!rows.length) return;
  const date = new Date();
  const reference = `BZAK-${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}-${crypto.randomUUID().slice(0,8).toUpperCase()}`;
  const qty = rows.reduce((s,c)=>s+remainingOrder(c),0);
  preparedOrder = {ids:rows.map(c=>c.id),fingerprint:orderFingerprint(rows),reference};
  document.getElementById('order-subject').value = `BZAK | Commande ${reference} | ${qty} article(s)`;
  document.getElementById('order-body').value = [
    'Bonjour Justin,','',`Voici notre commande ${reference} pour les articles suivants :`,'',
    ...rows.map((c,i)=>`${i+1}. ${c.produitNom}\n   Couleur : ${c.couleur} | Motif : ${c.motif} | Taille : ${c.taille}\n   Quantité à fournir : ${remainingOrder(c)}\n   Client : ${c.client} | Vente n° ${c.venteId} du ${c.date}`),
    '',`TOTAL : ${qty} article(s), ${rows.length} ligne(s).`,'',
    'Merci de nous confirmer la disponibilité, le délai et le montant de cette commande.',
    'Les noms des clients sont indiqués pour le repérage des articles ; ils ne constituent pas des instructions de livraison.',
    '','Merci,','L’équipe BZAK'
  ].join('\n');
  document.getElementById('order-mail-summary').textContent = `${rows.length} ligne(s) sélectionnée(s) · ${qty} article(s) · The Hive`;
  document.getElementById('mail-flash').textContent = '';
  updateMailLength();
  document.getElementById('order-mail').showModal();
}
function closeOrderMail() { document.getElementById('order-mail').close(); }
function preparedRows() {
  if (!preparedOrder) return null;
  const rows = commandesStock.filter(c=>preparedOrder.ids.includes(c.id));
  if (orderFingerprint(rows) !== preparedOrder.fingerprint) {
    alert('Ces lignes ont changé depuis la préparation. Fermez cet aperçu et préparez à nouveau la commande.');
    return null;
  }
  return rows;
}
function mailFields() {
  return { subject:document.getElementById('order-subject').value.replace(/[\r\n]/g,' ').trim(), body:document.getElementById('order-body').value.trim() };
}
function mailUri() {
  const {subject,body} = mailFields();
  return `mailto:${HIVE_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
function updateMailLength() {
  const long = mailUri().length > 1800;
  document.getElementById('mail-length-warning').textContent = long
    ? 'Message long : téléchargez le brouillon .eml ou copiez le message pour éviter une coupure par votre messagerie.'
    : 'Votre messagerie ouvrira un brouillon. Relisez-le et utilisez son bouton Envoyer lorsque tout est correct.';
}
function validateMail() {
  const fields = mailFields();
  if (!preparedRows()) return false;
  if (!fields.subject || !fields.body) { flash('mail-flash','Objet et message requis.','err'); return false; }
  return true;
}
function ouvrirMailCommande() {
  if (!validateMail()) return;
  if (mailUri().length > 1800 && !confirm('Le message est long et certaines messageries peuvent le tronquer. Le brouillon .eml conserve tout le contenu. Ouvrir tout de même la messagerie ?')) return;
  const anchor = document.createElement('a');
  anchor.href = mailUri(); anchor.target = '_blank'; anchor.rel = 'noopener';
  document.body.append(anchor); anchor.click(); anchor.remove();
  flash('mail-flash','Demande d’ouverture effectuée. Aucun envoi n’est confirmé.','ok');
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function utf8Base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach(b=>binary+=String.fromCharCode(b));
  return btoa(binary);
}
function telechargerMailCommande() {
  if (!validateMail()) return;
  const {subject,body} = mailFields();
  // RFC 2047 : les mots encodés restent sous la limite de 75 caractères.
  const encodedSubject = [...subject].reduce((chunks,char)=>{
    const last = chunks.length-1;
    if (last>=0 && new TextEncoder().encode(chunks[last]+char).length<=42) chunks[last]+=char;
    else chunks.push(char);
    return chunks;
  },[]).map(s=>`=?UTF-8?B?${utf8Base64(s)}?=`).join('\r\n ');
  const eml = [`To: ${HIVE_EMAIL}`,`Subject: ${encodedSubject}`,'X-Unsent: 1','MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',utf8Base64(body.replace(/\r?\n/g,'\r\n')).match(/.{1,76}/g).join('\r\n'),''].join('\r\n');
  downloadBlob(new Blob([eml],{type:'message/rfc822'}),`${preparedOrder.reference}.eml`);
  flash('mail-flash','Brouillon téléchargé, non envoyé.','ok');
}
async function copierMailCommande() {
  if (!validateMail()) return;
  const {subject,body} = mailFields();
  try {
    await navigator.clipboard.writeText(`À : ${HIVE_EMAIL}\nObjet : ${subject}\n\n${body}`);
    flash('mail-flash','Message copié. Collez-le dans votre messagerie.','ok');
  } catch (_) {
    document.getElementById('order-body').focus(); document.getElementById('order-body').select();
    flash('mail-flash','Copie automatique bloquée. Copiez le texte sélectionné.','err');
  }
}
function confirmerEnvoiCommande() {
  if (!validateMail()) return;
  if (!confirm(`Avez-vous réellement envoyé ce mail à ${HIVE_EMAIL} ?\n\nCette confirmation ne transmet aucun mail. Elle marque toutes les lignes sélectionnées comme commandées. Si vous avez retiré un article du message, fermez cet aperçu et corrigez la sélection avant de confirmer.`)) return;
  const rows = preparedRows(); if (!rows) return;
  const fields = mailFields();
  rows.forEach(c=>{c.statut='commandee';c.reference=preparedOrder.reference;c.commandeeAt=new Date().toISOString();c.mailConfirme={destinataire:HIVE_EMAIL,objet:fields.subject,message:fields.body};});
  save();closeOrderMail();renderCommandes();
  flash('orders-flash','Envoi déclaré : lignes marquées comme commandées.','ok');
}
function ouvrirReception(id) {
  const c = commandesStock.find(c=>c.id===id);
  if (!c || c.statut!=='commandee' || !remainingOrder(c)) return;
  const modal = document.getElementById('order-receive');
  document.getElementById('receive-description').textContent = `${c.produitNom} · ${c.couleur} · ${c.motif} · ${c.taille} · Client : ${c.client}`;
  const input = document.getElementById('receive-qty');
  input.max=remainingOrder(c); input.value=remainingOrder(c);
  document.getElementById('receive-destination').textContent = c.venteAnnulee
    ? 'La vente est annulée : les articles reçus seront ajoutés au stock disponible.'
    : 'Ces articles sont réservés à cette vente et ne sont pas ajoutés au stock disponible.';
  document.getElementById('receive-flash').textContent='';
  document.getElementById('receive-form').onsubmit = event => {
    event.preventDefault();
    const qty=Number(input.value);
    if(!Number.isSafeInteger(qty)||qty<1||qty>remainingOrder(c)||c.statut!=='commandee'){
      flash('receive-flash','Quantité invalide ou commande modifiée.','err');return;
    }
    c.recue=(c.recue||0)+qty;
    if(c.venteAnnulee)stock[sKey(c.produitId,c.couleur,c.motif,c.taille)]=getStock(c.produitId,c.couleur,c.motif,c.taille)+qty;
    if(c.recue===c.qty)c.statut='recue';
    c.receptions=c.receptions||[];c.receptions.push({qty,date:new Date().toISOString()});
    save();modal.close();renderCommandes();calcPrix();checkAlerts();
    flash('orders-flash',`${qty} article(s) réceptionné(s).`,'ok');
  };
  modal.showModal();
}
function confirmerAnnulationFournisseur(id) {
  const c=commandesStock.find(c=>c.id===id);
  if(!c || !c.venteAnnulee || c.statut!=='commandee')return;
  if(!confirm(`The Hive a-t-il confirmé l’annulation des ${remainingOrder(c)} article(s) restant(s) ?\nCette action n’envoie aucun message au fournisseur.`))return;
  c.statut='annulee'; c.annuleeAt=new Date().toISOString();save();renderCommandes();
}
function exporterDonnees() {
  downloadBlob(new Blob([JSON.stringify(dbxBuildPayload(),null,2)],{type:'application/json'}),`data-bzak-${new Date().toISOString().slice(0,10)}.json`);
}
function validateData(d) {
  if(!d || !Array.isArray(d.produits) || !Array.isArray(d.ventes) || !d.stock || Array.isArray(d.stock) || typeof d.stock!=='object')throw Error('Format attendu : produits, stock et ventes.');
  if(!d.produits.every(p=>Number.isSafeInteger(p.id)&&typeof p.nom==='string'&&Number.isFinite(p.achat)&&Number.isFinite(p.venteHT)&&['couleurs','motifs','tailles'].every(k=>Array.isArray(p[k])&&p[k].every(v=>typeof v==='string'))))throw Error('Catalogue invalide.');
  if(!Object.values(d.stock).every(v=>Number.isSafeInteger(v)&&v>=0))throw Error('Quantités de stock invalides.');
  if(!d.ventes.every(v=>Number.isSafeInteger(v.id)&&Number.isSafeInteger(v.qty)&&v.qty>0&&['date','client','produitNom','couleur','motif','taille'].every(k=>typeof v[k]==='string')&&['prixHT','prixTTC','caHT','caTTC','marge'].every(k=>Number.isFinite(v[k]))))throw Error('Ventes invalides.');
  if(d.tva!==undefined && (!Number.isFinite(d.tva)||d.tva<0||d.tva>100))throw Error('TVA invalide.');
  if(d.commandesStock!==undefined && (!Array.isArray(d.commandesStock)||!d.commandesStock.every(c=>
    typeof c.id==='string'&&Number.isSafeInteger(c.venteId)&&Number.isSafeInteger(c.produitId)&&
    ['date','client','produitNom','couleur','motif','taille'].every(k=>typeof c[k]==='string')&&
    Number.isSafeInteger(c.qty)&&c.qty>0&&Number.isSafeInteger(c.recue)&&c.recue>=0&&c.recue<=c.qty&&
    ['a_commander','commandee','recue','annulee'].includes(c.statut)
  )))throw Error('Commandes stock invalides.');
  for(const list of [d.produits,d.ventes,d.commandesStock||[]])if(new Set(list.map(x=>x.id)).size!==list.length)throw Error('Identifiants en doublon.');
  return d;
}
async function importerDonnees(input) {
  const file=input.files[0];input.value='';if(!file)return;
  try {
    const data=validateData(JSON.parse(await file.text()));
    if(!confirm(`Remplacer les données actuellement chargées par « ${file.name} » ?\nUne sauvegarde de vos données actuelles sera téléchargée avant le remplacement.${dbxAccessToken?'\nDropbox est connecté : les données importées seront aussi synchronisées.':''}`))return;
    exporterDonnees();
    document.getElementById('order-mail').close();document.getElementById('order-receive').close();
    // Un import explicite remplace le jeu complet, contrairement à une synchronisation ancienne.
    dbxApplyRemoteData({...data,commandesStock:data.commandesStock||[]});
    save();renderMetrics();checkAlerts();renderCommandes();
    alert('Données importées avec succès.');
  } catch(error) { alert(`Import impossible : ${error.message}`); }
}
