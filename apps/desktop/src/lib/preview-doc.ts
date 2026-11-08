/**
 * Builds the standalone documents shown in the sandboxed preview iframe and
 * validates the console messages those documents send back.
 *
 * Isolation does not depend on this file: the iframe is sandboxed without
 * `allow-same-origin` (opaque origin, no access to the app, its storage or the
 * Tauri IPC) and, in the desktop app, is served from its own `preview:` scheme
 * with the CSP below as a response header. The meta tag repeats the policy for
 * the browser/srcdoc path.
 */

import { parsePlanStorage, type PlanStorage } from './repo-plans';

/** Keep in sync with PREVIEW_CSP in src-tauri/src/preview.rs (a test enforces it). */
export const PREVIEW_CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https:; style-src 'unsafe-inline' https:; img-src data: blob: https:; font-src data: https:; media-src data: blob: https:; connect-src 'none'; form-action 'none'; base-uri 'none'";

export const CONSOLE_SOURCE = 'command-center-preview';

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface ConsoleEntry {
  level: ConsoleLevel;
  text: string;
  at: number;
}

const LEVELS: ReadonlySet<string> = new Set<ConsoleLevel>([
  'log',
  'info',
  'warn',
  'error',
  'debug',
]);
const MAX_TEXT = 4000;

/** Accepts only well-formed messages that belong to the frame we expect. */
export function parseConsoleMessage(
  data: unknown,
  expectedId: string,
  now = Date.now(),
): ConsoleEntry | null {
  if (typeof data !== 'object' || data === null) return null;
  const m = data as Record<string, unknown>;
  if (m.source !== CONSOLE_SOURCE || m.id !== expectedId) return null;
  if (typeof m.level !== 'string' || !LEVELS.has(m.level) || typeof m.text !== 'string')
    return null;
  return { level: m.level as ConsoleLevel, text: m.text.slice(0, MAX_TEXT), at: now };
}

/** Runs first inside the preview. Forwards console output and uncaught errors to the parent. */
function hookScript(frameId: string): string {
  const id = JSON.stringify(frameId).replace(/</g, '\\u003c');
  return `(function(){
var ID=${id},MAX=${MAX_TEXT};
function fmt(v){
  if(typeof v==='string')return v;
  if(v instanceof Error)return v.stack||v.name+': '+v.message;
  if(typeof v==='undefined')return 'undefined';
  if(typeof v==='function')return String(v);
  try{var seen=[];return JSON.stringify(v,function(k,x){if(typeof x==='object'&&x!==null){if(seen.indexOf(x)>-1)return '[Circular]';seen.push(x);}return typeof x==='bigint'?String(x)+'n':x;},2);}catch(e){return String(v);}
}
function send(level,args){
  try{var t=args.map(fmt).join(' ');parent.postMessage({source:${JSON.stringify(CONSOLE_SOURCE)},id:ID,level:level,text:t.length>MAX?t.slice(0,MAX)+'...':t},'*');}catch(e){}
}
['log','info','warn','error','debug'].forEach(function(l){
  var orig=console[l];
  console[l]=function(){send(l,Array.prototype.slice.call(arguments));if(orig)orig.apply(console,arguments);};
});
addEventListener('error',function(e){send('error',[(e.message||'Error')+(e.lineno?' (line '+e.lineno+')':'')]);});
addEventListener('unhandledrejection',function(e){send('error',['Unhandled promise rejection: '+fmt(e.reason)]);});
})();`;
}

export const PLAN_STORAGE_SOURCE = 'command-center-plan-storage';

/** A plan page's storage snapshot, accepted only from the frame we expect. */
export function parsePlanStorageMessage(data: unknown, expectedId: string): PlanStorage | null {
  if (typeof data !== 'object' || data === null) return null;
  const m = data as Record<string, unknown>;
  if (m.source !== PLAN_STORAGE_SOURCE || m.id !== expectedId) return null;
  return parsePlanStorage(m.items);
}

