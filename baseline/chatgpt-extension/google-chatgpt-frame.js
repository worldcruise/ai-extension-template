// ==========================
// GOOGLE CHATGPT IFRAME - Direct API Communication
// This runs inside an extension page iframe, giving proper session access
// ==========================

const CHATGPT_BASE_URL = 'https://chatgpt.com';

// DOM Elements
const loadingEl = document.getElementById('loading');
const responseEl = document.getElementById('response');
const errorEl = document.getElementById('error');
const stopBtn = document.getElementById('stopBtn');
const settingsBtn = document.getElementById('settingsBtn');

let abortController = null;

let lastNotifiedHeight = 0;
let heightNotificationTimer = null;
function notifyParentHeight() {
    try {
        const height = Math.ceil(Math.max(
            document.body?.scrollHeight || 0,
            document.documentElement?.scrollHeight || 0,
            loadingEl?.scrollHeight || 0,
            responseEl?.scrollHeight || 0,
            errorEl?.scrollHeight || 0
        ));
        if (height === lastNotifiedHeight) return;
        lastNotifiedHeight = height;
        window.parent?.postMessage?.({ type: 'SIDEAI_GOOGLE_FRAME_HEIGHT', height }, '*');
    } catch (_) {}
}

function notifyParentHeightSoon() {
    if (heightNotificationTimer !== null) return;
    heightNotificationTimer = setTimeout(() => {
        heightNotificationTimer = null;
        notifyParentHeight();
    }, 80);
}

function debugLog(runId, hypothesisId, location, message, data) {
}

function debugTail(text, size = 180) {
    if (typeof text !== 'string') return '';
    return text.slice(Math.max(0, text.length - size));
}

const frameDebugLengths = {};
function logFrameProgress(runId, message, data) {
    const textLength = typeof data?.text === 'string' ? data.text.length : (typeof data?.textLength === 'number' ? data.textLength : 0);
    const key = (runId || 'no-id') + ':' + message;
    const previousLength = frameDebugLengths[key] || 0;
    const shouldLog =
        data?.done ||
        data?.error ||
        textLength < 500 ||
        textLength - previousLength >= 750;
    if (!shouldLog) return;
    frameDebugLengths[key] = textLength;
    debugLog(runId || 'no-id', 'STREAM', 'google-chatgpt-frame.js', message, data);
}

// Get query from URL hash; returns { query, noBill } where noBill = true means pagination (don't count usage)
function getQueryFromHash() {
    const hash = window.location.hash;
    if (!hash) return { query: '', noBill: false };
    let raw = hash.slice(1);
    const noBill = raw.endsWith('||nobill');
    if (noBill) raw = raw.slice(0, -8);
        try {
        const query = decodeURIComponent(raw);
        return { query: query || '', noBill };
        } catch (e) {
        return { query: raw || '', noBill };
    }
}

// Generate UUID
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Same device ID across all requests in session (matches real ChatGPT behavior)
function getDeviceId() {
    const key = 'oai_device_id';
    let id = sessionStorage.getItem(key);
    if (!id) {
        id = generateUUID();
        sessionStorage.setItem(key, id);
    }
    return id;
}

// Generate navigator info for fingerprint
function getNavigatorInfo() {
    const nav = navigator;
    return {
        userAgent: nav.userAgent,
        language: nav.language || 'en-US',
        languages: nav.languages ? [...nav.languages] : ['en-US', 'en'],
        platform: nav.platform || 'Win32',
        hardwareConcurrency: nav.hardwareConcurrency || 8,
        deviceMemory: nav.deviceMemory || 8,
        maxTouchPoints: nav.maxTouchPoints || 0
    };
}

// Generate screen info for fingerprint
function getScreenInfo() {
    const screen = window.screen;
    return {
        width: screen.width || 1920,
        height: screen.height || 1080,
        availWidth: screen.availWidth || 1920,
        availHeight: screen.availHeight || 1040,
        colorDepth: screen.colorDepth || 24,
        pixelDepth: screen.pixelDepth || 24
    };
}

// Generate the p parameter (fingerprint payload)
// Use null for scriptPath - chrome-extension:// path is a detection red flag
function generatePParameter() {
    const navInfo = getNavigatorInfo();
    const now = new Date();
    
    const navigatorProps = ['appName-Netscape', 'storageBuckets-[object StorageBucketManager]', 'login-[object NavigatorLogin]'];
    const reactSuffix = () => {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let s = '';
        for (let i = 0; i < 11; i++) s += chars[Math.floor(Math.random() * chars.length)];
        return s;
    };
    const functionNames = ['ondevicemotion', 'onemptied', 'onloadedmetadata'];
    
    const fingerprintArray = [
        11982,
        now.toString(),
        Math.floor(Math.random() * 9999999999),
        Math.floor(Math.random() * 50),
        navInfo.userAgent,
        null,  // Never expose chrome-extension path
        null,
        navInfo.language,
        navInfo.languages.join(','),
        Math.floor(Math.random() * 30),
        navigatorProps[Math.floor(Math.random() * navigatorProps.length)],
        '_reactListening' + reactSuffix(),
        functionNames[Math.floor(Math.random() * functionNames.length)],
        performance.now(),
        ''
    ];
    
    return encodeToken(fingerprintArray, false);
}

// Encode token with proper gAAAAA prefix format (6 bytes like working extension)
function encodeToken(dataArray, isProofToken = false) {
    const jsonStr = JSON.stringify(dataArray);
    
    // Working extension uses 6-byte prefix: [0x80, 0x00, 0x00, 0x00, 0x00, 0x96/0x56]
    // p parameter uses 0x96, proof token uses 0x56
    const prefixByte = isProofToken ? 0x56 : 0x96;
    const prefix = new Uint8Array([0x80, 0x00, 0x00, 0x00, 0x00, prefixByte]);
    const jsonBytes = new TextEncoder().encode(jsonStr);
    
    const combined = new Uint8Array(prefix.length + jsonBytes.length);
    combined.set(prefix);
    combined.set(jsonBytes, prefix.length);
    
    // Standard base64 (OpenAI expects this in headers)
    let binary = '';
    for (let i = 0; i < combined.length; i++) {
        binary += String.fromCharCode(combined[i]);
    }
    
    return btoa(binary);
}

