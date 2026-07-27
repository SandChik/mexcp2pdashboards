import { JSDOM } from 'jsdom';
import fs from 'fs';
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',
  { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only' });
const w = dom.window;
if (!w.matchMedia) w.matchMedia = q => ({ matches:false, media:q, addEventListener(){}, removeEventListener(){} });
w.localStorage.setItem('token', 'fake-token-for-smoke-test');
w.fetch = async () => ({ ok:true, json: async () => ({ version:'test' }) });

// Canned API so every page renders with data instead of dying on undefined.
const reply = (url) => {
  if (url.includes('/api/merchants') && url.endsWith('/settings')) return { buyerLog:true, autoReplyEnabled:true, quickReplies:[], autoReplyRules:[] };
  if (url.includes('/api/merchants/') && url.includes('/pause')) return { ads: [] };
  if (url.includes('/api/merchants')) return [{ id:'m1', name:'Test Merchant' }];
  if (url.includes('/api/orders') && url.includes('member-ids')) return { map:{} };
  if (url.includes('/api/orders')) return { code:0, data:[] };
  if (url.includes('/api/ads')) return { code:0, data:[] };
  if (url.includes('/api/registry')) return { records:[], nameIndex:{} };
  if (url.includes('/api/auth')) return { ok:true };
  return {};
};
class FakeXHR {
  constructor(){ this.readyState=0; this.status=200; this.headers={}; }
  open(m,u){ this._u=u; this.readyState=1; }
  setRequestHeader(){} getAllResponseHeaders(){ return ''; } abort(){}
  addEventListener(t,f){ if(t==='load') this._load=f; }
  send(){
    this.readyState=4; this.status=200;
    this.responseText = JSON.stringify(reply(this._u||''));
    this.response = this.responseText;
    setTimeout(()=>{ this.onreadystatechange && this.onreadystatechange(); this.onload && this.onload(); this._load && this._load(); },0);
  }
}
w.XMLHttpRequest = FakeXHR;

const errs = [];
w.console.error = (...a) => errs.push(a.map(x => (x&&x.stack)?x.stack:String(x)).join(' '));
w.eval(fs.readFileSync('/tmp/app.iife.js','utf8'));
await new Promise(r=>setTimeout(r,500));

const routes = ['/', '/queue', '/uu', '/ftd', '/buyers', '/settings'];
let bad = 0;
for (const route of routes) {
  w.history.pushState({}, '', route);
  w.dispatchEvent(new w.PopStateEvent('popstate'));
  await new Promise(r=>setTimeout(r,450));
  const html = w.document.getElementById('root').innerHTML;
  const crashed = html.includes('Terjadi kesalahan di tampilan');
  const blank = html.length === 0;
  const ok = !crashed && !blank;
  if (!ok) bad++;
  console.log(`${ok ? 'OK  ' : 'GAGAL'} ${route.padEnd(10)} ${blank ? 'BLANK' : (crashed ? 'CRASH → ' + (html.match(/<pre[^>]*>([^<]{0,90})/)?.[1]||'').trim() : html.length + ' char')}`);
}
console.log(bad ? `\n${bad} halaman bermasalah` : '\nSemua halaman render tanpa crash');

// Exit code is what the CI gate actually reads — printing "GAGAL" is not enough.
process.exit(bad ? 1 : 0);
