// Scan a project website for token info (name, symbol, description, X, Telegram).
// Standalone: not used by the launch flow yet. GET /api/scan-site?url=https://...
import { lookup } from 'node:dns/promises';
import net from 'node:net';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 8000;
const MAX_BYTES = 2_000_000;   // per file
const MAX_SCRIPTS = 6;

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

async function assertPublicUrl(u) {
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http/https');
  const addrs = await lookup(u.hostname, { all: true });
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) throw new Error('Blocked host');
}

async function fetchText(url, depth = 0) {
  const u = new URL(url);
  await assertPublicUrl(u);
  const r = await fetch(u, {
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; CheckFeeScanner/1.0)', accept: '*/*' },
  });
  if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
    if (depth >= 3) throw new Error('Too many redirects');
    return fetchText(new URL(r.headers.get('location'), u).href, depth + 1);
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const reader = r.body.getReader();
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) { reader.cancel(); break; }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks).toString('utf8'), finalUrl: u.href };
}

const decode = s => s
  ?.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
  .replace(/\s+/g, ' ').trim() || null;

function meta(html, key) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  return tag ? decode(tag.match(/content=["']([^"']*)["']/i)?.[1]) : null;
}

const X_SKIP = /^(intent|share|home|search|i|hashtag|login|signup|explore|settings|tos|privacy|x|twitter)$/i;
const TG_SKIP = /^(share|joinchat|addstickers|proxy|s|iv)$/i;

function findX(text) {
  const counts = {};
  for (const m of text.matchAll(/(?:https?:)?\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/@?([A-Za-z0-9_]{1,15})(?![A-Za-z0-9_])/g)) {
    if (!X_SKIP.test(m[1])) counts[m[1]] = (counts[m[1]] || 0) + 1;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  return best ? `https://x.com/${best}` : null;
}

function findTelegram(text) {
  const counts = {};
  for (const m of text.matchAll(/(?:https?:)?\/\/(?:t\.me|telegram\.me)\/(\+?[A-Za-z0-9_]{4,64})/g)) {
    if (!TG_SKIP.test(m[1])) counts[m[1]] = (counts[m[1]] || 0) + 1;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  return best ? `https://t.me/${best}` : null;
}

function findSymbol(text) {
  const counts = {};
  for (const m of text.matchAll(/(?:^|[\s>"'(])\$([A-Z][A-Z0-9]{1,9})(?![A-Za-z0-9])/g)) {
    if (!/^(USD|ETH|BTC|USDC|USDT|SOL)$/.test(m[1])) counts[m[1]] = (counts[m[1]] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

// Read a key from a JS/JSON config object: key:"value" or key:IDENT (resolved via IDENT="value")
function cfgVal(js, keys, near = null, range = 600) {
  for (const k of keys) {
    const re = new RegExp(`["']?\\b${k}["']?\\s*:\\s*(?:"([^"\\n]{1,200})"|'([^'\\n]{1,200})'|([A-Za-z_$][\\w$]{0,30})\\b)`, 'g');
    for (const m of js.matchAll(re)) {
      if (near != null && Math.abs(m.index - near) > range) continue;
      let v = m[1] ?? m[2];
      if (v == null && m[3] && !/^(true|false|null|void|undefined|function|new|this)$/.test(m[3])) {
        const id = m[3].replace(/\$/g, '\\$');
        v = js.match(new RegExp(`(?:^|[^\\w$.])${id}\\s*=\\s*(?:"([^"\\n]{1,200})"|'([^'\\n]{1,200})')`))?.slice(1).find(x => x != null);
      }
      if (v && v.trim()) return { v: v.trim(), at: m.index };
    }
  }
  return null;
}

function scanConfig(js) {
  const name = cfgVal(js, ['tokenName', 'token_name', 'coinName']);
  const near = name?.at ?? null;
  const symbol = cfgVal(js, ['tokenSymbol', 'token_symbol', 'ticker'], near) ||
    (near != null ? cfgVal(js, ['symbol'], near, 300) : null);
  return { name: name?.v || null, symbol: /^[A-Za-z0-9]{2,16}$/.test(symbol?.v || '') ? symbol.v.toUpperCase() : null };
}

const cleanName =s => s ? s.split(/\s+[|\-–—:•]\s+/)[0].replace(/\(\$?[A-Z0-9]{2,10}\)/, '').trim() || null : null;

export async function GET(req) {
  const raw = new URL(req.url).searchParams.get('url')?.trim();
  if (!raw) return Response.json({ error: 'Missing url' }, { status: 400 });
  let target;
  try { target = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); }
  catch { return Response.json({ error: 'Invalid url' }, { status: 400 }); }

  let html, base;
  try { ({ text: html, finalUrl: base } = await fetchText(target.href)); }
  catch (e) { return Response.json({ error: `Cannot load site: ${e.message}` }, { status: 422 }); }

  // 1) HTML meta
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const ogTitle = meta(html, 'og:title') || meta(html, 'twitter:title');
  const desc = meta(html, 'og:description') || meta(html, 'description') || meta(html, 'twitter:description');
  const twSite = meta(html, 'twitter:site') || meta(html, 'twitter:creator');

  // 2) manifest
  let manifest = null;
  const mHref = html.match(/<link[^>]+rel=["']manifest["'][^>]*>/i)?.[0]?.match(/href=["']([^"']+)["']/i)?.[1];
  for (const p of [mHref, '/manifest.json', '/site.webmanifest'].filter(Boolean)) {
    try { manifest = JSON.parse((await fetchText(new URL(p, base).href)).text); break; } catch {}
  }

  // 3) JS bundles (same-origin only, for SPA sites)
  let corpus = html;
  const origin = new URL(base).origin;
  const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)]
    .map(m => { try { return new URL(m[1], base).href; } catch { return null; } })
    .filter(s => s && s.startsWith(origin)).slice(0, MAX_SCRIPTS);
  const jsTexts = await Promise.all(scripts.map(s => fetchText(s).then(r => r.text).catch(() => '')));
  const htmlX = findX(html), htmlTg = findTelegram(html);
  corpus += '\n' + jsTexts.join('\n');

  const twHandle = twSite?.replace(/^@/, '');
  const cfg = scanConfig(corpus);
  const result = {
    name: cfg.name || cleanName(ogTitle) || manifest?.name || cleanName(title),
    symbol: cfg.symbol || findSymbol(html) || findSymbol(corpus) ||
      (/^[A-Z0-9]{2,10}$/.test(manifest?.short_name || '') ? manifest.short_name : null),
    description: desc || manifest?.description || null,
    // real links on the site beat the twitter:site meta tag
    x: htmlX || findX(corpus) || (twHandle && !X_SKIP.test(twHandle) ? `https://x.com/${twHandle}` : null),
    telegram: htmlTg || findTelegram(corpus),
    website: base,
  };
  return Response.json(result);
}