// js-sha3 library (MIT License) - used for proof-of-work
// Based on the same library used by the working extension
const jsSha3 = (function() {
    'use strict';
    
    const HEX_CHARS = '0123456789abcdef'.split('');
    const KECCAK_PADDING = [1, 256, 65536, 16777216];
    const SHA3_PADDING = [6, 1536, 393216, 100663296];
    const SHIFT = [0, 8, 16, 24];
    const RC = [
        1, 0, 32898, 0, 32906, 2147483648, 2147516416, 2147483648,
        32907, 0, 2147483649, 0, 2147516545, 2147483648, 32777, 2147483648,
        138, 0, 136, 0, 2147516425, 0, 2147483658, 0,
        2147516555, 0, 139, 2147483648, 32905, 2147483648, 32771, 2147483648,
        32770, 2147483648, 128, 2147483648, 32778, 0, 2147483658, 2147483648,
        2147516545, 2147483648, 32896, 2147483648, 2147483649, 0, 2147516424, 2147483648
    ];
    
    function Keccak(bits, padding, outputBits) {
        this.blocks = [];
        this.s = [];
        this.padding = padding;
        this.outputBits = outputBits;
        this.reset = true;
        this.finalized = false;
        this.block = 0;
        this.start = 0;
        this.blockCount = (1600 - (bits << 1)) >> 5;
        this.byteCount = this.blockCount << 2;
        this.outputBlocks = outputBits >> 5;
        this.extraBytes = (outputBits & 31) >> 3;
        for (let i = 0; i < 50; ++i) {
            this.s[i] = 0;
        }
    }
    
    Keccak.prototype.update = function(message) {
        if (this.finalized) return;
        
        let isString = typeof message === 'string';
        let blocks = this.blocks;
        let byteCount = this.byteCount;
        let length = message.length;
        let blockCount = this.blockCount;
        let index = 0;
        let s = this.s;
        let i, code;
        
        while (index < length) {
            if (this.reset) {
                this.reset = false;
                blocks[0] = this.block;
                for (i = 1; i < blockCount + 1; ++i) {
                    blocks[i] = 0;
                }
            }
            if (isString) {
                for (i = this.start; index < length && i < byteCount; ++index) {
                    code = message.charCodeAt(index);
                    if (code < 0x80) {
                        blocks[i >> 2] |= code << SHIFT[i++ & 3];
                    } else if (code < 0x800) {
                        blocks[i >> 2] |= (0xc0 | (code >> 6)) << SHIFT[i++ & 3];
                        blocks[i >> 2] |= (0x80 | (code & 0x3f)) << SHIFT[i++ & 3];
                    } else if (code < 0xd800 || code >= 0xe000) {
                        blocks[i >> 2] |= (0xe0 | (code >> 12)) << SHIFT[i++ & 3];
                        blocks[i >> 2] |= (0x80 | ((code >> 6) & 0x3f)) << SHIFT[i++ & 3];
                        blocks[i >> 2] |= (0x80 | (code & 0x3f)) << SHIFT[i++ & 3];
                    } else {
                        code = 0x10000 + (((code & 0x3ff) << 10) | (message.charCodeAt(++index) & 0x3ff));
                        blocks[i >> 2] |= (0xf0 | (code >> 18)) << SHIFT[i++ & 3];
                        blocks[i >> 2] |= (0x80 | ((code >> 12) & 0x3f)) << SHIFT[i++ & 3];
                        blocks[i >> 2] |= (0x80 | ((code >> 6) & 0x3f)) << SHIFT[i++ & 3];
                        blocks[i >> 2] |= (0x80 | (code & 0x3f)) << SHIFT[i++ & 3];
                    }
                }
            } else {
                for (i = this.start; index < length && i < byteCount; ++index) {
                    blocks[i >> 2] |= message[index] << SHIFT[i++ & 3];
                }
            }
            this.lastByteIndex = i;
            if (i >= byteCount) {
                this.start = i - byteCount;
                this.block = blocks[blockCount];
                for (i = 0; i < blockCount; ++i) {
                    s[i] ^= blocks[i];
                }
                keccakF(s);
                this.reset = true;
            } else {
                this.start = i;
            }
        }
        return this;
    };
    
    Keccak.prototype.finalize = function() {
        if (this.finalized) return;
        this.finalized = true;
        let blocks = this.blocks;
        let i = this.lastByteIndex;
        let blockCount = this.blockCount;
        let s = this.s;
        blocks[i >> 2] |= this.padding[i & 3];
        if (this.lastByteIndex === this.byteCount) {
            blocks[0] = blocks[blockCount];
            for (i = 1; i < blockCount + 1; ++i) {
                blocks[i] = 0;
            }
        }
        blocks[blockCount - 1] |= 0x80000000;
        for (i = 0; i < blockCount; ++i) {
            s[i] ^= blocks[i];
        }
        keccakF(s);
    };
    
    Keccak.prototype.hex = function() {
        this.finalize();
        let blockCount = this.blockCount;
        let s = this.s;
        let outputBlocks = this.outputBlocks;
        let extraBytes = this.extraBytes;
        let i = 0, j = 0;
        let hex = '';
        let block;
        while (j < outputBlocks) {
            for (i = 0; i < blockCount && j < outputBlocks; ++i, ++j) {
                block = s[i];
                hex += HEX_CHARS[(block >> 4) & 0x0F] + HEX_CHARS[block & 0x0F] +
                       HEX_CHARS[(block >> 12) & 0x0F] + HEX_CHARS[(block >> 8) & 0x0F] +
                       HEX_CHARS[(block >> 20) & 0x0F] + HEX_CHARS[(block >> 16) & 0x0F] +
                       HEX_CHARS[(block >> 28) & 0x0F] + HEX_CHARS[(block >> 24) & 0x0F];
            }
            if (j % blockCount === 0) {
                keccakF(s);
                i = 0;
            }
        }
        if (extraBytes) {
            block = s[i];
            hex += HEX_CHARS[(block >> 4) & 0x0F] + HEX_CHARS[block & 0x0F];
            if (extraBytes > 1) {
                hex += HEX_CHARS[(block >> 12) & 0x0F] + HEX_CHARS[(block >> 8) & 0x0F];
            }
            if (extraBytes > 2) {
                hex += HEX_CHARS[(block >> 20) & 0x0F] + HEX_CHARS[(block >> 16) & 0x0F];
            }
        }
        return hex;
    };
    
    function keccakF(s) {
        let h, l, n, c0, c1, c2, c3, c4, c5, c6, c7, c8, c9,
            b0, b1, b2, b3, b4, b5, b6, b7, b8, b9, b10, b11, b12, b13, b14, b15, b16, b17,
            b18, b19, b20, b21, b22, b23, b24, b25, b26, b27, b28, b29, b30, b31, b32, b33,
            b34, b35, b36, b37, b38, b39, b40, b41, b42, b43, b44, b45, b46, b47, b48, b49;
        for (n = 0; n < 48; n += 2) {
            c0 = s[0] ^ s[10] ^ s[20] ^ s[30] ^ s[40];
            c1 = s[1] ^ s[11] ^ s[21] ^ s[31] ^ s[41];
            c2 = s[2] ^ s[12] ^ s[22] ^ s[32] ^ s[42];
            c3 = s[3] ^ s[13] ^ s[23] ^ s[33] ^ s[43];
            c4 = s[4] ^ s[14] ^ s[24] ^ s[34] ^ s[44];
            c5 = s[5] ^ s[15] ^ s[25] ^ s[35] ^ s[45];
            c6 = s[6] ^ s[16] ^ s[26] ^ s[36] ^ s[46];
            c7 = s[7] ^ s[17] ^ s[27] ^ s[37] ^ s[47];
            c8 = s[8] ^ s[18] ^ s[28] ^ s[38] ^ s[48];
            c9 = s[9] ^ s[19] ^ s[29] ^ s[39] ^ s[49];

            h = c8 ^ ((c2 << 1) | (c3 >>> 31));
            l = c9 ^ ((c3 << 1) | (c2 >>> 31));
            s[0] ^= h; s[1] ^= l; s[10] ^= h; s[11] ^= l;
            s[20] ^= h; s[21] ^= l; s[30] ^= h; s[31] ^= l;
            s[40] ^= h; s[41] ^= l;
            h = c0 ^ ((c4 << 1) | (c5 >>> 31));
            l = c1 ^ ((c5 << 1) | (c4 >>> 31));
            s[2] ^= h; s[3] ^= l; s[12] ^= h; s[13] ^= l;
            s[22] ^= h; s[23] ^= l; s[32] ^= h; s[33] ^= l;
            s[42] ^= h; s[43] ^= l;
            h = c2 ^ ((c6 << 1) | (c7 >>> 31));
            l = c3 ^ ((c7 << 1) | (c6 >>> 31));
            s[4] ^= h; s[5] ^= l; s[14] ^= h; s[15] ^= l;
            s[24] ^= h; s[25] ^= l; s[34] ^= h; s[35] ^= l;
            s[44] ^= h; s[45] ^= l;
            h = c4 ^ ((c8 << 1) | (c9 >>> 31));
            l = c5 ^ ((c9 << 1) | (c8 >>> 31));
            s[6] ^= h; s[7] ^= l; s[16] ^= h; s[17] ^= l;
            s[26] ^= h; s[27] ^= l; s[36] ^= h; s[37] ^= l;
            s[46] ^= h; s[47] ^= l;
            h = c6 ^ ((c0 << 1) | (c1 >>> 31));
            l = c7 ^ ((c1 << 1) | (c0 >>> 31));
            s[8] ^= h; s[9] ^= l; s[18] ^= h; s[19] ^= l;
            s[28] ^= h; s[29] ^= l; s[38] ^= h; s[39] ^= l;
            s[48] ^= h; s[49] ^= l;

            b0 = s[0]; b1 = s[1];
            b32 = (s[11] << 4) | (s[10] >>> 28); b33 = (s[10] << 4) | (s[11] >>> 28);
            b14 = (s[20] << 3) | (s[21] >>> 29); b15 = (s[21] << 3) | (s[20] >>> 29);
            b46 = (s[31] << 9) | (s[30] >>> 23); b47 = (s[30] << 9) | (s[31] >>> 23);
            b28 = (s[40] << 18) | (s[41] >>> 14); b29 = (s[41] << 18) | (s[40] >>> 14);
            b20 = (s[2] << 1) | (s[3] >>> 31); b21 = (s[3] << 1) | (s[2] >>> 31);
            b2 = (s[13] << 12) | (s[12] >>> 20); b3 = (s[12] << 12) | (s[13] >>> 20);
            b34 = (s[22] << 10) | (s[23] >>> 22); b35 = (s[23] << 10) | (s[22] >>> 22);
            b16 = (s[33] << 13) | (s[32] >>> 19); b17 = (s[32] << 13) | (s[33] >>> 19);
            b48 = (s[42] << 2) | (s[43] >>> 30); b49 = (s[43] << 2) | (s[42] >>> 30);
            b40 = (s[5] << 30) | (s[4] >>> 2); b41 = (s[4] << 30) | (s[5] >>> 2);
            b22 = (s[14] << 6) | (s[15] >>> 26); b23 = (s[15] << 6) | (s[14] >>> 26);
            b4 = (s[25] << 11) | (s[24] >>> 21); b5 = (s[24] << 11) | (s[25] >>> 21);
            b36 = (s[34] << 15) | (s[35] >>> 17); b37 = (s[35] << 15) | (s[34] >>> 17);
            b18 = (s[45] << 29) | (s[44] >>> 3); b19 = (s[44] << 29) | (s[45] >>> 3);
            b10 = (s[6] << 28) | (s[7] >>> 4); b11 = (s[7] << 28) | (s[6] >>> 4);
            b42 = (s[17] << 23) | (s[16] >>> 9); b43 = (s[16] << 23) | (s[17] >>> 9);
            b24 = (s[26] << 25) | (s[27] >>> 7); b25 = (s[27] << 25) | (s[26] >>> 7);
            b6 = (s[36] << 21) | (s[37] >>> 11); b7 = (s[37] << 21) | (s[36] >>> 11);
            b38 = (s[47] << 24) | (s[46] >>> 8); b39 = (s[46] << 24) | (s[47] >>> 8);
            b30 = (s[8] << 27) | (s[9] >>> 5); b31 = (s[9] << 27) | (s[8] >>> 5);
            b12 = (s[18] << 20) | (s[19] >>> 12); b13 = (s[19] << 20) | (s[18] >>> 12);
            b44 = (s[29] << 7) | (s[28] >>> 25); b45 = (s[28] << 7) | (s[29] >>> 25);
            b26 = (s[38] << 8) | (s[39] >>> 24); b27 = (s[39] << 8) | (s[38] >>> 24);
            b8 = (s[48] << 14) | (s[49] >>> 18); b9 = (s[49] << 14) | (s[48] >>> 18);

            s[0] = b0 ^ (~b2 & b4); s[1] = b1 ^ (~b3 & b5);
            s[10] = b10 ^ (~b12 & b14); s[11] = b11 ^ (~b13 & b15);
            s[20] = b20 ^ (~b22 & b24); s[21] = b21 ^ (~b23 & b25);
            s[30] = b30 ^ (~b32 & b34); s[31] = b31 ^ (~b33 & b35);
            s[40] = b40 ^ (~b42 & b44); s[41] = b41 ^ (~b43 & b45);
            s[2] = b2 ^ (~b4 & b6); s[3] = b3 ^ (~b5 & b7);
            s[12] = b12 ^ (~b14 & b16); s[13] = b13 ^ (~b15 & b17);
            s[22] = b22 ^ (~b24 & b26); s[23] = b23 ^ (~b25 & b27);
            s[32] = b32 ^ (~b34 & b36); s[33] = b33 ^ (~b35 & b37);
            s[42] = b42 ^ (~b44 & b46); s[43] = b43 ^ (~b45 & b47);
            s[4] = b4 ^ (~b6 & b8); s[5] = b5 ^ (~b7 & b9);
            s[14] = b14 ^ (~b16 & b18); s[15] = b15 ^ (~b17 & b19);
            s[24] = b24 ^ (~b26 & b28); s[25] = b25 ^ (~b27 & b29);
            s[34] = b34 ^ (~b36 & b38); s[35] = b35 ^ (~b37 & b39);
            s[44] = b44 ^ (~b46 & b48); s[45] = b45 ^ (~b47 & b49);
            s[6] = b6 ^ (~b8 & b0); s[7] = b7 ^ (~b9 & b1);
            s[16] = b16 ^ (~b18 & b10); s[17] = b17 ^ (~b19 & b11);
            s[26] = b26 ^ (~b28 & b20); s[27] = b27 ^ (~b29 & b21);
            s[36] = b36 ^ (~b38 & b30); s[37] = b37 ^ (~b39 & b31);
            s[46] = b46 ^ (~b48 & b40); s[47] = b47 ^ (~b49 & b41);
            s[8] = b8 ^ (~b0 & b2); s[9] = b9 ^ (~b1 & b3);
            s[18] = b18 ^ (~b10 & b12); s[19] = b19 ^ (~b11 & b13);
            s[28] = b28 ^ (~b20 & b22); s[29] = b29 ^ (~b21 & b23);
            s[38] = b38 ^ (~b30 & b32); s[39] = b39 ^ (~b31 & b33);
            s[48] = b48 ^ (~b40 & b42); s[49] = b49 ^ (~b41 & b43);

            s[0] ^= RC[n]; s[1] ^= RC[n + 1];
        }
    }
    
    return {
        sha3_512: function(message) {
            return new Keccak(512, SHA3_PADDING, 512).update(message).hex();
        },
        keccak_512: function(message) {
            return new Keccak(512, KECCAK_PADDING, 512).update(message).hex();
        }
    };
})();

