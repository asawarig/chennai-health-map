#!/usr/bin/env node
/* Makes the share card, public/og-be-well-chennai.jpg (1200 × 630): the map of
 * Chennai, softly blurred, with the Plum logo, "Be Well, Chennai" and
 * "ft. Plum Perks" over it — the same card the earlier maps had, made from
 * this map rather than a screenshot of another city.
 *
 *   npm run dev                      # in another terminal
 *   node scripts/og-image.mjs [http://localhost:4321/] [lon,lat,zoom]
 *
 * It opens the map in headless Chrome, hides every panel, frames the coast
 * at Marina and Mylapore (or the view given), and photographs the map; then
 * lays the card out as a page and photographs that. The lettering is the
 * long logo (public/be-well-logo-long.svg) and the line under it is set in
 * Grenette Pro, both as the site uses them, so the card matches the page.
 *
 * Needs Google Chrome installed in the usual place on a Mac (CHROME= overrides),
 * and the dev server, since the view is set through the dev-only map handle.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_ = process.argv[2] || 'http://localhost:4321/';
const [LON, LAT, ZOOM] = (process.argv[3] || '80.2705,13.0418,13.9').split(',').map(Number);
const OUT = path.join(ROOT, 'public', 'og-be-well-chennai.jpg');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = 1200, H = 630;
const PORT = 9300 + Math.floor(Math.random() * 600);
const profile = mkdtempSync(path.join(tmpdir(), 'og-image-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  `--window-size=${W},${H}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });

let ws, id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve) => {
  const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params }));
});
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const b64 = (file) => readFileSync(path.join(ROOT, file)).toString('base64');

try {
  for (let i = 0; i < 50 && !ws; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page');
      if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
    } catch { /* not up yet */ }
    if (!ws) await sleep(200);
  }
  if (!ws) throw new Error('Chrome did not start');
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

  /* 1. The map, on its own. */
  await send('Page.navigate', { url: URL_ });
  await sleep(500);
  for (let i = 0; i < 120; i++) {
    if (await evaluate(`!!window.wellnessMap && document.getElementById('frame')?.classList.contains('is-ready')`)) break;
    await sleep(250);
  }
  if (!(await evaluate('!!window.wellnessMap'))) throw new Error('No map handle: run this against the dev server');
  await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Show me');b&&b.click()})()`);
  await sleep(2500);
  /* Everything but the map out of the picture; the map fills the window. */
  await evaluate(`(()=>{const s=document.createElement('style');
    s.textContent='body *{visibility:hidden!important} #map,#map *{visibility:visible!important} #map{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:9999} .maplibregl-control-container{display:none!important}';
    document.head.append(s);})()`);
  await evaluate(`new Promise((done)=>{const m=window.wellnessMap;m.resize();m.setMaxBounds(null);m.setMinZoom(5);
    m.jumpTo({center:[${LON},${LAT}],zoom:${ZOOM}});m.once('idle',()=>done(true));setTimeout(()=>done(false),20000)})`);
  await sleep(1500);
  const mapShot = (await send('Page.captureScreenshot', { format: 'png' })).result.data;

  /* 2. The card, laid out as a page and photographed. */
  const html = `<!doctype html><meta charset="utf-8"><style>
    @font-face{font-family:'Grenette Pro';src:url(data:font/woff2;base64,${b64('src/fonts/GrenettePro-Regular.woff2')}) format('woff2')}
    html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#EDEBE6}
    .map{position:absolute;inset:-24px;background:url(data:image/png;base64,${mapShot}) center/cover;filter:blur(5px) saturate(.9)}
    .veil{position:absolute;inset:0;background:rgba(250,248,244,.32)}
    .plum{position:absolute;left:50%;top:62px;transform:translateX(-50%);width:128px}
    .lettering{position:absolute;left:50%;top:212px;transform:translateX(-50%);width:520px}
    .ft{position:absolute;right:340px;top:494px;font:400 32px/1 'Grenette Pro',Georgia,serif;color:#491236;letter-spacing:.2px}
  </style>
  <div class="map"></div><div class="veil"></div>
  <img class="plum" src="data:image/svg+xml;base64,${b64('public/plum-logo.svg')}">
  <img class="lettering" src="data:image/svg+xml;base64,${b64('public/be-well-logo-long.svg')}">
  <div class="ft">ft. Plum Perks</div>`;
  const pageFile = path.join(profile, 'card.html');
  writeFileSync(pageFile, html);
  await send('Page.navigate', { url: `file://${pageFile}` });
  await sleep(800);
  await evaluate('document.fonts.ready.then(()=>true)');
  await sleep(300);
  const card = Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64');
  await sharp(card).resize(W, H).jpeg({ quality: 86, mozjpeg: true }).toFile(OUT);
  console.log(`Wrote ${path.relative(process.cwd(), OUT)} (${W}×${H}), map at ${LON},${LAT} z${ZOOM}`);
} finally {
  ws?.close();
  chrome.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold it */ }
}
