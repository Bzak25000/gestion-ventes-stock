// UI-only state. Never reads or writes sales, stock, storage or Dropbox.
let stockNavigationObserver;
function activeStockMatrix(card){
  return [...card.querySelectorAll('[data-stock-panel]')].find(p=>p.style.display!=='none')?.querySelector('.matrix-wrap');
}
function memoriserNavigationStock(){
  return [...document.querySelectorAll('[data-stock-product]')].map(card=>({
    id:card.dataset.stockProduct,
    active:[...card.querySelectorAll('[data-stock-panel]')].find(p=>p.style.display!=='none')?.id,
    size:card.querySelector('[data-stock-size]')?.value||'',
    scroll:[...card.querySelectorAll('[data-stock-panel]')].map(p=>{
      const wrap=p.querySelector('.matrix-wrap');
      return [p.id,p.style.display==='none'?Number(wrap.dataset.restoreScroll||0):wrap.scrollLeft];
    })
  }));
}
function actualiserNavigationStock(card){
  const wrap=activeStockMatrix(card);if(!wrap)return;
  const max=Math.max(0,wrap.scrollWidth-wrap.clientWidth);
  card.querySelector('[data-stock-left]').disabled=wrap.scrollLeft<=1;
  card.querySelector('[data-stock-right]').disabled=wrap.scrollLeft>=max-1;
}
function naviguerStock(button,direction){
  const card=button.closest('.stock-card'),wrap=activeStockMatrix(card);
  if(!wrap)return;
  const frozen=wrap.querySelector('.row-th').getBoundingClientRect().width;
  wrap.scrollBy({left:direction*Math.max(82,wrap.clientWidth-frozen-16),behavior:'instant'});
  card.querySelector('[data-stock-size]').value='';
  actualiserNavigationStock(card);
}
function allerTailleStock(select){
  if(!select.value)return;
  const card=select.closest('.stock-card'),wrap=activeStockMatrix(card);
  const th=[...wrap.querySelectorAll('thead th')].find(th=>th.dataset.stockSize===select.value);
  if(!th)return;
  const frozen=wrap.querySelector('.row-th').getBoundingClientRect().width;
  const left=wrap.scrollLeft+th.getBoundingClientRect().left-wrap.getBoundingClientRect().left-frozen-8;
  wrap.scrollTo({left:Math.max(0,left),behavior:'instant'});
  actualiserNavigationStock(card);
}
function restaurerNavigationStock(states=[]){
  stockNavigationObserver?.disconnect();
  stockNavigationObserver=new ResizeObserver(entries=>{
    for(const entry of entries)actualiserNavigationStock(entry.target.closest('.stock-card'));
  });
  document.querySelectorAll('[data-stock-product]').forEach(card=>{
    const state=states.find(s=>s.id===card.dataset.stockProduct);
    const panels=[...card.querySelectorAll('[data-stock-panel]')];
    if(state&&panels.some(p=>p.id===state.active)){
      panels.forEach((p,i)=>{
        p.style.display=p.id===state.active?'block':'none';
        card.querySelectorAll('.stock-tab')[i].classList.toggle('active',p.id===state.active);
      });
      card.querySelector('[data-stock-size]').value=state.size;
    }
    panels.forEach(p=>{
      const wrap=p.querySelector('.matrix-wrap');
      // Hidden panels restore their offset when switched into view.
      wrap.dataset.restoreScroll=String(state?.scroll.find(([id])=>id===p.id)?.[1]||0);
      if(p.style.display!=='none')wrap.scrollLeft=Number(wrap.dataset.restoreScroll);
      wrap.addEventListener('scroll',()=>{
        wrap.dataset.restoreScroll=String(wrap.scrollLeft);
        actualiserNavigationStock(card);
      },{passive:true});
      wrap.addEventListener('keydown',event=>{
        if(event.target!==wrap)return; // Never intercept number input keys.
        if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
          event.preventDefault();naviguerStock(card.querySelector('[data-stock-left]'),event.key==='ArrowLeft'?-1:1);
        }
      });
      stockNavigationObserver.observe(wrap);
    });
    actualiserNavigationStock(card);
  });
}
function afficherNavigationMotif(card){
  const wrap=activeStockMatrix(card);if(!wrap)return;
  wrap.scrollLeft=Number(wrap.dataset.restoreScroll||0);
  const select=card.querySelector('[data-stock-size]');
  if(select.value)allerTailleStock(select);
  actualiserNavigationStock(card);
}
