/**
 * pkg EXE: Windows GUI alt sistemi (konsol penceresi acilmasin).
 * Subsystem alani PE32 ve PE32+ icin optional header + 0x44 (Microsoft PE spec).
 */
const fs = require('fs');
const path = require('path');

const SUBSYSTEM_WINDOWS_GUI = 2;
const SUBSYSTEM_WINDOWS_CUI = 3;
const SUBSYSTEM_OFFSET = 0x44;

const exe = path.join(__dirname, '..', 'dist', 'komur-satis-otomasyonu.exe');
if (!fs.existsSync(exe)) {
    console.warn('patch-exe-gui: dist exe yok, atlandi.');
    process.exit(0);
}

function setGuiSubsystem(filePath) {
    const buf = fs.readFileSync(filePath);
    if (buf.length < 0x200) throw new Error('Gecersiz EXE dosyasi.');

    const peOffset = buf.readUInt32LE(0x3c);
    if (peOffset <= 0 || peOffset + 0x100 > buf.length) {
        throw new Error('PE offset gecersiz.');
    }
    if (buf.toString('binary', peOffset, peOffset + 4) !== 'PE\0\0') {
        throw new Error('PE imzasi bulunamadi.');
    }

    const optionalHeaderOffset = peOffset + 24;
    const magic = buf.readUInt16LE(optionalHeaderOffset);
    if (magic !== 0x20b && magic !== 0x10b) {
        throw new Error(`Desteklenmeyen PE magic: 0x${magic.toString(16)}`);
    }

    const subsystemOffset = optionalHeaderOffset + SUBSYSTEM_OFFSET;
    const current = buf.readUInt16LE(subsystemOffset);
    if (current !== SUBSYSTEM_WINDOWS_GUI && current !== SUBSYSTEM_WINDOWS_CUI) {
        throw new Error(
            `Subsystem beklenmiyor (${current}); EXE bozuk olabilir — yeniden: npm run build:exe`
        );
    }
    if (current === SUBSYSTEM_WINDOWS_GUI) {
        console.log('OK: EXE zaten GUI modunda.');
        return;
    }

    buf.writeUInt16LE(SUBSYSTEM_WINDOWS_GUI, subsystemOffset);
    fs.writeFileSync(filePath, buf);
    console.log('OK: EXE GUI moduna alindi.');
}

try {
    setGuiSubsystem(exe);
} catch (e) {
    console.error('patch-exe-gui HATA:', e.message);
    process.exit(1);
}
