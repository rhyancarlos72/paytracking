import{c,g as r}from"./index-hOTWjZv6.js";import{a as s}from"./query-Yz5d6HRD.js";/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const p=c("ChartLine",[["path",{d:"M3 3v16a2 2 0 0 0 2 2h16",key:"c24i48"}],["path",{d:"m19 9-5 5-4-4-3 3",key:"2osh9i"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const f=c("Lock",[["rect",{width:"18",height:"11",x:"3",y:"11",rx:"2",ry:"2",key:"1w4ew1"}],["path",{d:"M7 11V7a5 5 0 0 1 10 0v4",key:"fwvmzm"}]]);let a="idle";const h=()=>a==="loaded";function d(t){const i=new URL(t.script).origin;for(const o of[i,"https://connect.facebook.net"]){const n=document.createElement("link");n.rel="preconnect",n.href=o,o===i&&(n.crossOrigin="anonymous"),document.head.appendChild(n)}const e=document.createElement("script");e.async=!0,e.crossOrigin="anonymous",e.src=t.script,e.setAttribute("data-key",t.key),e.setAttribute("data-pixel-id",t.pixelId),e.setAttribute("data-endpoint",t.endpoint),e.setAttribute("data-currency",t.currency),e.setAttribute("data-country",t.country),t.ic&&(e.setAttribute("data-ic-click",t.ic.click),e.setAttribute("data-ic-rule",t.ic.rule),e.setAttribute("data-ic-value",t.ic.value)),e.setAttribute("data-auto-config","0"),document.head.appendChild(e)}function m(){s.useEffect(()=>{var t;if(a==="loaded"){(t=window.tracker)==null||t.track("page_view");return}a==="idle"&&(a="loading",r("/v1/public/tracking").then(i=>{if(!(i!=null&&i.pixel)){a=i!=null&&i.signedIn?"idle":"off";return}d(i.pixel),a="loaded"}).catch(()=>{a="idle"}))},[])}function y(){try{const t=JSON.parse(localStorage.getItem("pt_utms")??"null");return t&&typeof t=="object"?t:void 0}catch{return}}export{p as C,f as L,h as p,y as s,m as u};