// Use SHA-3-512 for proof-of-work (this is what OpenAI expects)
function sha3_512(message) {
    return jsSha3.sha3_512(message);
}

// Solve proof-of-work using SHA-3-512 (Keccak)
function solveProofOfWork(seed, difficulty) {
    console.log('[Frame] Starting PoW with seed:', seed.substring(0, 20) + '...', 'difficulty:', difficulty);
    
    const navInfo = getNavigatorInfo();
    const now = new Date();
    const perfNow = performance.now();
    
    const navigatorProps = ['appName-Netscape', 'storageBuckets-[object StorageBucketManager]', 'login-[object NavigatorLogin]'];
    const reactSuffix = () => {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let s = '';
        for (let i = 0; i < 11; i++) s += chars[Math.floor(Math.random() * chars.length)];
        return s;
    };
    const functionNames = ['ondevicemotion', 'onemptied', 'onloadedmetadata'];
    
    const selectedProp = navigatorProps[Math.floor(Math.random() * navigatorProps.length)];
    const selectedFunc = functionNames[Math.floor(Math.random() * functionNames.length)];
    const reactStr = '_reactListening' + reactSuffix();
    
    const difficultyPrefix = difficulty || '000000';
    const difficultyLength = difficultyPrefix.length;
    
    for (let nonce = 0; nonce < 500000; nonce++) {
        const proofArray = [
            Math.floor(Math.random() * 99999),
            now.toString(),
            Math.floor(Math.random() * 9999999999),
            nonce,
            navInfo.userAgent,
            null,
            null,
            navInfo.language,
            navInfo.languages.join(','),
            Math.round(performance.now() - perfNow),
            selectedProp,
            reactStr,
            selectedFunc,
            perfNow,
            ''
        ];
        
        const jsonStr = JSON.stringify(proofArray);
        const z = btoa(String.fromCharCode(...new TextEncoder().encode(jsonStr)));
        const toHash = seed + z;
        const hash = sha3_512(toHash);
        
        if (hash.substring(0, difficultyLength) <= difficultyPrefix) {
            console.log('[Frame] PoW solved at nonce:', nonce);
            return 'gAAAAAB' + z;
        }
        
        if (nonce % 10000 === 0 && nonce > 0) {
            console.log('[Frame] PoW progress:', nonce);
        }
    }
    
    console.log('[Frame] PoW fallback after max attempts');
    const fallbackArray = [
        Math.floor(Math.random() * 99999),
        now.toString(),
        Math.floor(Math.random() * 9999999999),
        Math.floor(Math.random() * 999999),
        navInfo.userAgent,
        null,
        null,
        navInfo.language,
        navInfo.languages.join(','),
        Math.round(performance.now() - perfNow),
        selectedProp,
        reactStr,
        selectedFunc,
        perfNow,
        ''
    ];
    const zFallback = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(fallbackArray))));
    return 'gAAAAAB' + zFallback;
}

