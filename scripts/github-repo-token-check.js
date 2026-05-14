'use strict';
/**
 * GET /repos/{owner}/{repo} with Bearer token (same as GitHub API for PAT).
 * Exit: 0 = HTTP 200, 1 = 401/403/404/other, 2 = eksik arg/token, 3 = ag hatasi
 */
const https = require('https');
const repo = String(process.argv[2] || '').trim();
const token = String(process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '')
  .replace(/^\uFEFF/, '')
  .trim()
  .split(/\r?\n/)[0]
  .trim();
if (!repo || repo.split('/').length !== 2 || !repo.split('/')[0] || !repo.split('/')[1]) {
  console.log('SONUC: Gecersiz repo argumani (beklenen: sahip/repo).');
  process.exit(2);
}
if (!token) {
  console.log('SONUC: GH_TOKEN / GITHUB_TOKEN bos.');
  process.exit(2);
}
const path = `/repos/${repo}`;
const opts = {
  hostname: 'api.github.com',
  port: 443,
  path,
  method: 'GET',
  headers: {
    'User-Agent': 'komur-satis-release-check',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: `Bearer ${token}`,
  },
};
const req = https.request(opts, (res) => {
  const code = res.statusCode || 0;
  res.resume();
  res.on('end', () => {
    if (code === 200) {
      console.log('SONUC: Token ile repo API erisimi OK (HTTP 200).');
      process.exit(0);
    }
    console.log(`SONUC: GitHub API HTTP ${code} (${path}).`);
    if (code === 401) console.log('Ipucu: Token gecersiz, suresi dolmus veya yanlis kopyalanmis.');
    if (code === 403) console.log('Ipucu: Bu repoya yetki yok; fine-grainedda repo secimi + Contents/Metadata.');
    if (code === 404) console.log('Ipucu: Repo yok veya token bu ozel repoyu goremiyor.');
    process.exit(1);
  });
});
req.on('error', (err) => {
  console.log('SONUC: Ag hatasi:', err.message);
  process.exit(3);
});
req.setTimeout(25_000, () => {
  req.destroy();
  console.log('SONUC: Zaman asimi.');
  process.exit(3);
});
req.end();
