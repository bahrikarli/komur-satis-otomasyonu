'use strict';

/**
 * pkg (Node 18): mssql/tedious AbortSignal.any kullanir (Node 20+).
 */
if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any !== 'function') {
    AbortSignal.any = function abortSignalAny(signals) {
        const list = Array.from(signals || []).filter(Boolean);
        if (!list.length) {
            throw new TypeError('AbortSignal.any requires at least one signal');
        }
        const ctrl = new AbortController();
        const forward = () => {
            if (!ctrl.signal.aborted) ctrl.abort();
        };
        for (const s of list) {
            if (s.aborted) {
                forward();
                break;
            }
            s.addEventListener('abort', forward, { once: true });
        }
        return ctrl.signal;
    };
}
