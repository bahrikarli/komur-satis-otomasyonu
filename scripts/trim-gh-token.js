/** stdout: GH_TOKEN trimmed (BOM, CRLF, first line only) — batch reads into GH_TOKEN */
const t = String(process.env.GH_TOKEN || '')
  .replace(/^\uFEFF/, '')
  .trim()
  .split(/\r?\n/)[0]
  .trim();
process.stdout.write(t);
