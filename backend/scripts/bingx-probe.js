#!/usr/bin/env node
/**
 * bingx-probe.js — Fase 0, versi 3.
 *
 * v3 (8 Sep 2026): urutan uji POST diubah — hasil v2 menunjukkan endpoint P2P
 * membaca parameter dari body JSON dan mengambil timestamp dari body juga,
 * sesuai pedoman resmi BingX (api-ai-skills, "JSON Request Body"): timestamp
 * dan signature ikut DI DALAM JSON, bukan di query string.
 *
 * Perubahan dari v1 (hasil uji 7 Sep 2026):
 *   - SEMUA panggilan di-sign. Endpoint "publik" menurut dokumen ternyata
 *     menolak tanpa signature (code 100412).
 *   - Angka ≥16 digit (orderNo, advertNo, uid, sender) dijaga sebagai TEKS
 *     sebelum JSON.parse. JavaScript hanya akurat sampai 2^53 (~16 digit);
 *     nomor 19 digit BingX dibulatkan diam-diam, dan hasilnya order "tidak ada".
 *   - Path yang terbukti tidak ada dibuang.
 *
 * Cara pakai (Node 14+, tanpa dependensi):
 *   BINGX_KEY=xxx BINGX_SECRET=yyy node scripts/bingx-probe.js
 *   BINGX_KEY=xxx BINGX_SECRET=yyy node scripts/bingx-probe.js --post-noop
 *   (opsional) BINGX_FIAT=IDR
 *
 * --post-noop = satu-satunya panggilan tulis: ubah harga iklan pertama ke harga
 * yang sama persis, untuk menemukan format body POST yang diterima.
 * Secret tidak pernah dicetak. Tempelkan SELURUH output ke chat.
 */
'use strict';
const https = require('https');
const crypto = require('crypto');

const KEY = process.env.BINGX_KEY;
const SECRET = process.env.BINGX_SECRET;
if (!KEY || !SECRET) { console.error('Set BINGX_KEY dan BINGX_SECRET dulu.'); process.exit(1); }
const HOST = 'open-api.bingx.com';
const FIAT = process.env.BINGX_FIAT || 'IDR';
const POST_NOOP = process.argv.includes('--post-noop');

// ── Tanda tangan (terbukti diterima BingX) ───────────────────────────────────
function clean(params) {
  const out = {};
  Object.keys(params).forEach(k => {
    const v = params[k];
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  });
  return out;
}
function canon(params) {
  const p = clean(params);
  return Object.keys(p).sort().map(k => `${k}=${p[k]}`).join('&');
}
function sign(str) { return crypto.createHmac('sha256', SECRET).update(str).digest('hex'); }

// ── Parser JSON yang tidak membulatkan angka panjang ─────────────────────────
// Setiap literal angka ≥16 digit yang berdiri sebagai NILAI (setelah : , [ )
// dibungkus tanda kutip sebelum diparse. Timestamp 13 digit tidak tersentuh.
function safeParse(text) {
  const guarded = text.replace(/([:\[,]\s*)(-?\d{16,})(?=\s*[,\]}])/g, '$1"$2"');
  return JSON.parse(guarded);
}

function request(method, path, query, body, headers) {
  return new Promise((resolve) => {
    const req = https.request({
      host: HOST, method, path: path + (query ? '?' + query : ''),
      headers: { 'X-BX-APIKEY': KEY, ...headers },
      timeout: 15000,
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let json = null;
        try { json = safeParse(data); } catch { /* bukan JSON */ }
        resolve({ status: res.statusCode, json, raw: data });
      });
    });
    req.on('error', e => resolve({ status: 0, json: null, raw: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, json: null, raw: 'timeout' }); });
    if (body) req.write(body);
    req.end();
  });
}

async function get(path, params) {
  const ts = Date.now();
  const q = canon({ ...params, timestamp: ts });
  const r = await request('GET', path, `${q}&signature=${sign(q)}`, null, {});
  return { ...r, sentTs: ts };
}

// ── Pelapor ─────────────────────────────────────────────────────────────────
const summary = { ok: {}, gagal: {}, driftMs: null, postFormat: null, bigIntCheck: null };
function brief(r) {
  if (!r.json) return `HTTP ${r.status} bukan-JSON: ${r.raw.replace(/\s+/g, ' ').slice(0, 120)}`;
  return `HTTP ${r.status} code=${r.json.code} msg=${JSON.stringify(r.json.msg || '')}`;
}
function keysOf(obj) {
  if (!obj || typeof obj !== 'object') return String(obj);
  return Object.keys(obj).join(', ');
}

async function probe(label, path, params) {
  console.log(`\n=== ${label} ===\n  ${path}`);
  const r = await get(path, params);
  console.log(`    → ${brief(r)}`);
  if (r.json && r.json.code === 0) {
    summary.ok[label] = path;
    if (summary.driftMs === null && r.json.timestamp) summary.driftMs = Number(r.json.timestamp) - r.sentTs;
    const d = r.json.data;
    const sample = Array.isArray(d && d.result) ? d.result[0] : (Array.isArray(d) ? d[0] : d);
    console.log(`    data: ${keysOf(d)}`);
    if (sample && sample !== d) console.log(`    contoh item: ${keysOf(sample)}`);
    return { json: r.json, raw: r.raw };
  }
  summary.gagal[`${label} ${path}`] = r.json ? `${r.json.code} ${r.json.msg || ''}` : `HTTP ${r.status}`;
  return null;
}

