// One analytic short hop. Values are continuous at each phase boundary.
(function(root){
 function sampleHop(t){
  if(!Number.isFinite(t)||t<0||t>=0.60)return {hop:0,squash:0,done:true};
  if(t<0.10)return {hop:0,squash:-0.022*Math.sin(Math.PI*t/0.10),done:false};
  if(t<0.48){const u=(t-0.10)/0.38;return {hop:26*Math.sin(Math.PI*u),squash:0.012*Math.sin(2*Math.PI*u),done:false};}
  return {hop:0,squash:-0.018*Math.sin(Math.PI*(t-0.48)/0.12),done:false};
 }
 const api={sampleHop};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.HopMotion=api;
})(typeof window!=='undefined'?window:globalThis);
