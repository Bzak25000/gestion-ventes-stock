const TAILLES_TEXTILES = ['XXS','XS','S','M','L','XL','XXL','3XL'];

// Mise à niveau du catalogue uniquement. Aucun effacement, import, recalcul de vente
// ou mouvement de stock ; les tailles historiques et particulières restent intactes.
function etendreTaillesTextiles(){
  for(const p of produits){
    if(p.gammeTextileVersion===1)continue;
    const nom=String(p.nom||'').toLocaleLowerCase('fr');
    const accessoire=/casquette|snapback|trucker|sac|(?:tot|tote)\s*bag/.test(nom);
    const textile=!accessoire&&(
      (p.tailles||[]).some(t=>TAILLES_TEXTILES.includes(t))||
      /t[\s-]?shirt|sweat|hoodie|polo|pull|veste|pantalon|short|chemise|débardeur/.test(nom)
    );
    if(!textile)continue;
    p.tailles=[...TAILLES_TEXTILES,...(p.tailles||[]).filter(t=>!TAILLES_TEXTILES.includes(t))];
    p.gammeTextileVersion=1;
  }
}