// ── POST no-op (opsional) ───────────────────────────────────────────────────
async function postNoop(ad) {
  const path = '/openApi/p2p/v1/merchant/advert/modifyPrice';
  const biz = { advertNo: String(ad.advertNo), priceType: Number(ad.priceType) };
  if (biz.priceType === 2) biz.floatRatio = String(ad.floatRatio);
  else biz.fixedPrice = String(ad.fixedPrice);
  console.log(`\n=== POST no-op: modifyPrice iklan ${biz.advertNo} → harga sama (${biz.fixedPrice || biz.floatRatio + '%'}), status iklan=${ad.status} ===`);

  const attempts = [
    {
      name: 'F4 body JSON berisi SEMUA field termasuk timestamp+signature, tanpa query (pedoman resmi)',
      run: () => {
        const all = { ...biz, timestamp: Date.now() };
        const body = JSON.stringify({ ...all, signature: sign(canon(all)) });
        return request('POST', path, null, body, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
      },
    },
    {
      name: 'F1 semua di query, body kosong',
      run: () => { const q = canon({ ...biz, timestamp: Date.now() }); return request('POST', path, `${q}&signature=${sign(q)}`, null, {}); },
    },
    {
      name: 'F3 body form-urlencoded berisi semuanya',
      run: () => {
        const q = canon({ ...biz, timestamp: Date.now() });
        const body = `${q}&signature=${sign(q)}`;
        return request('POST', path, null, body, { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) });
      },
    },
  ];
  for (const a of attempts) {
    const r = await a.run();
    console.log(`  ${a.name}\n    → ${brief(r)}`);
    if (r.json && r.json.code === 0) { summary.postFormat = a.name; return; }
    await new Promise(res => setTimeout(res, 600)); // limit 2/detik per UID
  }
}

// ── Jalankan ────────────────────────────────────────────────────────────────
(async () => {
  console.log(`bingx-probe v3 | host=${HOST} | fiat=${FIAT} | key=${KEY.slice(0, 4)}…${KEY.slice(-4)} | jam lokal=${new Date().toISOString()}`);

  await probe('advert/list', '/openApi/p2p/v1/advert/list',
    { asset: 'USDT', fiatUnit: FIAT, tradeType: 1, pageId: 0, pageSize: 5 });
  await probe('common/assetConfig', '/openApi/p2p/v1/common/assetConfig',
    { asset: 'USDT', fiatUnit: FIAT, tradeType: 2 });
  await probe('paymentMethod/list', '/openApi/p2p/v1/paymentMethod/list', {});

  const my = await probe('merchant/myAdvert', '/openApi/p2p/v1/merchant/myAdvert', { pageId: 0, pageSize: 20 });
  await probe('userPaymentMethod/list', '/openApi/p2p/v1/userPaymentMethod/list', {});
  const orders = await probe('merchant/order/list (type=0 semua)', '/openApi/p2p/v1/merchant/order/list',
    { type: 0, pageId: 0, pageSize: 5 });

  const first = orders && orders.json.data && Array.isArray(orders.json.data.result) ? orders.json.data.result[0] : null;
  if (first) {
    const no = String(first.orderNo);
    // Bandingkan dengan digit asli di teks mentah — harus sama persis.
    const m = orders.raw.match(/"orderNo"\s*:\s*"?(\d+)/);
    const rawNo = m ? m[1] : '(tidak ketemu)';
    summary.bigIntCheck = { diparse: no, mentah: rawNo, sama: no === rawNo };
    console.log(`\n(orderNo diparse=${no} | mentah=${rawNo} | sama=${no === rawNo})`);
    console.log(`(status=${first.orderStatus}, tradeType=${first.tradeType}, createTime="${first.createTime}", buyer=${first.buyerNickname})`);
    const det = await probe('order/detail', '/openApi/p2p/v1/order/detail', { orderNo: no });
    if (det) {
      const d = det.json.data || {};
      console.log(`    buyerInfo: ${keysOf(d.buyerInfo)} | sellerInfo: ${keysOf(d.sellerInfo)} | userPaymentMethods: ${Array.isArray(d.userPaymentMethods) ? d.userPaymentMethods.length : '-'}`);
    }
    await probe('order/counterparty/info', '/openApi/p2p/v1/order/counterparty/info', { orderNo: no });
    await probe('im/group/msgList', '/openApi/p2p/v1/im/group/msgList', { orderNo: no, count: 5, direction: 'backward' });
  } else {
    console.log('\n(tidak ada order — detail/counterparty/msgList dilewati)');
  }

  if (POST_NOOP) {
    const ad = my && my.json.data && Array.isArray(my.json.data.result) ? my.json.data.result[0] : null;
    if (!ad) console.log('\n--post-noop dilewati: tidak ada iklan di myAdvert.');
    else await postNoop(ad);
  } else {
    console.log('\n(POST tidak diuji — tambahkan --post-noop kalau mau; itu satu-satunya panggilan tulis)');
  }

  console.log('\n================ RINGKASAN (tempel bagian ini) ================');
  console.log(JSON.stringify({
    node: process.version,
    driftMs: summary.driftMs,
    bigIntCheck: summary.bigIntCheck,
    pathBerhasil: summary.ok,
    gagal: summary.gagal,
    postFormat: summary.postFormat,
  }, null, 2));
})();
