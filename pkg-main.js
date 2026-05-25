'use strict';

require('./suppress-fetch-warning.js');
require('./polyfill-abort.js');

const { sunucuyuBaslat } = require('./index.js');

sunucuyuBaslat().catch((err) => {
    console.error('Sunucu baslatilamadi:', err.message || err);
    process.exit(1);
});
