// Small always-reachable toolbar; pointer tracking only controls hit-through, never gaze.
(function(root){
 function create(host,doc,pet,hit,activity){
  const bar=doc.createElement('nav');bar.id='pet-controls';bar.dataset.petUi='1';bar.setAttribute('aria-label','白姐桌宠工具条');
  function button(id,text,title){const b=doc.createElement('button');b.id=id;b.type='button';b.textContent=text;b.title=title;b.setAttribute('aria-label',title);bar.appendChild(b);return b;}
  const grip=button('pet-grip','搬动','按住这里搬动白姐');
  button('pet-smaller','−','缩小（缩放：Ctrl+滚轮）').onclick=()=>{activity();pet.resizeBy(1/1.05);};
  button('pet-larger','+','放大（缩放：Ctrl+滚轮）').onclick=()=>{activity();pet.resizeBy(1.05);};
  button('pet-menu','⋮','打开菜单').onclick=()=>{activity();pet.menu();};
  doc.body.appendChild(bar);
  let point=null,held=false,interactive=null;
  function tick(){
   const target=point?doc.elementFromPoint(point.x,point.y):null;
   const next=held||!!(point&&(bar.contains(target)||hit(point.x,point.y)));
   if(next!==interactive){interactive=next;pet.setInteractive(next);}
  }
  host.addEventListener('mousemove',e=>{point=Number.isFinite(e.clientX)&&Number.isFinite(e.clientY)?{x:e.clientX,y:e.clientY}:null;tick();});
  host.addEventListener('mouseleave',()=>{point=null;tick();});
  host.addEventListener('wheel',e=>{
   if(held||e.ctrlKey!==true||e.altKey||e.metaKey||e.shiftKey||(e.buttons!==undefined&&e.buttons!==0)
    ||!Number.isFinite(e.deltaY)||e.deltaY===0)return;
   if(e.deltaMode!==undefined&&![0,1,2].includes(e.deltaMode))return;
   if(!Number.isFinite(host.innerWidth)||host.innerWidth<=0||!Number.isFinite(host.innerHeight)||host.innerHeight<=0
    ||!Number.isFinite(e.clientX)||!Number.isFinite(e.clientY)
    ||e.clientX<0||e.clientY<0||e.clientX>host.innerWidth||e.clientY>host.innerHeight)return;
   const onBar=bar.contains(e.target);
   if(!onBar&&!hit(e.clientX,e.clientY))return;
   e.preventDefault();activity();
   const unit=e.deltaMode===1?16:e.deltaMode===2?host.innerHeight:1;
   const factor=Math.max(0.8,Math.min(1.25,Math.exp(Math.max(-1000,Math.min(1000,-e.deltaY*unit))*0.0012)));
   // Controls are fixed-size and top-centered; the character scales with the window.
   pet.resizeBy(factor,onBar?{x:.5,y:0}:{x:e.clientX/host.innerWidth,y:e.clientY/host.innerHeight});
  },{passive:false});
  return {tick,isUI:e=>bar.contains(e.target),isGrip:e=>e.target===grip,
   setHeld:on=>{held=!!on;tick();},snapshot:()=>({held,interactive,pointer:point?{...point}:null})};
 }
 const api={create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DesktopUI=api;
})(typeof window!=='undefined'?window:globalThis);