// Get ChatGPT session
async function getChatGPTSession() {
    const response = await fetch(`${CHATGPT_BASE_URL}/api/auth/session`, {
        method: 'GET',
        credentials: 'include',
        headers: {
            'Accept': '*/*',
            'Cache-Control': 'no-cache',
            'oai-device-id': getDeviceId(),
            'oai-language': 'en-US'
        }
    });
    
    if (!response.ok) {
        throw new Error('Failed to get session - please login to ChatGPT');
    }
    
    const data = await response.json();
    if (!data.accessToken) {
        throw new Error('No access token - please login to ChatGPT');
    }
    
    return data;
}

// Headers - avoid Origin/Referer override (browser sets sec-fetch-site from real origin; spoofing can trigger 403)
function getChatGPTHeaders(accessToken, extra = {}) {
    const h = {
        'accept': '*/*',
        'content-type': 'application/json',
        'authorization': `Bearer ${accessToken}`,
        'oai-device-id': getDeviceId(),
        'oai-language': 'en-US'
    };
    return { ...h, ...extra };
}

// Get chat requirements - legacy endpoint returns token directly (prepare+finalize needs Cloudflare turnstile we can't get)
async function getChatRequirements(accessToken) {
    console.log('[Frame] Getting chat requirements...');
    
    const pPayload = generatePParameter();
    const headers = getChatGPTHeaders(accessToken);
    
    const response = await fetch(`${CHATGPT_BASE_URL}/backend-api/sentinel/chat-requirements`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({ p: pPayload })
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        console.error('[Frame] Chat requirements error:', response.status, errorText);
        throw new Error('Failed to get chat requirements: ' + response.status);
    }
    
    const data = await response.json();
    if (data.proofofwork?.required && data.proofofwork?.seed && data.proofofwork?.difficulty) {
        data.proofToken = solveProofOfWork(data.proofofwork.seed, data.proofofwork.difficulty);
    }
    console.log('[Frame] Chat requirements received:', Object.keys(data));
    return data;
}

// Send message and stream response - use /backend-api/conversation (simpler; /f/conversation triggers 403 from extension)
async function sendChatGPTMessage(prompt, accessToken, requirements) {
    const model = 'auto';
    
    const body = {
        action: 'next',
        messages: [{
            author: { role: 'user' },
            content: { content_type: 'text', parts: [prompt] }
        }],
        model,
        supported_encodings: ['v1']
    };
    
    const headers = getChatGPTHeaders(accessToken, {
        'accept': 'text/event-stream'
    });
    
    if (requirements?.token) {
        headers['openai-sentinel-chat-requirements-token'] = requirements.token;
    }
    if (requirements?.proofToken) {
        headers['openai-sentinel-proof-token'] = requirements.proofToken;
    }
    
    console.log('[Frame] Sending to /backend-api/conversation');
    
    abortController = new AbortController();
    
    const response = await fetch(`${CHATGPT_BASE_URL}/backend-api/conversation`, {
        method: 'POST',
        credentials: 'include',
        headers: headers,
        body: JSON.stringify(body),
        signal: abortController.signal
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        console.error('[Frame] API error:', response.status, errorText);
        throw new Error(`API error: ${response.status} - ${errorText.substring(0, 200)}`);
    }
    
    console.log('[Frame] Response received, streaming...');
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let conversationId = null;
    let buffer = '';
    
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer
            
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') continue;
                    if (!data) continue;
                    
                    try {
                        const parsed = JSON.parse(data);
                        
                        if (parsed.conversation_id) {
                            conversationId = parsed.conversation_id;
                        }
                        
                        // Handle error in response
                        if (parsed.error) {
                            console.error('[Frame] Response error:', parsed.error);
                            throw new Error(parsed.error);
                        }
                        
                        // Gizmo/JSON Patch format: {"o":"patch","v":[{"p":"/message/content/parts/0","o":"append","v":"..."}]}
                        const patches = (parsed.o === 'patch' && Array.isArray(parsed.v)) ? parsed.v : (Array.isArray(parsed.v) ? parsed.v : null);
                        if (patches) {
                            for (const op of patches) {
                                if (op && op.o === 'append' && typeof op.v === 'string' && op.p === '/message/content/parts/0') {
                                    fullText += op.v;
                                    if (fullText) updateResponse(fullText);
                                }
                            }
                            continue;
                        }
                        
                        // Gizmo full message in v: {"v":{"message":{...}}}
                        const vMsg = parsed.v?.message;
                        if (vMsg?.author?.role === 'assistant' && vMsg?.content) {
                            const parts = vMsg.content.parts;
                            const text = Array.isArray(parts) ? parts.map(p => typeof p === 'string' ? p : (p?.text || '')).join('') : (vMsg.content.text || '');
                            if (text && text !== fullText) {
                                fullText = text;
                                updateResponse(fullText);
                            }
                        }
                        
                        // Legacy format: {"message":{"author":{"role":"assistant"},"content":{"parts":[...]}}}
                        const isAssistant = parsed.message?.author?.role === 'assistant';
                        if (isAssistant && parsed.message?.content?.parts) {
                            const text = parsed.message.content.parts.join('');
                            if (text && text !== fullText) {
                                fullText = text;
                                updateResponse(fullText);
                            }
                        }
                    } catch (e) {
                        if (e.message && !e.message.includes('JSON')) {
                            throw e;
                        }
                        // Skip non-JSON lines
                    }
                }
            }
        }
    } catch (e) {
        if (e.name === 'AbortError') {
            console.log('[Frame] Request aborted');
        } else {
            throw e;
        }
    }
    
    // Always try to hide conversation (with delay + retry) so it never appears in "Your chats"
    if (conversationId) {
        // await hideConversationWithRetry(conversationId, accessToken);
    }
    
    return fullText;
}

