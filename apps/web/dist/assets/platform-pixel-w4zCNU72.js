import{c as r,g as c}from"./index-BQ0BLMey.js";import{a as s}from"./query-Yz5d6HRD.js";/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const p=r("ChartLine",[["path",{d:"M3 3v16a2 2 0 0 0 2 2h16",key:"c24i48"}],["path",{d:"m19 9-5 5-4-4-3 3",key:"2osh9i"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const f=r("Lock",[["rect",{width:"18",height:"11",x:"3",y:"11",rx:"2",ry:"2",key:"1w4ew1"}],["path",{d:"M7 11V7a5 5 0 0 1 10 0v4",key:"fwvmzm"}]]);let o="idle";const h=()=>o==="loaded";function d(t){const e=new URL(t.script).origin;for(const a of[e,"https://connect.facebook.net"]){const i=document.createElement("link");i.rel="preconnect",i.href=a,a===e&&(i.crossOrigin="anonymous"),document.head.appendChild(i)}const n=document.createElement("script");n.async=!0,n.crossOrigin="anonymous",n.src=t.script,n.setAttribute("data-key",t.key),n.setAttribute("data-pixel-id",t.pixelId),n.setAttribute("data-endpoint",t.endpoint),n.setAttribute("data-currency",t.currency),n.setAttribute("data-country",t.country),n.setAttribute("data-auto-config","0"),document.head.appendChild(n)}function m(){s.useEffect(()=>{var t;if(o==="loaded"){(t=window.tracker)==null||t.track("page_view");return}o==="idle"&&(o="loading",c("/v1/public/tracking").then(e=>{if(!(e!=null&&e.pixel)){o=e!=null&&e.signedIn?"idle":"off";return}d(e.pixel),o="loaded"}).catch(()=>{o="idle"}))},[])}function y(){try{const t=JSON.parse(localStorage.getItem("pt_utms")??"null");return t&&typeof t=="object"?t:void 0}catch{return}}export{p as C,f as L,h as p,y as s,m as u};
