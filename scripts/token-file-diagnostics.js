'use strict';
/**
 * token.txt tanisi — token METNINI yazdirmaz.
 * Kullanim: node scripts/token-file-diagnostics.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const root = path.join(__dirname, '..');
const file = path.join(root, 'token.txt');
const repo = process.argv[2] || 'bahrikarli/komur-satis-otomasyonu';

let raw;
try {
  raw = fs.readFileSync(file);
} catch (e) {
  console.log('HATA: token.txt bulunamadi veya okunamadi:', path.relative(root, file));
  console.log('      Dosya su klasorde olmali:', root);
  process.exit(1);
}

const bomUtf8 = raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
const bomUtf16be = raw[0] === 0xfe && raw[1] === 0xff;
const bomUtf16le = raw[0] === 0xff && raw[1] === 0xfe;
console.log('token.txt var. Byte uzunlugu:', raw.length);
console.log('BOM:', bomUtf8 ? 'UTF-8 BOM (sorun cikabilir)' : bomUtf16be || bomUtf16le ? 'UTF-16 (token bozulur; UTF-8 kaydedin)' : 'yok / bilinmiyor');

let text = raw.toString('utf8');
if (bomUtf16le || bomUtf16be) {
  console.log('UYARI: UTF-16 gibi gorunuyor. Not Defteri "Unicode" kaydi tokeni bozar.');
  console.log('       Cursor: Save with Encoding -> UTF-8');
}

const line = text.replace(/^\uFEFF/, '').split(/\r?\n/)[0].trim();
console.log('Ilk satir trim sonrasi karakter sayisi:', line.length);
if (!line.length) {
  console.log('HATA: Ilk satir bos.');
  process.exit(1);
}
const okPrefix = line.startsWith('github_pat_') || line.startsWith('ghp_');
console.log('Token bicimi:', okPrefix ? 'tanidik (ghp_ veya github_pat_)' : 'Beklenmeyen baslangic — yanlis kopya olabilir');

const apiPath = `/repos/${repo}`;
const opts = {
  hostname: 'api.github.com',
  path: apiPath,
  method: 'GET',
  headers: {
    'User-Agent': 'komur-token-diagnostics',
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${line}`,
  },
};

const req = https.request(opts, (res) => {
  const code = res.statusCode;
  res.resume();
  res.on('end', () => {
    console.log('');
    console.log('GitHub API:', apiPath, '-> HTTP', code);
    if (code === 200) console.log('SONUC: Token GECERLI; release-all [5/6] calismali.');
    else if (code === 401) console.log('SONUC: GitHub tokeni REDDETTI — yeni PAT, tek satir, UTF-8.');
    else if (code === 403) console.log('SONUC: Yetki yok — repoyu secin, Contents Read-Write + Metadata.');
    else if (code === 404) console.log('SONUC: Repo yok veya token bu repoya erisemiyor.');
    process.exit(code === 200 ? 0 : 1);
  });
});
req.on('error', (e) => {
  console.log('Ag hatasi:', e.message);
  process.exit(2);
});
req.setTimeout(20_000, () => {
  req.destroy();
  console.log('Zaman asimi');
  process.exit(2);
});
req.end();