/** Whether a message is a storage snapshot from this frame at all, accepted or not. */
export function isOwnStorageMessage(data: unknown, expectedId: string): boolean {
  if (typeof data !== 'object' || data === null) return false;
  const m = data as Record<string, unknown>;
  return m.source === PLAN_STORAGE_SOURCE && m.id === expectedId;
}

/**
 * Runs before a plan's own scripts. The sandbox has an opaque origin, so the real localStorage
 * throws; this puts an in-memory one in its place, seeded with what the app saved, and sends
 * every change up for the app to keep.
 * shortcut: only the Storage methods work (`localStorage.x = 1` is not saved, and
 * `Object.keys(localStorage)` lists the methods), and a page that reloads itself starts again
 * from what was saved when the plan opened; fine for plans made as artifacts, which use
 * getItem/setItem and do not reload. Upgrade if a plan needs either.
 */
function storageScript(frameId: string, items: PlanStorage): string {
  const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');
  // Seeded through JSON.parse, so a saved key named __proto__ stays an ordinary key.
  return `(function(){
var ID=${json(frameId)},S=Object.create(null),init=JSON.parse(${json(JSON.stringify(items))});
for(var k in init)S[k]=init[k];
function save(){try{parent.postMessage({source:${json(PLAN_STORAGE_SOURCE)},id:ID,items:Object.assign({},S)},'*');}catch(e){}}
var store={
getItem:function(k){k=String(k);return k in S?S[k]:null;},
setItem:function(k,v){S[String(k)]=String(v);save();},
removeItem:function(k){delete S[String(k)];save();},
clear:function(){for(var k in S)delete S[k];save();},
key:function(i){var ks=Object.keys(S);return i>=0&&i<ks.length?ks[i]:null;},
get length(){return Object.keys(S).length;}
};
try{Object.defineProperty(window,'localStorage',{value:store,configurable:true});}catch(e){console.warn('Command Center could not keep this plan\\'s progress: '+e);}
})();`;
}

const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;

const FRAGMENT_STYLE =
  ':root{color-scheme:light}body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:16px;line-height:1.5}';

function injection(frameId: string, storage?: PlanStorage): string {
  // `</script` inside the hook would end it early; the dynamic parts (the id, the storage) are escaped above.
  const store = storage ? `<script>${storageScript(frameId, storage)}</script>` : '';
  return `${cspMeta}<script>${hookScript(frameId)}</script>${store}`;
}

/**
 * Wraps untrusted HTML. Full documents keep their structure; fragments get a minimal page around them.
 * With `storage` (business plans), the page gets a localStorage that the app keeps for it.
 */
export function buildHtmlDocument(source: string, frameId: string, storage?: PlanStorage): string {
  const head = /<head(\s[^>]*)?>/i.exec(source);
  if (head)
    return (
      source.slice(0, head.index + head[0].length) +
      injection(frameId, storage) +
      source.slice(head.index + head[0].length)
    );
  const html = /<html(\s[^>]*)?>/i.exec(source);
  if (html) {
    const at = html.index + html[0].length;
    return `${source.slice(0, at)}<head>${injection(frameId, storage)}</head>${source.slice(at)}`;
  }
  if (/<!doctype/i.test(source)) {
    const at = source.search(/>/) + 1;
    return `${source.slice(0, at)}<head>${injection(frameId, storage)}</head>${source.slice(at)}`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${injection(frameId, storage)}<style>${FRAGMENT_STYLE}</style></head><body>${source}</body></html>`;
}

/** Centers an SVG (or the SVG a diagram renders to) on a background that matches the app theme. */
export function buildSvgDocument(svg: string, frameId: string, theme: 'dark' | 'light'): string {
  const bare = svg.replace(/^\s*<\?xml[^>]*\?>/i, '').replace(/^\s*<!doctype[^>]*>/i, '');
  const bg = theme === 'dark' ? '#111114' : '#ffffff';
  const style = `html,body{margin:0;height:100%;background:${bg}}body{display:grid;place-items:center;padding:16px;box-sizing:border-box}svg{max-width:100%;max-height:100%;height:auto}`;
  return `<!doctype html><html><head><meta charset="utf-8">${injection(frameId)}<style>${style}</style></head><body>${bare}</body></html>`;
}