// Hide conversation with delay and retries so it reliably disappears from sidebar
async function hideConversationWithRetry(conversationId, accessToken) {
    const delay = (ms) => new Promise(r => setTimeout(r, ms));
    const maxAttempts = 1;
    const delayBeforeFirst = 500;  // Server may need a moment to persist the conversation
    await delay(delayBeforeFirst);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const res = await fetch(`${CHATGPT_BASE_URL}/backend-api/conversation/${conversationId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: getChatGPTHeaders(accessToken),
        body: JSON.stringify({ is_visible: false })
    });
            if (res.ok) return;
            if (res.status === 404 && attempt < maxAttempts) {
                await delay(400 * attempt);
                continue;
            }
        } catch (e) {
            if (attempt < maxAttempts) await delay(400 * attempt);
        }
    }
}

// Delete conversation (fresh device ID per request) - kept for compatibility
async function deleteConversation(conversationId, accessToken) {
    await hideConversationWithRetry(conversationId, accessToken);
}

// Strip ChatGPT citation markers - multiple formats (E200-E202, tether/source, turn0 refs)
function stripCitationMarkers(text) {
    if (!text) return '';
    const normalizeEntityMarker = (match, markerType, markerPayload) => {
        const type = String(markerType).trim().toLowerCase();
        const label = value => String(value).replace(/\\([!-\/:-@\[-`{-~])/g, '$1').replace(/[\\`*_[\]<>|]/g, '\\$&');
        if (type === 'url') {
            const [text, destination] = markerPayload.split('\uE202');
            try {
                const url = new URL(destination);
                if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return label(text);
                const href = url.href.replace(/[\s()<>]/g, ch => encodeURIComponent(ch).replace(/\(/g, '%28').replace(/\)/g, '%29'));
                return `[${label(text || destination)}](${href})`;
            } catch (_) { return label(text); }
        }
        if (type !== 'entity') return '';
        try {
            const parsed = JSON.parse(markerPayload);
            if (Array.isArray(parsed)) {
                const preferred = parsed.find((value, index) => index > 0 && typeof value === 'string' && value.trim());
                if (preferred) return label(preferred.trim());
            }
        } catch (_) {}
        return '';
    };
    return text
        .replace(/\uE200image_group\uE202([^\uE201]*)\uE201/g, (_marker, payload) => {
            try {
                const queries = JSON.parse(payload)?.query;
                return Array.isArray(queries) && queries.length ? '<div class="sideai-image-placeholder" aria-hidden="true"></div>' : '';
            } catch (_) { return ''; }
        })
        .replace(/\uE200(?:cite|i|image|image_group)\uE202([^\uE201]*)\uE201/g, (marker, payload) => /turn\d+image\d+/.test(payload) ? 'Image loading…' : marker)
        .replace(/\uE200([^\uE202]+)\uE202([\s\S]*?)\uE201/g, normalizeEntityMarker) // preserve visible entity labels like movie titles
        .replace(/\uE200[\s\S]*?\uE201/g, '')   // cite/navlist blocks: E200...E201
        .replace(/[\uE200-\uE202]/g, '')        // any leftover private-use markers
        .replace(/\u3010\d+\u2020source\u3011/g, '')  // Gizmo tether: 〠6†source〠
        .replace(/\[cite\][^\]]*\[\]/g, '')     // fallback: literal [cite]...[]
        .replace(/\s*cite\s*turn0(news|search)\d+(\s*turn0(news|search)\d+)*\s*/gi, ' ')   // orphan cite+turn0 refs
        .replace(/\s*navlist[^\n]*turn0(news|search)\d+[^\n]*\n?/g, '');  // navlist lines
}

function stripGooglePromptEcho(text) {
    if (!text) return '';

    let cleaned = String(text).trimStart();

    // Some WebPilot/tool runs leak a leading search("...") trace into the answer.
    cleaned = cleaned.replace(/^search\(\s*"[\s\S]*?"\s*\)\s*/i, '');
    cleaned = cleaned.replace(/^search\(\s*'[\s\S]*?'\s*\)\s*/i, '');

    // Sometimes the model echoes our full instruction prompt before the real answer.
    const promptEchoPattern =
        /(?:Search the web for|Answer this Google search query):\s*"[\s\S]*?Important:\s*Respond in the same language as the search query above\.?\s*/i;
    cleaned = cleaned.replace(promptEchoPattern, '');

    // If a leading tool/prompt preamble still slipped through, drop everything before
    // the first obvious answer heading.
    const headingMatch = cleaned.match(/(?:^|\n)(Overview|Summary|Answer|Key Points|Main Points|Results)\b/i);
    if (/^(search\(|Search the web for:|Answer this Google search query:|Please provide a helpful, concise answer\.)/i.test(cleaned) && headingMatch && typeof headingMatch.index === 'number') {
        cleaned = cleaned.slice(headingMatch.index).trimStart();
    }

    return cleaned.trimStart();
}

// Native profile cards flatten to label + large heading in fallback Markdown.
// Group only consecutive short fact pairs; ordinary headings and code stay intact.
function formatFactBlocks(markdown) {
    const tokens = marked.lexer(markdown, {gfm:true, breaks:true});
    const escape = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    let output = '';
    for (let i = 0; i < tokens.length;) {
        const facts = [];
        let cursor = i;
        while (cursor < tokens.length) {
            const label = tokens[cursor];
            let next = cursor + 1;
            while (tokens[next]?.type === 'space') next++;
            const value = tokens[next];
            if (label?.type !== 'paragraph' || /[\n<>`*_[\]]/.test(label.text) || label.text.length > 48 ||
                value?.type !== 'heading' || value.depth > 2 || /[\n<>`*_[\]]/.test(value.text) || value.text.length > 80) break;
            facts.push({label:label.text, value:value.text});
            cursor = next + 1;
            while (tokens[cursor]?.type === 'space') cursor++;
        }
        if (facts.length >= 2 && facts.some(fact => /\p{N}/u.test(fact.value))) {
            output += '\n\n<dl class="sideai-facts">' + facts.map(fact => '<div><dt>' + escape(fact.label) + '</dt><dd>' + escape(fact.value) + '</dd></div>').join('') + '</dl>\n\n';
            i = cursor;
        } else { output += tokens[i].raw; i++; }
    }
    return output;
}

// Format markdown to HTML
function formatMarkdown(text) {
    // ChatGPT may escape a URL's colon; GFM autolinking otherwise keeps that slash in its label/href.
    const normalized = (text || '').split(/(```[\s\S]*?```|`[^`\n]*`)/g).map((part, index) => index % 2 ? part : part.replace(/\b(https?)\\:\/\//gi, '$1://')).join('');
    const clean = stripGooglePromptEcho(stripCitationMarkers(normalized));
    const safeHTML = DOMPurify.sanitize(marked.parse(formatFactBlocks(clean), {gfm:true,breaks:true}), {
        USE_PROFILES:{html:true}, FORBID_TAGS:['style','form','input','textarea','button','iframe','video','audio'],
        FORBID_ATTR:['style'], ALLOW_DATA_ATTR:false, ADD_ATTR:['data-sideai-image-fallbacks']
    });
    // Old/native UI link labels can already contain Markdown escapes. Decode text only,
    // after sanitizing, so a visible URL never contains protocol/dot escape characters.
    const template = document.createElement('template');
    template.innerHTML = safeHTML;
    for (const link of template.content.querySelectorAll('a')) {
        const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) if (!node.parentElement?.closest('code,pre')) node.data = node.data.replace(/\\([!-\/:-@\[-`{-~])/g, '$1');
    }
    return template.innerHTML;
}

function compactImageGroups(container) {
    container.querySelectorAll('p').forEach(paragraph => {
        const linkedImages = [...paragraph.children].filter(child =>
            child.matches('a[href]') && child.children.length === 1 && child.firstElementChild?.matches('img')
        );
        if (linkedImages.length < 1) return;

        const containsOnlyImagesAndBreaks = [...paragraph.childNodes].every(node => {
            if (node.nodeType === Node.TEXT_NODE) return !node.textContent.trim();
            return node.nodeType === Node.ELEMENT_NODE &&
                (node.matches('br') || linkedImages.includes(node));
        });
        if (!containsOnlyImagesAndBreaks) return;

        paragraph.classList.add('sideai-image-strip');
        paragraph.setAttribute('role', 'group');
        paragraph.setAttribute('aria-label', 'Related images');
        linkedImages.forEach(link => {
            const image = link.querySelector('img');
            if (!link.getAttribute('aria-label') && image?.alt) link.setAttribute('aria-label', image.alt);
        });
    });
}

// A stream is a succession of snapshots, not a sequence of new answer panels.
let pendingResponseText = null;
let responseRenderTimer = null;
let lastRenderedResponseText = null;
const sideAIImageStates = new WeakMap();
const sideAIImageSuccessCache = new Map();

function sameResponseIdentity(a, b) {
    if (!a || !b || a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) return false;
    if (a.isEqualNode(b)) return true;
    if (a.nodeType !== 1) return false;
    if (a.nodeName === 'IMG') return (sideAIImageStates.get(a)?.primary || a.getAttribute('src')) === (sideAIImageStates.get(b)?.primary || b.getAttribute('src'));
    if (a.nodeName === 'A') return a.getAttribute('href') === b.getAttribute('href');
    const oldText = a.textContent.trim(), nextText = b.textContent.trim();
    return oldText.length > 0 && (oldText === nextText || nextText.startsWith(oldText));
}

function syncResponseChildren(current, incoming) {
    let oldNode = current.firstChild;
    const nextNodes = [...incoming.childNodes];
    for (let index = 0; index < nextNodes.length; index++) {
        const nextNode = nextNodes[index];
        if (!oldNode) { current.append(nextNode); continue; }
        // Inserting images, citations or headings must not replace the blocks
        // following them. Match existing blocks across insertions and moves.
        if (!sameResponseIdentity(oldNode, nextNode)) {
            if (nextNodes.slice(index + 1).some(node => sameResponseIdentity(oldNode, node))) {
                current.insertBefore(nextNode, oldNode);
                continue;
            }
            let match = oldNode.nextSibling;
            while (match && !sameResponseIdentity(match, nextNode)) match = match.nextSibling;
            if (match) { current.insertBefore(match, oldNode); oldNode = match; }
        }
        const following = oldNode.nextSibling;
        const sameKind = oldNode.nodeType === nextNode.nodeType && oldNode.nodeName === nextNode.nodeName;
        const sameImage = oldNode.nodeName !== 'IMG' || sameResponseIdentity(oldNode, nextNode);
        if (!sameKind || !sameImage) oldNode.replaceWith(nextNode);
        else if (oldNode.nodeType === 3 || oldNode.nodeType === 8) {
            if (oldNode.nodeValue !== nextNode.nodeValue) oldNode.nodeValue = nextNode.nodeValue;
        } else if (!oldNode.isEqualNode(nextNode)) {
            if (oldNode.nodeName === 'IMG') {
                const existing = sideAIImageStates.get(oldNode), fresh = sideAIImageStates.get(nextNode);
                if (existing && fresh) for (const url of fresh.candidates) {
                    if (!existing.attempted.has(url) && !existing.candidates.includes(url)) existing.candidates.push(url);
                }
            }
            for (const attr of [...oldNode.attributes]) if (!nextNode.hasAttribute(attr.name)) oldNode.removeAttribute(attr.name);
            for (const attr of [...nextNode.attributes]) {
                // Retain the working source-host fallback during subsequent text
                // snapshots instead of restarting the failing proxy request.
                if (attr.name === 'src' && oldNode.nodeName === 'IMG' && sameImage && sideAIImageStates.has(oldNode)) continue;
                if (oldNode.getAttribute(attr.name) !== attr.value) oldNode.setAttribute(attr.name, attr.value);
            }
            syncResponseChildren(oldNode, nextNode);
        }
        oldNode = following;
    }
    while (oldNode) { const following = oldNode.nextSibling; oldNode.remove(); oldNode = following; }
}

function flushPendingResponse() {
    if (responseRenderTimer !== null) clearTimeout(responseRenderTimer);
    responseRenderTimer = null;
    const text = pendingResponseText;
    pendingResponseText = null;
    if (text !== null) renderResponseNow(text);
}

function cancelPendingResponse() {
    if (responseRenderTimer !== null) clearTimeout(responseRenderTimer);
    responseRenderTimer = null;
    pendingResponseText = null;
}

function updateResponse(text, done = false) {
    if (typeof text !== 'string') return;
    pendingResponseText = text;
    // Show the first text immediately and always flush the final snapshot.
    if (done || lastRenderedResponseText === null) { flushPendingResponse(); return; }
    if (responseRenderTimer === null) responseRenderTimer = setTimeout(flushPendingResponse, 80);
}

// Update response display
function renderResponseNow(text) {
    if (text === lastRenderedResponseText) return;
    lastRenderedResponseText = text;
    const scroller = responseEl.closest('.content') || responseEl;
    const previousScrollTop = scroller.scrollTop;
    const previousScrollLeft = scroller.scrollLeft;
    const scrollerTop = scroller.getBoundingClientRect().top;
    const scrollAnchor = previousScrollTop > 0
        ? [...responseEl.children].find(el => el.getBoundingClientRect().bottom > scrollerTop + 4) : null;
    const anchorOffset = scrollAnchor?.getBoundingClientRect().top;
    const horizontalScroll = new Map([...responseEl.querySelectorAll('.sideai-table-scroll,.sideai-image-strip')].map(el => [el, el.scrollLeft]));
    // Parse and decorate offscreen, then preserve matching live nodes.
    const template = document.createElement('template');
    template.innerHTML = formatMarkdown(text);
    const nextResponse = template.content;
    loadingEl.style.display = 'none';
    nextResponse.querySelectorAll('a[href]').forEach(link => {
        try { const url=new URL(link.getAttribute('href')); if(!['https:','http:'].includes(url.protocol)) {link.removeAttribute('href');return;} link.target='_blank';link.rel='noopener noreferrer'; }
        catch (_) { link.removeAttribute('href'); }
    });
    compactImageGroups(nextResponse);
    nextResponse.querySelectorAll('img').forEach((image, index) => {
        if(!/^https?:\/\//i.test(image.getAttribute('src') || '')) {image.replaceWith(document.createTextNode(image.alt || 'Image'));return;}
        // Answer galleries should be ready when scrolled into view; prioritize the
        // first image but start every answer thumbnail without a lazy-load gate.
        image.loading = 'eager';
        if (index === 0) image.fetchPriority = 'high';
        image.decoding = 'async';
        image.referrerPolicy = 'no-referrer';
        const primary = image.getAttribute('src');
        let candidates = [];
        try {
            const supplied = JSON.parse(image.getAttribute('data-sideai-image-fallbacks') || '[]');
            if (Array.isArray(supplied)) candidates = [...new Set(supplied.filter(url => typeof url === 'string' && /^https?:\/\//i.test(url) && url !== primary))].slice(0, 3);
        } catch (_) {}
        const state = {primary, candidates, attempted:new Set([primary])};
        sideAIImageStates.set(image, state);
        const cached = sideAIImageSuccessCache.get(primary);
        if (cached) { state.attempted.add(cached); image.src = cached; }
        image.addEventListener('error', () => {
            const alternative = state.candidates.find(url => !state.attempted.has(url));
            if (alternative) { state.attempted.add(alternative); image.src = alternative; return; }
            if (image.closest('a[href]')) {
                image.replaceWith(document.createTextNode('View image: ' + (image.alt || 'Image')));
                notifyParentHeightSoon();
                return;
            }
            const fallback = document.createElement('a');
            fallback.href = image.src;
            fallback.target = '_blank';
            fallback.rel = 'noopener noreferrer';
            fallback.textContent = 'Open image: ' + (image.alt || 'Image unavailable');
            image.replaceWith(fallback);
            notifyParentHeightSoon();
        });
        image.addEventListener('load', () => {
            sideAIImageSuccessCache.set(primary, image.src);
            if (sideAIImageSuccessCache.size > 128) sideAIImageSuccessCache.delete(sideAIImageSuccessCache.keys().next().value);
            notifyParentHeightSoon();
        }, {once:true});
    });
    nextResponse.querySelectorAll('table').forEach(table=>{const wrap=document.createElement('div');wrap.className='sideai-table-scroll';table.replaceWith(wrap);wrap.append(table);});
    nextResponse.querySelectorAll('a.sideai-citation[href],a.sideai-source-card[href]').forEach(link=>{
        const icon=document.createElement('img');
        icon.className='sideai-favicon';icon.alt='';icon.setAttribute('aria-hidden','true');
        icon.width=16;icon.height=16;icon.loading='lazy';icon.referrerPolicy='no-referrer';
        icon.src='https://www.google.com/s2/favicons?domain='+encodeURIComponent(new URL(link.href).hostname)+'&sz=32';
        icon.addEventListener('error',()=>icon.remove(),{once:true});
        link.prepend(icon);
    });
    syncResponseChildren(responseEl, nextResponse);
    scroller.scrollTop = previousScrollTop;
    if (scrollAnchor?.isConnected) {
        scroller.scrollTop += scrollAnchor.getBoundingClientRect().top - anchorOffset;
    }
    scroller.scrollLeft = previousScrollLeft;
    horizontalScroll.forEach((left, el) => { if (el.isConnected) el.scrollLeft = left; });
    responseEl.classList.add('active');
    notifyParentHeightSoon();
    logFrameProgress(window.__aiextCurrentGoogleRequestId || 'google-frame-no-id', 'stream.googleFrameRendered', {
        textLength: typeof text === 'string' ? text.length : 0,
        htmlLength: responseEl.innerHTML.length,
        visibleTextLength: responseEl.textContent.length,
        scrollHeight: responseEl.scrollHeight,
        clientHeight: responseEl.clientHeight,
        textTail: debugTail(text || '')
    });
}

// Show error
function showError(message) {
    cancelPendingResponse();
    loadingEl.style.display = 'none';
    stopBtn.style.display = 'none';

    const msg = String(message || '');
    const lowerMsg = msg.toLowerCase();
    const isAuthError =
        lowerMsg.includes('login') ||
        lowerMsg.includes('no access token') ||
        lowerMsg.includes('failed to get chat requirements') ||
        lowerMsg.includes('401');

    if (isAuthError) {
        errorEl.innerHTML = `<a href="https://chatgpt.com" target="_blank">Please login to ChatGPT first</a> to use this feature.`;
    } else if (/message channel closed|message port closed|extension context invalidated/i.test(msg)) {
        errorEl.textContent = 'The extension connection was interrupted. Refresh this page and try again.';
    } else if (msg.includes('403')) {
        errorEl.innerHTML = `Request blocked. <a href="https://chatgpt.com" target="_blank">Please open ChatGPT</a> and try again.`;
    } else {
        errorEl.textContent = msg;
    }
    errorEl.style.display = 'block';
    notifyParentHeightSoon();
}

// Show daily limit error inline inside the sidebar
function showLimitError(resetTime) {
    cancelPendingResponse();
    loadingEl.style.display = 'none';
    stopBtn.style.display = 'none';
    responseEl.innerHTML = '';
    responseEl.classList.remove('active');

    const resetStr = resetTime ? new Date(resetTime).toLocaleString() : 'midnight';
    errorEl.innerHTML = `
        <div class="limit-error-content">
            <strong>Daily limit reached</strong>
            <span>You've used all your free daily uses.</span>
            <span class="limit-reset">Resets at: ${resetStr}</span>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
                <button class="limit-upgrade-btn" id="limit-manage-btn">Manage usage</button>
                <button class="limit-upgrade-btn secondary" id="limit-upgrade-btn">Upgrade to Pro</button>
            </div>
        </div>
    `;
    errorEl.style.display = 'block';
    notifyParentHeightSoon();

    // Manage usage -> open options page at Usage & License tab
    document.getElementById('limit-manage-btn')?.addEventListener('click', () => {
        try { chrome?.runtime?.sendMessage?.({ type: 'openOptions', section: 'usage' }); } catch (_) {}
    });
    // Upgrade -> show the full upgrade modal
    document.getElementById('limit-upgrade-btn')?.addEventListener('click', () => {
        try {
            if (chrome?.runtime?.sendMessage) chrome.runtime.sendMessage({ type: 'SHOW_UPGRADE_MODAL', resetTime }).catch(() => {});
        } catch (_) {}
    });
}

let sideAIGoogleRun = 0;
let sideAICancelGoogleRequest = null;

// Main function - uses background script for API calls
async function main() {
    const run = ++sideAIGoogleRun;
    sideAICancelGoogleRequest?.();
    cancelPendingResponse();
    if (!chrome?.runtime?.sendMessage) {
        showError('Extension context invalid - please refresh the page');
        return;
    }

    if (settingsBtn && !settingsBtn.dataset.bound) {
        settingsBtn.dataset.bound = '1';
        settingsBtn.addEventListener('click', () => {
            try {
                chrome.runtime.sendMessage({ type: 'openOptions', section: 'blocked-sites' });
            } catch (_) {}
        });
    }

    const { query, noBill } = getQueryFromHash();
    if (!query) {
        showError('No search query provided');
        return;
    }

    const usageCheck = await new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage({ type: 'checkGoogleSearchUsage' }, (r) => {
                resolve(r || { allowed: true });
            });
        } catch (_) {
            resolve({ allowed: false });
        }
    });
    if (run !== sideAIGoogleRun) return;
    if (!usageCheck.allowed) {
        showLimitError(usageCheck.resetTime);
        return;
    }
    
    console.log('[Frame] Processing query:', query);
    
    // Setup stop button
    stopBtn.style.display = 'block';
    stopBtn.onclick = () => {
        flushPendingResponse();
        sideAICancelGoogleRequest?.();
        try {
            if (chrome?.runtime?.sendMessage) chrome.runtime.sendMessage({ type: 'ABORT_CHATGPT_SEARCH', query: query });
        } catch (_) {}
        stopBtn.style.display = 'none';
        loadingEl.style.display = 'none';
        if (!responseEl.textContent) {
            showError('Response stopped by user');
        }
    };
    
    const prompt = buildGoogleSearchPrompt(query);
    
    try {
        await requestViaBackground(query, prompt, noBill);
        if (run !== sideAIGoogleRun) return;
        stopBtn.style.display = 'none';
    } catch (err) {
        if (run !== sideAIGoogleRun || err.name === 'AbortError') return;
        if (err.message === 'DAILY_LIMIT') return;
        console.error('[Frame] Request failed:', err);
        showError(err.message || 'Failed to get response');
    }
}

// Uses offscreen document (extension context) - hidden ChatGPT iframe, no tab required
async function requestViaBackground(query, prompt, noBill = false) {
    sideAICancelGoogleRequest?.();
    if (!chrome?.runtime?.sendMessage || !chrome?.runtime?.onMessage) {
        return Promise.reject(new Error('Extension context invalid - please refresh the page'));
    }
    return new Promise((resolve, reject) => {
        const requestId = 'gs-' + Date.now() + '-' + Math.random().toString(36).slice(2);
        window.__aiextCurrentGoogleRequestId = requestId;
        cancelPendingResponse();
        lastRenderedResponseText = null;
        let bestText = '';
        let timer;
        let settled = false;
        const deadline = Date.now() + 330000;
        const cleanup = () => {
            settled = true;
            if (sideAICancelGoogleRequest === cancelRequest) sideAICancelGoogleRequest = null;
            clearTimeout(timer);
            try { chrome.runtime.onMessage.removeListener(listener); } catch (_) {}
        };
        const armTimeout = ms => {
            if (settled) return;
            clearTimeout(timer);
            timer = setTimeout(() => {
                cleanup();
                reject(new Error('ChatGPT stopped responding. Please try again.'));
            }, Math.min(ms, Math.max(0, deadline - Date.now())));
        };
        const acceptGoogleText = (text, source, done = false) => {
            if (typeof text !== 'string' || !text) return bestText;
            // A delayed prefix is not a rewrite. Hold forward progress until
            // the stream catches up, while allowing the authoritative final.
            text = SideAIStreamText.stabilize(bestText, text, done);
            if (text === bestText && !done) return bestText;
            if (text !== bestText) armTimeout(75000);
            bestText = text;
            updateResponse(bestText, done);
            return bestText;
        };
        debugLog(requestId, 'STREAM', 'google-chatgpt-frame.js:requestViaBackground', 'stream.googleFrameRequestStart', {
            query,
            promptLength: typeof prompt === 'string' ? prompt.length : -1,
            noBill: !!noBill
        });
        const listener = (message) => {
            if (settled || window.__aiextCurrentGoogleRequestId !== requestId) return;
            if (message.type === 'CHATGPT_SEARCH_RESPONSE') {
                if (message.requestId !== requestId) return;
                if (message.error === 'DAILY_LIMIT') {
                    cleanup();
                    debugLog(requestId, 'STREAM', 'google-chatgpt-frame.js:listener', 'stream.googleFrameLimit', {
                        resetTime: message.resetTime || null
                    });
                    showLimitError(message.resetTime);
                    reject(new Error('DAILY_LIMIT'));
                    return;
                }
                if (message.error) {
                    cleanup();
                    debugLog(requestId, 'STREAM', 'google-chatgpt-frame.js:listener', 'stream.googleFrameError', {
                        error: message.error,
                        textLength: typeof message.text === 'string' ? message.text.length : 0
                    });
                    reject(new Error(message.error));
                } else if (message.done) {
                    cleanup();
                    const finalText = acceptGoogleText(message.text, 'done', true);
                    logFrameProgress(requestId, 'stream.googleFrameDone', {
                        done: true,
                        textLength: finalText.length,
                        incomingTextLength: typeof message.text === 'string' ? message.text.length : 0,
                        textTail: debugTail(finalText)
                    });
                    resolve(finalText);
                } else if (message.text) {
                    logFrameProgress(requestId, 'stream.googleFrameChunk', {
                        text: message.text,
                        textLength: message.text.length,
                        textTail: debugTail(message.text)
                    });
                    acceptGoogleText(message.text, 'chunk', false);
                }
            }
        };
        const cancelRequest = () => {
            if (settled) return;
            cleanup();
            reject(Object.assign(new Error('Response cancelled'), { name: 'AbortError' }));
        };
        sideAICancelGoogleRequest = cancelRequest;
        armTimeout(150000);
        try { chrome.runtime.onMessage.addListener(listener); } catch (e) { cleanup(); reject(e); return; }
        try {
            chrome.runtime.sendMessage({ type: 'CHATGPT_SEARCH_QUERY', requestId, query, prompt, noBill }, () => {
                if (chrome?.runtime?.lastError) {
                    cleanup();
                    reject(new Error(chrome.runtime.lastError.message));
                }
            });
        } catch (e) {
            cleanup();
            reject(e);
            return;
        }

    });
}

function buildGoogleSearchPrompt(query, now = new Date()) {
    return `Answer this Google search query: ${JSON.stringify(query)}

Treat the query as the user's request and answer its likely intent directly. Start with the useful answer, without restating or defining the search phrase. Give a definition only when the user asks for a meaning or explanation.
For example, "latest news" means provide current headlines, "weather Paris" means the current forecast, and "Rebel Ridge story" means the film's plot. For broad news queries, give a concise selection of major current headlines with a short factual summary, dates and source links; do not substitute a directory of news websites or ask the user to pick a topic first.
Current request time: ${now.toISOString()}. Verify time-sensitive facts, news, prices, weather and recommendations using web search before answering. Distinguish publication dates from event dates. Never present recalled or invented headlines as current. If live information is unavailable, say that clearly and briefly.
Keep the answer focused and concise. Use readable Markdown, lists or tables when useful. Include relevant images when supported by actual image results, preserving image references and source citations. Do not output raw JSX, UI component code, internal tool traces or duplicate versions of the answer.
Include citations for sources actually used and clickable links to relevant official pages. Never invent sources, image URLs or other URLs.
Respond in the same language as the search query.`;
}

// Start when ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
} else {
    main();
}

// Listen for messages from parent window
window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'QUERY') {
        window.location.hash = encodeURIComponent(event.data.query);
        main();
    }
});

