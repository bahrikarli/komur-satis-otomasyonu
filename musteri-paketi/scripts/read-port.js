'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || process.cwd());
let port = 3017;

const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
    const text = fs.readFileSync(envPath, 'utf8');
    const m = text.match(/^\s*PORT\s*=\s*(\d+)\s*$/im);
    if (m) port = parseInt(m[1], 10) || port;
}

process.stdout.write(String(port));
