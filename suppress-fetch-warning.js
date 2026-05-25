'use strict';

/**
 * pkg (Node 18) konsolunda "ExperimentalWarning: Fetch API" kirletmesin.
 */
const origEmit = process.emit;
process.emit = function emit(type, arg) {
    if (
        type === 'warning'
        && arg
        && (arg.name === 'ExperimentalWarning' || arg.code === 'ExperimentalWarning')
        && String(arg.message || '').includes('Fetch API')
    ) {
        return false;
    }
    return origEmit.apply(this, arguments);
};
