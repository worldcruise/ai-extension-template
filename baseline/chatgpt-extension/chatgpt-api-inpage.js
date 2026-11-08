// ==========================
// CHATGPT API - MAIN WORLD (page context)
// Runs in page's JavaScript context so fetch() initiator = chatgpt.com (not extension)
// This matches the HAR: working requests come from chatgpt.com/cdn/assets/*.js
// ==========================
(function() {
'use strict';
const MSG_PREFIX = 'chatgpt-sidebar-ext-';

if (window.__chatgptSidebarInpageScriptLoaded) {
    return;
}
window.__chatgptSidebarInpageScriptLoaded = true;

function debugLog(runId, hypothesisId, location, message, data) {
}

function getTextTail(text, size = 180) {
    if (typeof text !== 'string') return '';
    return text.slice(Math.max(0, text.length - size));
}

function extractTextFromContentValue(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
        return value.map((part) => {
            if (typeof part === 'string') return part;
            if (part && typeof part.text === 'string') return part.text;
            if (part && typeof part.content === 'string') return part.content;
            if (part && part.content && typeof part.content === 'object') return extractTextFromContentValue(part.content);
            return '';
        }).join('');
    }
    if (value && typeof value === 'object') {
        if (typeof value.text === 'string') return value.text;
        if (typeof value.content === 'string') return value.content;
        if (Array.isArray(value.parts)) return extractTextFromContentValue(value.parts);
        if (value.content && typeof value.content === 'object') return extractTextFromContentValue(value.content);
    }
    return '';
}

// Intelligent UI uses JSX-like components in otherwise ordinary Markdown.
// Convert known presentation components to text/Markdown, never evaluate JSX.
// Keep fenced/inline code untouched so real programming answers remain usable.
function isJSONDocument(value) {
    if (typeof value !== 'string' || !/^\s*[\[{]/.test(value)) return false;
    try { const parsed = JSON.parse(value); return parsed !== null && typeof parsed === 'object'; }
    catch (_) { return false; }
}
function cleanResponseMarkup(value) {
    if (typeof value !== 'string' || !value) return '';
    // Structured replies are data: component-looking strings and JSON escapes
    // must survive the presentation converter unchanged.
    if (isJSONDocument(value)) return value;
    const uiNames = new Set(['entity','cite','box','row','column','grid','stack','text','title','heading','subtitle','caption','badge','card','section','group','divider','spacer','asyncimage','asyncimagegroup','image','icon','button','link']);
    const attribute = (tag, name) => {
        const match = tag.match(new RegExp('\\b' + name + '\\s*=\\s*("(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\')'));
        if (!match) return '';
        if (match[1][0] === '"') { try { return JSON.parse(match[1]); } catch (_) {} }
        return match[1].slice(1, -1).replace(/\\(['"\\])/g, '$1');
    };
    const literal = text => String(text).replace(/\\([!-\/:-@\[-`{-~])/g, '$1').replace(/[\\`*_[\]<>|]/g, '\\$&');
    const markdownLink = (label, target) => {
        const text = literal(label || target || 'Open link');
        try {
            const url = new URL(String(target));
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return text;
            const href = url.href.replace(/[\s()<>]/g, ch => encodeURIComponent(ch).replace(/\(/g, '%28').replace(/\)/g, '%29'));
            return `[${text}](${href})`;
        } catch (_) { return text; }
    };
    const linkStack = [];
    const codeSamples = [];
    const protectCode = text => { const index = codeSamples.push(text) - 1; return `\x00SIDEAI_CODE_${index}\x00`; };
    let output = '', position = 0, foundUI = false;
    while (position < value.length) {
        const rest = value.slice(position);
        // A code fence is opaque, including a partially streamed code block.
        const fence = (position === 0 || value[position - 1] === '\n') && rest.match(/^[ \t]*(`{3,}|~{3,})[^\n]*(?:\n|$)/);
        if (fence) {
            const endPattern = new RegExp('\\n[ \\t]*' + fence[1][0] + '{' + fence[1].length + ',}[ \\t]*(?=\\n|$)', 'g');
            endPattern.lastIndex = position + fence[0].length;
            const end = endPattern.exec(value);
            const until = end ? end.index + end[0].length : value.length;
            output += protectCode(value.slice(position, until)); position = until; continue;
        }
        if (value[position] === '`') {
            const ticks = rest.match(/^`+/)[0];
            const end = value.indexOf(ticks, position + ticks.length);
            const until = end < 0 ? value.length : end + ticks.length;
            output += protectCode(value.slice(position, until)); position = until; continue;
        }
        if (value[position] === '<') {
            const head = rest.match(/^<\s*(\/?)\s*([A-Za-z][\w.-]*)\b/);
            if (head && (uiNames.has(head[2].toLowerCase()) || /^[A-Z]/.test(head[2]))) {
                foundUI = true;
                let end = position + head[0].length, quote = '', braces = 0;
                for (; end < value.length; end++) {
                    const char = value[end];
                    if (quote) { if (char === '\\') end++; else if (char === quote) quote = ''; }
                    else if (char === '"' || char === "'") quote = char;
                    else if (char === '{') braces++;
                    else if (char === '}') braces = Math.max(0, braces - 1);
                    else if (char === '>' && braces === 0) break;
                }
                if (end === value.length) break; // Hide unfinished component attributes.
                const tag = value.slice(position, end + 1), name = head[2].toLowerCase(), closing = !!head[1];
                const line = output.slice(output.lastIndexOf('\n') + 1);
                const inTable = /^\s*\|/.test(line);
                if (name === 'entity' && !closing) {
                    output += literal(attribute(tag, 'value') || attribute(tag, 'label') || attribute(tag, 'name'));
                } else if (name === 'link' || name === 'button') {
                    if (closing) {
                        const target = linkStack.pop();
                        if (target) output = output.slice(0, target.start) + markdownLink(output.slice(target.start), target.url);
                    } else {
                        const label = attribute(tag, 'title') || attribute(tag, 'label') || attribute(tag, 'text');
                        const url = attribute(tag, 'url') || attribute(tag, 'href');
                        if (/\/\s*>$/.test(tag)) output += markdownLink(label, url);
                        else linkStack.push({start: output.length, end: output.length, url});
                    }
                } else if (name === 'title' || name === 'heading') {
                    output += inTable ? '' : closing ? '\n\n' : '\n\n### ';
                } else if (name === 'divider') {
                    output += '\n\n---\n\n';
                } else if (['text','subtitle','caption'].includes(name)) {
                    output += inTable ? '' : '\n\n';
                } else if (['box','row','column','grid','stack','card','section','group'].includes(name)) {
                    output += inTable ? '' : '\n';
                } else if ((name === 'image' || name === 'asyncimage' || name === 'asyncimagegroup') && !closing) {
                    const src = attribute(tag, 'src') || attribute(tag, 'url');
                    if (/^https?:\/\//i.test(src)) output += `![${literal(attribute(tag, 'alt') || 'Image')}](${src.replace(/[\s()<>]/g, ch => encodeURIComponent(ch).replace(/\(/g, '%28').replace(/\)/g, '%29'))})`;
                    else {
                        // Some accounts supply component markup before (or without)
                        // fallback Markdown. Keep a slot for its resolved image data.
                        let queries = [];
                        const query = attribute(tag, 'query');
                        if (query) queries = [query];
                        else {
                            try { const value = JSON.parse(tag.match(/\bquery\s*=\s*\{(\[[\s\S]*?\])\}/)?.[1] || '[]'); if (Array.isArray(value)) queries = value.filter(item => typeof item === 'string'); } catch (_) {}
                        }
                        if (queries.length) output += '\uE200image_group\uE202' + JSON.stringify({query:queries}) + '\uE201';
                    }
                }
                position = end + 1; continue;
            }
            // A component name itself may arrive across chunks (<Ent, <tit...).
            if (/^<\/?[A-Za-z]*$/.test(rest) && [...uiNames].some(name => name.startsWith(rest.replace(/^<\/?/, '').toLowerCase()))) break;
        }
        // JSX layout indentation is not a Markdown code block.
        if (foundUI && (position === 0 || value[position - 1] === '\n') && /^[ \t]+/.test(rest)) {
            position += rest.match(/^[ \t]+/)[0].length; continue;
        }
        output += value[position++];
    }
    const clean = foundUI ? output.replace(/\n[ \t]+\n/g, '\n\n').replace(/\n{3,}/g, '\n\n').trim() : output;
    const linked = clean.replace(/\uE200url\uE202([^\uE201]*)\uE201/g, (_marker, payload) => {
        const parts = payload.split('\uE202');
        return markdownLink(parts[0], parts.slice(1).join('\uE202'));
    }).replace(/\uE200url(?:\uE202[^\uE201]*)?$/, '');
    return linked.replace(/\x00SIDEAI_CODE_(\d+)\x00/g, (marker, index) => codeSamples[Number(index)] ?? marker);
}

function looksLikeHiddenToolCallText(text) {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trim();
    if (!trimmed) return false;
    return /^(search|open_url|open|click|quote|mclick|msearch|browser\.\w+|web\.\w+|python|image_gen|canmore\.\w+)\s*\(/i.test(trimmed);
}

function isUserVisibleAssistantMessage(message) {
    if (!message || typeof message !== 'object') return false;
    if (message.author?.role !== 'assistant') return false;
    // Multiplexed streams include hidden fragments beside the merged answer.
    // A fragment is never a replacement for the complete visible message.
    if (message.metadata?.is_message_fragment || message.metadata?.is_visually_hidden_from_conversation) return false;
    const contentType = message.content?.content_type || null;
    const recipient = message.recipient || null;

    if (contentType && !['text', 'multimodal_text'].includes(contentType)) return false;
    if (recipient && recipient !== 'all') return false;
    if (['analysis', 'justify', 'confidence'].includes(message.channel)) return false;
    if (looksLikeHiddenToolCallText(extractTextFromContentValue(message.content || message))) return false;
    return true;
}

function extractAssistantMessageText(message) {
    if (!message || typeof message !== 'object') return '';
    if (!isUserVisibleAssistantMessage(message)) return '';
    return readableAssistantText(message);
}

function readableAssistantText(message) {
    const raw = extractTextFromContentValue(message.content || message);
    // Native fallbackMarkdown escapes JSON arrays and punctuation for display.
    // The original complete JSON is the machine-readable answer.
    if (isJSONDocument(raw)) return raw;
    const presentation = message.metadata?.model_dil_v2;
    const markdown = presentation?.fallbackMarkdown;
    if (typeof markdown !== 'string' || !markdown.trim()) return raw;
    // The native UI compiler can leave fallbackMarkdown at an earlier complete
    // block while the actual answer keeps arriving (or a component fails to
    // compile). Stream the safely converted content during that interval.
    if (presentation.recoveryDiagnostics?.length) {
        const converted = cleanResponseMarkup(raw);
        if (converted.length > cleanResponseMarkup(markdown).length) return converted;
    }
    return markdown;
}

function hasPendingSideAIImages(message) {
    const metadata = message?.metadata;
    const results = metadata?.model_dil_v2?.appData?.opGenui?.componentResults || {};
    return (Array.isArray(metadata?.genui_components) ? metadata.genui_components : []).some(component => {
        if (!component || !['async_image', 'async_image_group'].includes(component.type)) return false;
        const result = results[component.component_resolution_id];
        if (result?.state?.is_loading === false || ['error', 'failed', 'cancelled'].includes(result?.status)) return false;
        return !Array.isArray(result?.state?.images) || !result.state.images.length || result.state.is_loading === true;
    });
}

function extractConversationFinalText(payload) {
    if (!payload || typeof payload !== 'object') return '';

    const mapping = payload.mapping && typeof payload.mapping === 'object' ? payload.mapping : null;
    if (mapping) {
        let nodeId = payload.current_node || payload.current_node_id || null;
        const seen = new Set();
        while (nodeId && mapping[nodeId] && !seen.has(nodeId)) {
            seen.add(nodeId);
            const node = mapping[nodeId];
            const text = extractAssistantMessageText(node.message);
            if (text) return text;
            nodeId = node.parent || null;
        }

        const candidates = Object.values(mapping)
            .map((node) => ({
                text: extractAssistantMessageText(node?.message),
                createTime: Number(node?.message?.create_time || 0)
            }))
            .filter((candidate) => candidate.text);
        candidates.sort((a, b) => {
            if (a.createTime !== b.createTime) return b.createTime - a.createTime;
            return b.text.length - a.text.length;
        });
        if (candidates[0]?.text) return candidates[0].text;
    }

    return (
        extractAssistantMessageText(payload.message) ||
        extractAssistantMessageText(payload.v?.message) ||
        ''
    );
}

async function fetchConversationFinalText(conversationId, accessToken, reqId, options = {}) {
    if (!conversationId || !accessToken) return '';
    const BASE = location.origin;
    const url = BASE + '/backend-api/conversation/' + encodeURIComponent(conversationId);
    const maxAttempts = Math.max(1, Number(options.maxAttempts || 3));
    const retryDelayMs = typeof options.retryDelayMs === 'number' ? options.retryDelayMs : 250;
    const quiet = !!options.quiet;
    const debugSource = options.source || 'final';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (options.signal?.aborted) return '';
        if (attempt > 1) await delay(retryDelayMs * attempt);
        try {
            const res = await fetch(url, {
                method: 'GET',
                signal: options.signal,
                credentials: 'include',
                priority: 'low',
                headers: getHeaders(accessToken, { 'accept': 'application/json' })
            });
            if (!res.ok) {
                if (!quiet) {
                    debugLog(reqId || 'no-req-id', 'STREAM', 'chatgpt-api-inpage.js:fetchConversationFinalText', 'stream.finalFetchFailed', {
                        attempt,
                        source: debugSource,
                        status: res.status,
                        statusText: res.statusText || null
                    });
                }
                continue;
            }
            const payload = await res.json();
            if (options.signal?.aborted) return '';
            const text = extractConversationFinalText(payload);
            if (text && reqId) {
                const message = payload?.mapping && Object.values(payload.mapping)
                    .map(node => node?.message)
                    .find(candidate => extractAssistantMessageText(candidate) === text) ||
                    payload?.message || payload?.v?.message;
                if (message) {
                    collectSideAIImageGroups(message, reqId);
                    collectSideAISources(message, reqId);
                    // A finished text message may still have image jobs running.
                    // Keep reading their patches instead of cancelling the stream.
                    if (message.status === 'finished_successfully' && message.end_turn === true &&
                        (!message.channel || message.channel === 'final') && !hasPendingSideAIImages(message)) options.onComplete?.(text);
                }
            }
            if (!quiet) {
                debugLog(reqId || 'no-req-id', 'STREAM', 'chatgpt-api-inpage.js:fetchConversationFinalText', 'stream.finalFetchParsed', {
                    attempt,
                    source: debugSource,
                    textLength: text.length,
                    textTail: getTextTail(text),
                    mappingNodeCount: payload?.mapping && typeof payload.mapping === 'object' ? Object.keys(payload.mapping).length : 0,
                    currentNodePresent: !!(payload?.current_node || payload?.current_node_id)
                });
            }
            if (text) return text;
        } catch (e) {
            if (!quiet) {
                debugLog(reqId || 'no-req-id', 'STREAM', 'chatgpt-api-inpage.js:fetchConversationFinalText', 'stream.finalFetchError', {
                    attempt,
                    source: debugSource,
                    error: e?.message || 'unknown'
                });
            }
        }
    }
    return '';
}

function looksLikePartialTail(text) {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trimStart();
    if (!trimmed) return false;
    if (/^(yes|no|ok|okay|sure|hello|hi)\b/i.test(trimmed)) return false;
    if (/^\s/.test(text) && text.length < 300) return true;
    if (/^[-–—,.;:!?)]/.test(trimmed) && text.length < 300) return true;
    if (/^(cite|turn\d|search\d|news\d)\b/i.test(trimmed)) return true;
    if (/\bdo you want me to do that\??$/i.test(trimmed) && text.length < 320) return true;
    if (/^[a-zà-ÿ]/.test(trimmed) && text.length < 220) {
        return !/^(a|an|the)\s+\w+(\s+\w+){0,5}\s+(is|are|was|were|means|refers|can|could|will|would|has|have)\b/i.test(trimmed);
    }
    return false;
}

function looksLikeAnswerEndingFragment(text) {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trimStart();
    if (!trimmed) return false;
    if (/^[-–—,.;:!?)]/.test(trimmed) && text.length < 300) return true;
    return (
        text.length < 420 &&
        /\b(do you want me|for quick reference|quick viewing|for a more|more nuanced view|balanced perspective|ranked by|shortlist|shorter version|must-watch version)\b/i.test(trimmed)
    );
}

function shouldRecoverFinalText(result) {
    const text = result?.fullText || '';
    if (!result?.conversationId) return false;
    if (result.transport === 'legacy') return true;
    if (looksLikeHiddenToolCallText(text)) return true;
    const trimmed = text.trimStart();
    if (looksLikePartialTail(text)) return true;
    if (/^\s/.test(text) && text.length < 300) return true;
    if (text.length < 40 && /[)"'”\]]?[.!?。؟]\s*$/.test(trimmed) && !/^(yes|no|ok|okay|sure|hello|hi)\b/i.test(trimmed)) return true;
    if (!/[.!?。؟]\s*$/.test(text) && text.length < 200) return true;
    return false;
}

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function getDeviceId() {
    const key = 'oai_device_id';
    let id = sessionStorage.getItem(key);
    if (!id) {
        id = generateUUID();
        sessionStorage.setItem(key, id);
    }
    return id;
}

function getClientHeaders() {
    const html = document.documentElement;
    const build = html?.dataset?.build || 'prod-734fcc9bfeb838be6b9afcf7ee718df6bf864727';
    const seq = html?.dataset?.seq || '5050894';
    return { 'oai-client-build-number': seq, 'oai-client-version': build };
}

function getNavigatorInfo() {
    const nav = navigator;
    return { userAgent: nav.userAgent, language: nav.language || 'en-US', languages: nav.languages ? [...nav.languages] : ['en-US', 'en'] };
}

function generatePParameter() {
    const navInfo = getNavigatorInfo();
    const now = new Date();
    const navigatorProps = ['appName-Netscape', 'storageBuckets-[object StorageBucketManager]', 'login-[object NavigatorLogin]'];
    const reactSuffix = () => { let s = ''; const c = 'abcdefghijklmnopqrstuvwxyz0123456789'; for (let i = 0; i < 11; i++) s += c[Math.floor(Math.random() * c.length)]; return s; };
    const functionNames = ['ondevicemotion', 'onemptied', 'onloadedmetadata'];
    const fingerprintArray = [11982, now.toString(), Math.floor(Math.random() * 9999999999), Math.floor(Math.random() * 50), navInfo.userAgent, null, null, navInfo.language, navInfo.languages.join(','), Math.floor(Math.random() * 30), navigatorProps[Math.floor(Math.random() * navigatorProps.length)], '_reactListening' + reactSuffix(), functionNames[Math.floor(Math.random() * functionNames.length)], performance.now(), ''];
    const jsonStr = JSON.stringify(fingerprintArray);
    const prefixByte = 0x96;
    const prefix = new Uint8Array([0x80, 0x00, 0x00, 0x00, 0x00, prefixByte]);
    const jsonBytes = new TextEncoder().encode(jsonStr);
    const combined = new Uint8Array(prefix.length + jsonBytes.length);
    combined.set(prefix);
    combined.set(jsonBytes, prefix.length);
    let binary = '';
    for (let i = 0; i < combined.length; i++) binary += String.fromCharCode(combined[i]);
    return btoa(binary);
}

function encodeToken(dataArray, isProofToken) {
    const jsonStr = JSON.stringify(dataArray);
    const prefixByte = isProofToken ? 0x56 : 0x96;
    const prefix = new Uint8Array([0x80, 0x00, 0x00, 0x00, 0x00, prefixByte]);
    const jsonBytes = new TextEncoder().encode(jsonStr);
    const combined = new Uint8Array(prefix.length + jsonBytes.length);
    combined.set(prefix);
    combined.set(jsonBytes, prefix.length);
    let binary = '';
    for (let i = 0; i < combined.length; i++) binary += String.fromCharCode(combined[i]);
    return btoa(binary);
}

const jsSha3 = (function() {
    'use strict';
    const HEX_CHARS = '0123456789abcdef'.split('');
    const SHA3_PADDING = [6, 1536, 393216, 100663296];
    const SHIFT = [0, 8, 16, 24];
    const RC = [1, 0, 32898, 0, 32906, 2147483648, 2147516416, 2147483648, 32907, 0, 2147483649, 0, 2147516545, 2147483648, 32777, 2147483648, 138, 0, 136, 0, 2147516425, 0, 2147483658, 0, 2147516555, 0, 139, 2147483648, 32905, 2147483648, 32771, 2147483648, 32770, 2147483648, 128, 2147483648, 32778, 0, 2147483658, 2147483648, 2147516545, 2147483648, 32896, 2147483648, 2147483649, 0, 2147516424, 2147483648];
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
        for (let i = 0; i < 50; ++i) this.s[i] = 0;
    }
    Keccak.prototype.update = function(message) {
        if (this.finalized) return;
        let isString = typeof message === 'string';
        let blocks = this.blocks, byteCount = this.byteCount, length = message.length, blockCount = this.blockCount, index = 0, s = this.s, i, code;
        while (index < length) {
            if (this.reset) {
                this.reset = false;
                blocks[0] = this.block;
                for (i = 1; i < blockCount + 1; ++i) blocks[i] = 0;
            }
            if (isString) {
                for (i = this.start; index < length && i < byteCount; ++index) {
                    code = message.charCodeAt(index);
                    if (code < 0x80) blocks[i >> 2] |= code << SHIFT[i++ & 3];
                    else if (code < 0x800) {
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
                for (i = this.start; index < length && i < byteCount; ++index)
                    blocks[i >> 2] |= message[index] << SHIFT[i++ & 3];
            }
            this.lastByteIndex = i;
            if (i >= byteCount) {
                this.start = i - byteCount;
                this.block = blocks[blockCount];
                for (i = 0; i < blockCount; ++i) s[i] ^= blocks[i];
                keccakF(s);
                this.reset = true;
            } else this.start = i;
        }
        return this;
    };
    Keccak.prototype.finalize = function() {
        if (this.finalized) return;
        this.finalized = true;
        let blocks = this.blocks, i = this.lastByteIndex, blockCount = this.blockCount, s = this.s;
        blocks[i >> 2] |= SHA3_PADDING[i & 3];
        if (this.lastByteIndex === this.byteCount) {
            blocks[0] = blocks[blockCount];
            for (i = 1; i < blockCount + 1; ++i) blocks[i] = 0;
        }
        blocks[blockCount - 1] |= 0x80000000;
        for (i = 0; i < blockCount; ++i) s[i] ^= blocks[i];
        keccakF(s);
    };
    Keccak.prototype.hex = function() {
        this.finalize();
        let blockCount = this.blockCount, s = this.s, outputBlocks = this.outputBlocks, extraBytes = this.extraBytes, i = 0, j = 0, hex = '', block;
        while (j < outputBlocks) {
            for (i = 0; i < blockCount && j < outputBlocks; ++i, ++j) {
                block = s[i];
                hex += HEX_CHARS[(block >> 4) & 0x0F] + HEX_CHARS[block & 0x0F] + HEX_CHARS[(block >> 12) & 0x0F] + HEX_CHARS[(block >> 8) & 0x0F] + HEX_CHARS[(block >> 20) & 0x0F] + HEX_CHARS[(block >> 16) & 0x0F] + HEX_CHARS[(block >> 28) & 0x0F] + HEX_CHARS[(block >> 24) & 0x0F];
            }
            if (j % blockCount === 0) { keccakF(s); i = 0; }
        }
        if (extraBytes) {
            block = s[i];
            hex += HEX_CHARS[(block >> 4) & 0x0F] + HEX_CHARS[block & 0x0F];
            if (extraBytes > 1) hex += HEX_CHARS[(block >> 12) & 0x0F] + HEX_CHARS[(block >> 8) & 0x0F];
            if (extraBytes > 2) hex += HEX_CHARS[(block >> 20) & 0x0F] + HEX_CHARS[(block >> 16) & 0x0F];
        }
        return hex;
    };
    function keccakF(s) {
        let h, l, n, c0, c1, c2, c3, c4, c5, c6, c7, c8, c9, b0, b1, b2, b3, b4, b5, b6, b7, b8, b9, b10, b11, b12, b13, b14, b15, b16, b17, b18, b19, b20, b21, b22, b23, b24, b25, b26, b27, b28, b29, b30, b31, b32, b33, b34, b35, b36, b37, b38, b39, b40, b41, b42, b43, b44, b45, b46, b47, b48, b49;
        for (n = 0; n < 48; n += 2) {
            c0 = s[0] ^ s[10] ^ s[20] ^ s[30] ^ s[40]; c1 = s[1] ^ s[11] ^ s[21] ^ s[31] ^ s[41]; c2 = s[2] ^ s[12] ^ s[22] ^ s[32] ^ s[42]; c3 = s[3] ^ s[13] ^ s[23] ^ s[33] ^ s[43]; c4 = s[4] ^ s[14] ^ s[24] ^ s[34] ^ s[44]; c5 = s[5] ^ s[15] ^ s[25] ^ s[35] ^ s[45]; c6 = s[6] ^ s[16] ^ s[26] ^ s[36] ^ s[46]; c7 = s[7] ^ s[17] ^ s[27] ^ s[37] ^ s[47]; c8 = s[8] ^ s[18] ^ s[28] ^ s[38] ^ s[48]; c9 = s[9] ^ s[19] ^ s[29] ^ s[39] ^ s[49];
            h = c8 ^ ((c2 << 1) | (c3 >>> 31)); l = c9 ^ ((c3 << 1) | (c2 >>> 31));
            s[0] ^= h; s[1] ^= l; s[10] ^= h; s[11] ^= l; s[20] ^= h; s[21] ^= l; s[30] ^= h; s[31] ^= l; s[40] ^= h; s[41] ^= l;
            h = c0 ^ ((c4 << 1) | (c5 >>> 31)); l = c1 ^ ((c5 << 1) | (c4 >>> 31));
            s[2] ^= h; s[3] ^= l; s[12] ^= h; s[13] ^= l; s[22] ^= h; s[23] ^= l; s[32] ^= h; s[33] ^= l; s[42] ^= h; s[43] ^= l;
            h = c2 ^ ((c6 << 1) | (c7 >>> 31)); l = c3 ^ ((c7 << 1) | (c6 >>> 31));
            s[4] ^= h; s[5] ^= l; s[14] ^= h; s[15] ^= l; s[24] ^= h; s[25] ^= l; s[34] ^= h; s[35] ^= l; s[44] ^= h; s[45] ^= l;
            h = c4 ^ ((c8 << 1) | (c9 >>> 31)); l = c5 ^ ((c9 << 1) | (c8 >>> 31));
            s[6] ^= h; s[7] ^= l; s[16] ^= h; s[17] ^= l; s[26] ^= h; s[27] ^= l; s[36] ^= h; s[37] ^= l; s[46] ^= h; s[47] ^= l;
            h = c6 ^ ((c0 << 1) | (c1 >>> 31)); l = c7 ^ ((c1 << 1) | (c0 >>> 31));
            s[8] ^= h; s[9] ^= l; s[18] ^= h; s[19] ^= l; s[28] ^= h; s[29] ^= l; s[38] ^= h; s[39] ^= l; s[48] ^= h; s[49] ^= l;
            b0 = s[0]; b1 = s[1]; b32 = (s[11] << 4) | (s[10] >>> 28); b33 = (s[10] << 4) | (s[11] >>> 28); b14 = (s[20] << 3) | (s[21] >>> 29); b15 = (s[21] << 3) | (s[20] >>> 29); b46 = (s[31] << 9) | (s[30] >>> 23); b47 = (s[30] << 9) | (s[31] >>> 23); b28 = (s[40] << 18) | (s[41] >>> 14); b29 = (s[41] << 18) | (s[40] >>> 14); b20 = (s[2] << 1) | (s[3] >>> 31); b21 = (s[3] << 1) | (s[2] >>> 31); b2 = (s[13] << 12) | (s[12] >>> 20); b3 = (s[12] << 12) | (s[13] >>> 20); b34 = (s[22] << 10) | (s[23] >>> 22); b35 = (s[23] << 10) | (s[22] >>> 22); b16 = (s[33] << 13) | (s[32] >>> 19); b17 = (s[32] << 13) | (s[33] >>> 19); b48 = (s[42] << 2) | (s[43] >>> 30); b49 = (s[43] << 2) | (s[42] >>> 30); b40 = (s[5] << 30) | (s[4] >>> 2); b41 = (s[4] << 30) | (s[5] >>> 2); b22 = (s[14] << 6) | (s[15] >>> 26); b23 = (s[15] << 6) | (s[14] >>> 26); b4 = (s[25] << 11) | (s[24] >>> 21); b5 = (s[24] << 11) | (s[25] >>> 21); b36 = (s[34] << 15) | (s[35] >>> 17); b37 = (s[35] << 15) | (s[34] >>> 17); b18 = (s[45] << 29) | (s[44] >>> 3); b19 = (s[44] << 29) | (s[45] >>> 3); b10 = (s[6] << 28) | (s[7] >>> 4); b11 = (s[7] << 28) | (s[6] >>> 4); b42 = (s[17] << 23) | (s[16] >>> 9); b43 = (s[16] << 23) | (s[17] >>> 9); b24 = (s[26] << 25) | (s[27] >>> 7); b25 = (s[27] << 25) | (s[26] >>> 7); b6 = (s[36] << 21) | (s[37] >>> 11); b7 = (s[37] << 21) | (s[36] >>> 11); b38 = (s[47] << 24) | (s[46] >>> 8); b39 = (s[46] << 24) | (s[47] >>> 8); b30 = (s[8] << 27) | (s[9] >>> 5); b31 = (s[9] << 27) | (s[8] >>> 5); b12 = (s[18] << 20) | (s[19] >>> 12); b13 = (s[19] << 20) | (s[18] >>> 12); b44 = (s[29] << 7) | (s[28] >>> 25); b45 = (s[28] << 7) | (s[29] >>> 25); b26 = (s[38] << 8) | (s[39] >>> 24); b27 = (s[39] << 8) | (s[38] >>> 24); b8 = (s[48] << 14) | (s[49] >>> 18); b9 = (s[49] << 14) | (s[48] >>> 18);
            s[0] = b0 ^ (~b2 & b4); s[1] = b1 ^ (~b3 & b5); s[10] = b10 ^ (~b12 & b14); s[11] = b11 ^ (~b13 & b15); s[20] = b20 ^ (~b22 & b24); s[21] = b21 ^ (~b23 & b25); s[30] = b30 ^ (~b32 & b34); s[31] = b31 ^ (~b33 & b35); s[40] = b40 ^ (~b42 & b44); s[41] = b41 ^ (~b43 & b45); s[2] = b2 ^ (~b4 & b6); s[3] = b3 ^ (~b5 & b7); s[12] = b12 ^ (~b14 & b16); s[13] = b13 ^ (~b15 & b17); s[22] = b22 ^ (~b24 & b26); s[23] = b23 ^ (~b25 & b27); s[32] = b32 ^ (~b34 & b36); s[33] = b33 ^ (~b35 & b37); s[42] = b42 ^ (~b44 & b46); s[43] = b43 ^ (~b45 & b47); s[4] = b4 ^ (~b6 & b8); s[5] = b5 ^ (~b7 & b9); s[14] = b14 ^ (~b16 & b18); s[15] = b15 ^ (~b17 & b19); s[24] = b24 ^ (~b26 & b28); s[25] = b25 ^ (~b27 & b29); s[34] = b34 ^ (~b36 & b38); s[35] = b35 ^ (~b37 & b39); s[44] = b44 ^ (~b46 & b48); s[45] = b45 ^ (~b47 & b49); s[6] = b6 ^ (~b8 & b0); s[7] = b7 ^ (~b9 & b1); s[16] = b16 ^ (~b18 & b10); s[17] = b17 ^ (~b19 & b11); s[26] = b26 ^ (~b28 & b20); s[27] = b27 ^ (~b29 & b21); s[36] = b36 ^ (~b38 & b30); s[37] = b37 ^ (~b39 & b31); s[46] = b46 ^ (~b48 & b40); s[47] = b47 ^ (~b49 & b41); s[8] = b8 ^ (~b0 & b2); s[9] = b9 ^ (~b1 & b3); s[18] = b18 ^ (~b10 & b12); s[19] = b19 ^ (~b11 & b13); s[28] = b28 ^ (~b20 & b22); s[29] = b29 ^ (~b21 & b23); s[38] = b38 ^ (~b30 & b32); s[39] = b39 ^ (~b31 & b33); s[48] = b48 ^ (~b40 & b42); s[49] = b49 ^ (~b41 & b43);
            s[0] ^= RC[n]; s[1] ^= RC[n + 1];
        }
    }
    return { sha3_512: function(m) { return new Keccak(512, SHA3_PADDING, 512).update(m).hex(); } };
})();

function solveProofOfWork(seed, difficulty) {
    const navInfo = getNavigatorInfo();
    const now = new Date();
    const perfNow = performance.now();
    const navigatorProps = ['appName-Netscape', 'storageBuckets-[object StorageBucketManager]', 'login-[object NavigatorLogin]'];
    const reactSuffix = () => { let s = ''; const c = 'abcdefghijklmnopqrstuvwxyz0123456789'; for (let i = 0; i < 11; i++) s += c[Math.floor(Math.random() * c.length)]; return s; };
    const functionNames = ['ondevicemotion', 'onemptied', 'onloadedmetadata'];
    const selectedProp = navigatorProps[Math.floor(Math.random() * navigatorProps.length)];
    const selectedFunc = functionNames[Math.floor(Math.random() * functionNames.length)];
    const reactStr = '_reactListening' + reactSuffix();
    const difficultyPrefix = difficulty || '000000';
    const difficultyLength = difficultyPrefix.length;
    for (let nonce = 0; nonce < 500000; nonce++) {
        const proofArray = [Math.floor(Math.random() * 99999), now.toString(), Math.floor(Math.random() * 9999999999), nonce, navInfo.userAgent, null, null, navInfo.language, navInfo.languages.join(','), Math.round(performance.now() - perfNow), selectedProp, reactStr, selectedFunc, perfNow, ''];
        const jsonStr = JSON.stringify(proofArray);
        const z = btoa(String.fromCharCode(...new TextEncoder().encode(jsonStr)));
        if (jsSha3.sha3_512(seed + z).substring(0, difficultyLength) <= difficultyPrefix) return 'gAAAAAB' + z;
    }
    const fallbackArray = [Math.floor(Math.random() * 99999), now.toString(), Math.floor(Math.random() * 9999999999), Math.floor(Math.random() * 999999), navInfo.userAgent, null, null, navInfo.language, navInfo.languages.join(','), Math.round(performance.now() - perfNow), selectedProp, reactStr, selectedFunc, perfNow, ''];
    return 'gAAAAAB' + btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(fallbackArray))));
}

function getSessionId() {
    const key = 'oai_session_id';
    let id = sessionStorage.getItem(key);
    if (!id) {
        id = generateUUID();
        sessionStorage.setItem(key, id);
    }
    return id;
}

function getTimezone() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (_) {
        return 'UTC';
    }
}

function getClientContextualInfo(includeViewport) {
    const info = { app_name: 'chatgpt.com' };
    if (!includeViewport) return info;
    info.is_dark_mode = !!(document.documentElement?.classList.contains('dark') || window.matchMedia?.('(prefers-color-scheme: dark)')?.matches);
    info.time_since_loaded = Math.max(0, Math.round(performance.now() / 1000));
    info.page_height = window.innerHeight || 0;
    info.page_width = window.innerWidth || 0;
    info.pixel_ratio = window.devicePixelRatio || 1;
    info.screen_height = window.screen?.height || 0;
    info.screen_width = window.screen?.width || 0;
    return info;
}

const WEB_SEARCH_GIZMO_ID = 'g-pNWGgUYqS';

function buildConversationMode() {
    // Use ChatGPT's normal routing. A search GPT forces tool work even for writing.
    return null;
}

function buildUserMessage(prompt) {
    return {
        id: generateUUID(),
        author: { role: 'user' },
        create_time: Date.now() / 1000,
        content: { content_type: 'text', parts: [prompt] },
        metadata: {
            selected_github_repos: [],
            selected_all_github_repos: false,
            serialization_metadata: { custom_symbol_offsets: [] }
        }
    };
}

function buildPrepareBody(message, prompt, tzOffset, timezone) {
    const body = {
        action: 'next',
        fork_from_shared_post: false,
        parent_message_id: 'client-created-root',
        model: 'auto',
        timezone_offset_min: tzOffset,
        timezone,
        system_hints: [],
        partial_query: message,
        blocked_features: /^Answer this Google search query:/i.test(prompt) ? [] : ['web_search'],
        supports_buffering: true,
        supported_encodings: ['v1'],
        client_contextual_info: getClientContextualInfo(false)
    };
    const conversationMode = buildConversationMode();
    if (conversationMode) body.conversation_mode = conversationMode;
    return body;
}

function buildConversationBody(message, prompt, tzOffset, timezone) {
    const body = {
        action: 'next',
        messages: [message],
        parent_message_id: 'client-created-root',
        model: 'auto',
        timezone_offset_min: tzOffset,
        timezone,
        enable_message_followups: true,
        system_hints: [],
        blocked_features: /^Answer this Google search query:/i.test(prompt) ? [] : ['web_search'],
        supports_buffering: true,
        supported_encodings: ['v1'],
        client_contextual_info: getClientContextualInfo(true),
        paragen_cot_summary_display_override: 'allow',
        force_parallel_switch: 'auto'
    };
    const conversationMode = buildConversationMode();
    if (conversationMode) body.conversation_mode = conversationMode;
    return body;
}

async function initConversationMetadata(accessToken, reqId) {
    if (!accessToken) return;
    const BASE = location.origin;
    try {
        const res = await fetch(BASE + '/backend-api/conversation/init', {
            method: 'POST',
            credentials: 'include',
            headers: getHeaders(accessToken),
            body: JSON.stringify({
                gizmo_id: null,
                requested_default_model: null,
                conversation_id: null,
                timezone_offset_min: -new Date().getTimezoneOffset()
            })
        });
        debugLog(reqId || 'no-req-id', 'H2', 'chatgpt-api-inpage.js:initConversationMetadata', 'conversation.init', {
            ok: !!res.ok,
            status: res.status || null
        });
    } catch (e) {
        debugLog(reqId || 'no-req-id', 'H2', 'chatgpt-api-inpage.js:initConversationMetadata', 'conversation.initFailed', {
            error: e?.message || 'unknown'
        });
    }
}

function encodeSentinelExtraData(messageId, hasTurnstileToken, hasSoToken) {
    try {
        return btoa(JSON.stringify({
            v: 1,
            sequence_number: 0,
            signals: {
                ping_source: 'session_observer_background_submit',
                so_token_present: hasSoToken ? '1' : '0',
                turnstile_token_present: hasTurnstileToken ? '1' : '0',
                proof_token_present: '1',
                prepare_token_present: '1',
                chat_requirements_token_present: '1'
            },
            conversation_id: 'WEB:' + messageId,
            last_message_id: messageId
        }));
    } catch (_) {
        return '';
    }
}

function getHeaders(accessToken, extra) {
    const BASE = location.origin;
    const h = {
        'accept': '*/*',
        'content-type': 'application/json',
        'authorization': 'Bearer ' + accessToken,
        'oai-device-id': getDeviceId(),
        'oai-language': 'en-US',
        'oai-session-id': getSessionId(),
        'origin': BASE,
        'referer': location.href || BASE + '/'
    };
    Object.assign(h, getClientHeaders());
    return Object.assign(h, extra || {});
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

const sideAISourceSets = new Map();
const sideAIImageSets = new Map();
const sideAIImageGroups = new Map();
const safeSideAIUrl = value => {
    if (typeof value !== 'string') return '';
    try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
    } catch (_) { return ''; }
};
function collectSideAIImageGroups(message, reqId) {
    const metadata = message?.metadata;
    if (!metadata) return false;
    const references = Array.isArray(metadata.content_references) ? metadata.content_references : [];
    const components = Array.isArray(metadata.genui_components) ? metadata.genui_components : [];
    const results = metadata.model_dil_v2?.appData?.opGenui?.componentResults || {};
    const resolvedCount = group => (Array.isArray(group?.images) ? group.images : []).filter(image => {
        const result = image?.image_result || image;
        return safeSideAIUrl(result?.thumbnail_url) || safeSideAIUrl(result?.content_url);
    }).length;
    const groups = references.filter(ref => ref?.type === 'image_group' && !ref.invalid).map(ref => ({...ref, images: Array.isArray(ref.images) ? ref.images.filter(image => image && typeof image === 'object') : []}));
    for (const component of components) {
        // Indexed SSE patches can introduce a later component before earlier
        // slots arrive. Sparse/null entries are incomplete metadata, not errors.
        if (!component || !['async_image', 'async_image_group'].includes(component.type)) continue;
        const state = results[component.component_resolution_id]?.state;
        const candidate = {
            type: 'image_group', component_resolution_id: component.component_resolution_id,
            start_index: component.start_index,
            images: (Array.isArray(state?.images) ? state.images : []).filter(image => image && typeof image === 'object').map(image => image.image_result ? image : ({image_result: image}))
        };
        // Both reference formats can describe the same gallery. Prefer the
        // populated result, keeping separate galleries in their original order.
        const index = groups.findIndex(group =>
            group.component_resolution_id === candidate.component_resolution_id ||
            (Number.isInteger(candidate.start_index) && group.start_index === candidate.start_index));
        if (index < 0) groups.push(candidate);
        else if (resolvedCount(candidate) > resolvedCount(groups[index])) groups[index] = {...groups[index], ...candidate};
    }
    const current = sideAIImageGroups.get(reqId) || [];
    const merged = groups.map((group, index) => {
        const previous = group.component_resolution_id
            ? current.find(old => old.component_resolution_id === group.component_resolution_id)
            : (current[index]?.component_resolution_id ? null : current[index]);
        return resolvedCount(previous) > resolvedCount(group) ? previous : group;
    });
    // Partial snapshots must not erase a gallery which has already loaded.
    if (merged.length < current.length) merged.push(...current.slice(merged.length));
    if (JSON.stringify(current) === JSON.stringify(merged)) return false;
    sideAIImageGroups.set(reqId, merged);
    return true;
}
function collectSideAIImages(value, reqId) {
    const found = sideAIImageSets.get(reqId) || new Map();
    const safeUrl = value => typeof value === 'string' && /^https?:\/\//i.test(value) ? value : '';
    const walk = (item, depth = 0) => {
        if (!item || typeof item !== 'object' || depth > 18) return;
        const url = safeUrl(item.image_url) || safeUrl(item.thumbnail_url) ||
            (/\.(?:png|jpe?g|gif|webp|avif|svg)(?:[?#]|$)/i.test(item.url || '') ? safeUrl(item.url) : '');
        const refs = [item.ref_id, item.source_id, item.id, item.matched_text]
            .filter(value => typeof value === 'string').join(' ').match(/turn\d+image\d+/g) || [];
        const ref = item.ref_id;
        if (ref && typeof ref === 'object' && ref.ref_type === 'image' && Number.isInteger(ref.turn_index) && Number.isInteger(ref.ref_index)) {
            refs.push('turn' + ref.turn_index + 'image' + ref.ref_index);
        }
        if (url && found.size < 80) {
            for (const ref of refs) found.set(ref, { url, title: String(item.title || item.alt || 'Image'), original_content_url: safeUrl(item.original_content_url), content_url: safeUrl(item.content_url) });
        }
        for (const child of Object.values(item)) if (child && typeof child === 'object') walk(child, depth + 1);
    };
    walk(value);
    sideAIImageSets.set(reqId, found);
}
function resolveSideAIImageMarkers(text, reqId, keepPending = false) {
    const images = sideAIImageSets.get(reqId);
    const groups = sideAIImageGroups.get(reqId) || [];
    let nextGroup = 0;
    const markdownUrl = value => safeSideAIUrl(value).replace(/[\s<>|()]/g, ch => encodeURIComponent(ch).replace(/\(/g, '%28').replace(/\)/g, '%29'));
    const markdownLabel = value => String(value || 'Image').replace(/[\\\[\]<>|\r\n]/g, ' ').trim().slice(0, 160);
    const escapeAttribute = value => String(value).replace(/[&<>"'|\r\n]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','|':'&#124;','\r':'&#13;','\n':'&#10;'}[ch]));
    const pictureFor = (result, label) => {
        const thumbnail = markdownUrl(result?.thumbnail_url || result?.content_url);
        if (!thumbnail) return '';
        const title = markdownLabel(result?.title || label);
        const fallbacks = [...new Set([result?.original_content_url, result?.content_url].map(safeSideAIUrl).filter(url => url && url !== thumbnail))];
        if (!fallbacks.length) return '![' + title + '](' + thumbnail + ')';
        // Preserve source-host alternatives: a failed OpenAI image proxy must
        // not discard a perfectly usable original image URL.
        return '<img src="' + escapeAttribute(thumbnail) + '" alt="' + escapeAttribute(title) + '" data-sideai-image-fallbacks="' + escapeAttribute(JSON.stringify(fallbacks)) + '">';
    };

    return text.replace(/\uE200(?:cite|i|image|image_group)\uE202([^\uE201]*)\uE201/g, (marker, payload) => {
        if (marker.startsWith('\uE200image_group\uE202')) {
            let group = groups[nextGroup++];
            // The stream may contain other references between image groups; match by
            // the query when the order of groups and markers differs.
            try {
                const query = JSON.parse(payload)?.query?.[0];
                if (query && group?.images?.length && !group.images.some(image => image?.image_search_query === query)) {
                    group = groups.find(ref => ref?.images?.some(image => image?.image_search_query === query)) || group;
                }
            } catch (_) {}
            const rendered = (group?.images || []).map(image => {
                const result = image?.image_result;
                const picture = pictureFor(result, image?.image_search_query);
                if (!picture) return '';
                const source = markdownUrl(result?.url || result?.content_url);
                if (!source) return picture;
                return picture.startsWith('<img') ? '<a href="' + escapeAttribute(source) + '">' + picture + '</a>' : '[' + picture + '](' + source + ')';
            }).filter(Boolean);
            if (rendered.length) return rendered.join('<br>');
            // Some responses only supply the already-rendered image Markdown in alt.
            return typeof group?.alt === 'string' && group.alt.includes('![') ? group.alt.trim().replace(/\n+/g, '<br>') : (keepPending ? marker : '');
        }
        const refs = payload.match(/turn\d+image\d+/g);
        if (!refs) return marker;
        return refs.map(ref => {
            const image = images?.get(ref);
            if (!image) return 'Image unavailable';
            return pictureFor({thumbnail_url:image.url, title:image.title, original_content_url:image.original_content_url, content_url:image.content_url}, image.title);
        }).join(' ');
    });
}
function collectSideAISources(value, reqId) {
    collectSideAIImages(value, reqId);
    const found=sideAISourceSets.get(reqId) || new Map();
    const referenceIds = item => {
        const ids = [item.ref_id, item.source_id, item.matched_text].filter(x=>typeof x==='string').join(' ').match(/turn\d+(?:search|news|fetch|view)\d+/g) || [];
        const ref=item.ref_id;
        if(ref && typeof ref==='object' && Number.isInteger(ref.turn_index) && Number.isInteger(ref.ref_index) && /^(search|news|fetch|view)$/.test(ref.ref_type)) ids.push('turn'+ref.turn_index+ref.ref_type+ref.ref_index);
        return ids;
    };
    const walk=(item,depth=0,inherited=[])=>{
        if(!item || typeof item!=='object' || depth>14)return;
        if(typeof item.p==='string' && (item.p.includes('/image_result') || item.p.includes('/model_dil_v2/appData') || item.p.includes('/genui_components')))return;
        if (['image_group','async_image','async_image_group'].includes(item.type) || ['AsyncImage','AsyncImageGroup'].includes(item.componentName) || item.original_content_url || item.save_target === 'image') return; // Image assets already link to their own sources.
        const own=referenceIds(item),refs=own.length?own:inherited;
        const url=safeSideAIUrl(item.url);
        if(url) {
            const canonical=new URL(url);
            for(const key of [...canonical.searchParams.keys()])if(/^utm_/i.test(key))canonical.searchParams.delete(key);
            const sourceKey=canonical.href;
            const previous=found.get(sourceKey);
            const title=String(item.title || item.name || previous?.title || new URL(url).hostname);
            if(previous || found.size<80)found.set(sourceKey,{url:sourceKey,title,refs:[...new Set([...(previous?.refs || []),...refs])]});
        }
        for(const [key,child] of Object.entries(item))if(key!=='image_result' && child && typeof child==='object')walk(child,depth+1,refs);
    };
    try{walk(value);}catch(_){}
    sideAISourceSets.set(reqId,found);
}
function withSideAISources(text,reqId) {
    text = resolveSideAIImageMarkers(cleanResponseMarkup(text), reqId);
    sideAIImageSets.delete(reqId);
    sideAIImageGroups.delete(reqId);
    const sources=[...(sideAISourceSets.get(reqId)?.values() || [])];sideAISourceSets.delete(reqId);
    if(!sources.length)return text;
    // Generated inline HTML is parsed inside GFM tables: attribute pipes and
    // newlines must not become column/row delimiters before HTML sanitization.
    const escape=value=>String(value).replace(/[&<>"'|\r\n]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','|':'&#124;','\r':'&#13;','\n':'&#10;'}[ch]));
    const byRef=new Map();
    const cited=new Set();
    for(const source of sources) for(const ref of source.refs || []) {
        if(!byRef.has(ref))byRef.set(ref,[]);
        byRef.get(ref).push(source);
    }
    text=text.replace(/\uE200cite\uE202([^\uE201]*)\uE201/g,(marker,payload)=>{
        const matches=(payload.match(/turn\d+(?:search|news|fetch|view)\d+/g)||[]).flatMap(ref=>byRef.get(ref)||[]);
        return [...new Map(matches.map(source=>[source.url,source])).values()].map(source=>{cited.add(source.url);return '<a class="sideai-citation" href="'+escape(source.url)+'" title="'+escape(source.title)+'">'+escape(new URL(source.url).hostname.replace(/^www\./,''))+'</a>';}).join(' ');
    });
    const displayed=cited.size?sources.filter(source=>cited.has(source.url)):sources;
    return text+'\n\n### Sources\n\n<div class="sideai-sources">'+displayed.map(source=>'<a class="sideai-source-card" href="'+escape(source.url)+'"><span>'+escape(source.title)+'</span><small>'+escape(new URL(source.url).hostname.replace(/^www\./,''))+'</small></a>').join('')+'</div>';
}

async function readConversationStream(convRes, reqId, onChunk, options = {}) {
    if (!convRes?.body?.getReader) {
        debugLog(reqId || 'no-req-id', 'STREAM', 'chatgpt-api-inpage.js:readConversationStream', 'stream.missingBody', {
            ok: !!convRes?.ok,
            status: convRes?.status || null,
            contentType: convRes?.headers?.get?.('content-type') || null
        });
        throw new Error('ChatGPT stream body unavailable');
    }
    debugLog(reqId || 'no-req-id', 'STREAM', 'chatgpt-api-inpage.js:readConversationStream', 'stream.start', {
        ok: !!convRes.ok,
        status: convRes.status,
        contentType: convRes.headers?.get?.('content-type') || null
    });
    const reader = convRes.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let conversationId = null;
    let buffer = '';
    let rawChunkCount = 0;
    let rawBytes = 0;
    let sseLineCount = 0;
    let parsedEventCount = 0;
    let appendEventCount = 0;
    let fullMessageEventCount = 0;
    let legacyEventCount = 0;
    let parseErrorCount = 0;
    let ignoredShorterReplacementCount = 0;
    let replaceEventCount = 0;
    let statePatchEventCount = 0;
    let stateTextEventCount = 0;
    let unhandledPatchLogCount = 0;
    let suppressedFragmentCount = 0;
    let eventShapeLogCount = 0;
    let pollUpdateCount = 0;
    let pollAheadText = null;
    let doneMarkerSeen = false;
    let lastLoggedTextLength = 0;
    let emittedText = '';
    let pollStarted = false;
    let pollStopped = false;
    let pollPromise = null;
    const pollController = new AbortController();
    let lastStreamProgressAt = Date.now();
    let lastPatchTemplate = null;
    let compactTextDeltaCount = 0;
    let streamState = {};
    const streamChannels = new Map();
    let currentChannel = 'default';
    let channelContext = null;
    let answerMessage = null;

    const extractTextFromValue = (value) => {
        if (typeof value === 'string') return value;
        if (Array.isArray(value)) {
            return value.map((part) => {
                if (typeof part === 'string') return part;
                if (part && typeof part.text === 'string') return part.text;
                return '';
            }).join('');
        }
        if (value && typeof value === 'object') {
            if (typeof value.text === 'string') return value.text;
            if (Array.isArray(value.parts)) return extractTextFromValue(value.parts);
            if (value.content && typeof value.content === 'object') return extractTextFromValue(value.content);
        }
        return '';
    };

    const extractTextFromMessage = (message, allowMissingRole = false) => {
        if (!message || typeof message !== 'object') return '';
        const role = message.author?.role || null;
        if (role && role !== 'assistant') return '';
        if (message.metadata?.is_message_fragment || message.metadata?.is_visually_hidden_from_conversation) return '';
        if (!role && !allowMissingRole) return '';
        const contentType = message.content?.content_type || null;
        const recipient = message.recipient || null;
        if (contentType && !['text', 'multimodal_text'].includes(contentType)) return '';
        if (recipient && recipient !== 'all') return '';
        if (['analysis', 'justify', 'confidence'].includes(message.channel)) return '';
        if (looksLikeHiddenToolCallText(extractTextFromValue(message.content || message))) return '';
        return readableAssistantText(message);
    };

    const extractStateText = () => {
        return (
            extractTextFromMessage(streamState.message, true) ||
            extractTextFromMessage(streamState.v?.message, true) ||
            extractTextFromMessage(streamState, false)
        );
    };

    const decodePointerPart = (part) => part.replace(/~1/g, '/').replace(/~0/g, '~');
    const pointerParts = (path) => (path === '' ? [] : String(path).split('/').slice(1).map(decodePointerPart));
    const isArrayIndex = (part) => part === '-' || /^\d+$/.test(part);

    const getPointerValue = (root, path) => {
        let target = root;
        for (const part of pointerParts(path)) {
            if (target == null) return undefined;
            if (Array.isArray(target)) {
                if (part === '-') return undefined;
                target = target[Number(part)];
            } else {
                target = target[part];
            }
        }
        return target;
    };

    const getPointerParent = (root, path, create) => {
        const parts = pointerParts(path);
        if (!parts.length) return { parent: null, key: null, rootPath: true };
        let parent = root;
        for (let i = 0; i < parts.length - 1; i++) {
            const key = parts[i];
            const nextKey = parts[i + 1];
            const nextContainer = isArrayIndex(nextKey) ? [] : {};
            if (Array.isArray(parent)) {
                const index = key === '-' ? parent.length : Number(key);
                if (parent[index] == null) {
                    if (!create) return null;
                    parent[index] = nextContainer;
                }
                parent = parent[index];
            } else if (parent && typeof parent === 'object') {
                if (parent[key] == null) {
                    if (!create) return null;
                    parent[key] = nextContainer;
                }
                parent = parent[key];
            } else {
                return null;
            }
        }
        return { parent, key: parts[parts.length - 1], rootPath: false };
    };

    const setPointerValue = (root, path, value) => {
        const ref = getPointerParent(root, path, true);
        if (!ref) return false;
        if (ref.rootPath) {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                for (const key of Object.keys(root)) delete root[key];
                Object.assign(root, value);
                return true;
            }
            return false;
        }
        if (Array.isArray(ref.parent)) {
            if (ref.key === '-') ref.parent.push(value);
            else ref.parent[Number(ref.key)] = value;
        } else if (ref.parent && typeof ref.parent === 'object') {
            ref.parent[ref.key] = value;
        } else {
            return false;
        }
        return true;
    };

    const removePointerValue = (root, path) => {
        const ref = getPointerParent(root, path, false);
        if (!ref || ref.rootPath) return false;
        if (Array.isArray(ref.parent)) {
            if (ref.key !== '-') ref.parent.splice(Number(ref.key), 1);
        } else if (ref.parent && typeof ref.parent === 'object') {
            delete ref.parent[ref.key];
        }
        return true;
    };

    const appendPointerValue = (root, path, value) => {
        const existing = getPointerValue(root, path);
        if (typeof existing === 'string' && typeof value === 'string') {
            return setPointerValue(root, path, existing + value);
        }
        if (Array.isArray(existing)) {
            if (Array.isArray(value)) existing.push(...value);
            else existing.push(value);
            return true;
        }
        if (existing && typeof existing === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
            Object.assign(existing, value);
            return true;
        }
        return setPointerValue(root, path, value);
    };

    const applyStreamPatch = (op) => {
        if (!op || typeof op.p !== 'string' || typeof op.o !== 'string') return false;
        if (op.o === 'add' || op.o === 'replace') return setPointerValue(streamState, op.p, op.v);
        if (op.o === 'append') return appendPointerValue(streamState, op.p, op.v);
        if (op.o === 'remove') return removePointerValue(streamState, op.p);
        if (unhandledPatchLogCount < 3) {
            unhandledPatchLogCount++;
            debugLog(reqId || 'no-req-id', 'STREAM', 'chatgpt-api-inpage.js:readConversationStream', 'stream.unhandledPatchOp', {
                op: op.o,
                path: op.p,
                valueType: typeof op.v,
                rawChunkCount,
                sseLineCount,
                parsedEventCount
            });
        }
        return false;
    };

    const acceptReplacementText = (text, source, options = {}) => {
        if (!text) return false;
        // A poll can arrive ahead of queued SSE deltas. Replaying its older
        // prefix must never erase the newer text already shown to the user.
        if (pollAheadText && text.length < pollAheadText.length && pollAheadText.startsWith(text)) return false;
        pollAheadText = null;
        if (text === fullText) return false;
        if (looksLikeHiddenToolCallText(text)) {
            debugLog(reqId || 'no-req-id', 'STREAM', 'chatgpt-api-inpage.js:readConversationStream', 'stream.ignoredHiddenToolCallReplacement', {
                source,
                candidateLength: text.length,
                candidateTail: getTextTail(text),
                rawChunkCount,
                sseLineCount,
                parsedEventCount
            });
            return false;
        }
        const allowShorterAuthoritative =
            !!options.authoritative;
        if (text.length < fullText.length && !allowShorterAuthoritative) {
            ignoredShorterReplacementCount++;
            debugLog(reqId || 'no-req-id', 'STREAM', 'chatgpt-api-inpage.js:readConversationStream', 'stream.ignoredShorterReplacement', {
                source,
                candidateLength: text.length,
                currentLength: fullText.length,
                candidateTail: getTextTail(text),
                currentTail: getTextTail(fullText),
                authoritative: !!options.authoritative,
                rawChunkCount,
                sseLineCount,
                parsedEventCount
            });
            return false;
        }
        fullText = text;
        replaceEventCount++;
        logTextProgress(source, { receivedLength: text.length });
        emitChunkText(fullText, source);
        return true;
    };

    const logTextProgress = (source, extra) => {
        if (fullText.length === lastLoggedTextLength) return;
        const shouldLog =
            fullText.length < 500 ||
            fullText.length - lastLoggedTextLength >= 750 ||
            appendEventCount + stateTextEventCount + fullMessageEventCount + legacyEventCount <= 4;
        if (!shouldLog) return;
        lastLoggedTextLength = fullText.length;
        debugLog(reqId || 'no-req-id', 'STREAM', 'chatgpt-api-inpage.js:readConversationStream', 'stream.textProgress', {
            source,
            textLength: fullText.length,
            tail: getTextTail(fullText),
            rawChunkCount,
            sseLineCount,
            parsedEventCount,
            ...extra
        });
    };

    const shouldSuppressStreamText = (text, source) => {
        if (!text) return true;
        if (looksLikeHiddenToolCallText(text)) return true;
        // The reconstructed state can legitimately replace or shorten an answer.
        if (looksLikePartialTail(text)) return true;
        if (emittedText && text.startsWith(emittedText)) return false;
        if (!emittedText && text.length < 24 && !/^[A-Z0-9#*_`'"“¿¡]/.test(text.trimStart())) return true;
        return false;
    };

    const emitChunkText = (text, source, emitOptions = {}) => {
        if (!onChunk || !text) return false;
        if (!emitOptions.force && shouldSuppressStreamText(text, source)) {
            suppressedFragmentCount++;
            if (suppressedFragmentCount <= 8) {
                debugLog(reqId || 'no-req-id', 'STREAM', 'chatgpt-api-inpage.js:readConversationStream', 'stream.suppressedFragmentChunk', {
                    source,
                    textLength: text.length,
                    textTail: getTextTail(text),
                    emittedTextLength: emittedText.length,
                    rawChunkCount,
                    sseLineCount,
                    parsedEventCount
                });
            }
            return false;
        }
        text = resolveSideAIImageMarkers(cleanResponseMarkup(text.replace(/\uE200[^\uE201]*$/, '')), reqId, true);
        if (!text || text === emittedText) return false;
        emittedText = text;
        if (source !== 'conversation.poll') lastStreamProgressAt = Date.now();
        onChunk(text, reqId);
        return true;
    };

    const maybeStartConversationPolling = () => {
        if (pollStarted || pollStopped || !conversationId || !options.accessToken || options.pollConversation === false) return;
        pollStarted = true;
        debugLog(reqId || 'no-req-id', 'STREAM', 'chatgpt-api-inpage.js:readConversationStream', 'stream.pollStart', {
            conversationIdPresent: true,
            streamTextLength: fullText.length,
            emittedTextLength: emittedText.length
        });
        pollPromise = (async () => {
            await delay(1500);
            for (let attempt = 1; attempt <= 55 && !pollStopped; attempt++) {
                // Streaming already provides the answer. Fetch a snapshot only
                // when progress stalls, instead of competing with every chunk.
                if (Date.now() - lastStreamProgressAt < 1500) {
                    await delay(500);
                    continue;
                }
                const pollText = await fetchConversationFinalText(conversationId, options.accessToken, reqId, {
                    maxAttempts: 1,
                    quiet: true,
                    signal: pollController.signal,
                    source: 'poll',
                    onComplete: text => {
                        if (pollStopped) return;
                        fullText = text;
                        pollAheadText = text;
                        emitChunkText(text, 'conversation.poll', { force: true });
                        void reader.cancel().catch(() => {});
                    }
                });
                if (pollStopped) break;
                if (
                    pollText &&
                    pollText.length > Math.max(fullText.length, emittedText.length) &&
                    !looksLikePartialTail(pollText)
                ) {
                    fullText = pollText;
                    pollAheadText = pollText;
                    replaceEventCount++;
                    pollUpdateCount++;
                    logTextProgress('conversation.poll', {
                        pollAttempt: attempt,
                        receivedLength: pollText.length
                    });
                    emitChunkText(fullText, 'conversation.poll', { force: true });
                }
                await delay(attempt < 16 ? 300 : 700);
            }
            debugLog(reqId || 'no-req-id', 'STREAM', 'chatgpt-api-inpage.js:readConversationStream', 'stream.pollComplete', {
                pollUpdateCount,
                streamTextLength: fullText.length,
                emittedTextLength: emittedText.length,
                stopped: pollStopped
            });
        })().catch((e) => {
            debugLog(reqId || 'no-req-id', 'STREAM', 'chatgpt-api-inpage.js:readConversationStream', 'stream.pollError', {
                error: e?.message || 'unknown',
                streamTextLength: fullText.length
            });
        });
    };

    try {
    conversationStream: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        rawChunkCount++;
        rawBytes += value?.byteLength || 0;
        if (rawChunkCount <= 3 || rawChunkCount % 20 === 0) {
            debugLog(reqId || 'no-req-id', 'STREAM', 'chatgpt-api-inpage.js:readConversationStream', 'stream.rawChunk', {
                rawChunkCount,
                chunkBytes: value?.byteLength || 0,
                rawBytes,
                bufferedCharsBeforeDecode: buffer.length,
                textLength: fullText.length
            });
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            sseLineCount++;
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
                doneMarkerSeen = true;
                debugLog(reqId || 'no-req-id', 'STREAM', 'chatgpt-api-inpage.js:readConversationStream', 'stream.doneMarker', {
                    rawChunkCount,
                    rawBytes,
                    sseLineCount,
                    parsedEventCount,
                    textLength: fullText.length,
                    tail: getTextTail(fullText)
                });
                // The protocol is finished; the HTTP connection may remain open.
                // All final text and image metadata precedes this marker.
                void reader.cancel().catch(() => {});
                break conversationStream;
            }
            if (!data) continue;
            try {
                const parsed = JSON.parse(data);
                if (!parsed || typeof parsed !== 'object') continue;
                if (parsed.type === 'message_stream_complete') {
                    doneMarkerSeen = true;
                    void reader.cancel().catch(() => {});
                    break conversationStream;
                }
                // `c` selects an independent message/patch context. Omitted c
                // inherits the previous context; compact deltas inherit its
                // own last operation, never an operation from another message.
                if (parsed.c !== undefined) currentChannel = parsed.c;
                channelContext = streamChannels.get(currentChannel);
                if (!channelContext) {
                    channelContext = { state: {}, template: null };
                    streamChannels.set(currentChannel, channelContext);
                }
                streamState = channelContext.state;
                lastPatchTemplate = channelContext.template;
                collectSideAISources(parsed, reqId);
                parsedEventCount++;
                if (parsed.error) {
                    debugLog(reqId || 'no-req-id', 'STREAM', 'chatgpt-api-inpage.js:readConversationStream', 'stream.parsedErrorEvent', {
                        error: parsed.error,
                        rawChunkCount,
                        sseLineCount,
                        textLength: fullText.length,
                        tail: getTextTail(fullText)
                    });
                    throw new Error(parsed.error);
                }
                if (parsed && typeof parsed === 'object' && parsed.conversation_id) {
                    conversationId = parsed.conversation_id;
                    maybeStartConversationPolling();
                }
                const snapshotMessage = parsed?.v?.message || parsed?.message;
                if (snapshotMessage && typeof snapshotMessage === 'object') {
                    streamState.message = snapshotMessage;
                    if (parsed.v?.conversation_id) conversationId = parsed.v.conversation_id;
                    if (isUserVisibleAssistantMessage(snapshotMessage)) {
                        answerMessage = snapshotMessage;
                        if (collectSideAIImageGroups(snapshotMessage, reqId) && fullText) emitChunkText(fullText, 'images.snapshot');
                    }
                }
                const directPatch = parsed && typeof parsed === 'object' && parsed.o && typeof parsed.p === 'string' ? [parsed] : null;
                const compactTextDelta =
                    !directPatch &&
                    parsed &&
                    typeof parsed === 'object' &&
                    Object.keys(parsed).every(key => key === 'v' || key === 'c') &&
                    typeof parsed.v === 'string' &&
                    lastPatchTemplate?.o === 'append' &&
                    ['/message/content/parts/0', '/message/metadata/model_dil_v2/fallbackMarkdown'].includes(lastPatchTemplate?.p)
                        ? [{ ...lastPatchTemplate, v: parsed.v }]
                        : null;
                if (compactTextDelta) compactTextDeltaCount++;
                const patches = (parsed?.o === 'patch' && Array.isArray(parsed.v)) ? parsed.v : (directPatch || (Array.isArray(parsed?.v) ? parsed.v : compactTextDelta));
                if (
                    eventShapeLogCount < 14 &&
                    parsed &&
                    typeof parsed === 'object' &&
                    (!patches || eventShapeLogCount < 8)
                ) {
                    eventShapeLogCount++;
                    const message = parsed.v?.message || parsed.message || null;
                    const messageText = extractTextFromMessage(message, true);
                    debugLog(reqId || 'no-req-id', 'STREAM', 'chatgpt-api-inpage.js:readConversationStream', 'stream.eventShape', {
                        keys: Object.keys(parsed).slice(0, 12),
                        type: parsed.type || null,
                        eventOp: parsed.o || null,
                        eventPath: parsed.p || null,
                        vType: Array.isArray(parsed.v) ? 'array' : typeof parsed.v,
                        vLength: typeof parsed.v === 'string' ? parsed.v.length : (Array.isArray(parsed.v) ? parsed.v.length : null),
                        vTail: typeof parsed.v === 'string' ? getTextTail(parsed.v, 80) : '',
                        compactTextDelta: !!compactTextDelta,
                        hasPatchArray: !!patches,
                        patchCount: patches?.length || 0,
                        messageRole: message?.author?.role || null,
                        messageStatus: message?.status || null,
                        messageTextLength: messageText.length,
                        messageTextTail: getTextTail(messageText),
                        conversationIdPresent: !!conversationId,
                        rawChunkCount,
                        sseLineCount,
                        parsedEventCount
                    });
                }
                if (patches) {
                    statePatchEventCount++;
                    let appliedPatchCount = 0;
                    let fallbackAppendText = '';
                    let fallbackReplacementText = '';
                    for (const op of patches) {
                        if (!op || typeof op.p !== 'string') continue;
                        if (typeof op.o === 'string') {
                            lastPatchTemplate = { p: op.p, o: op.o };
                            channelContext.template = lastPatchTemplate;
                        }
                        if (applyStreamPatch(op)) appliedPatchCount++;

                        const isAssistantTextPath =
                            op.p === '/message/content/parts/0' ||
                            op.p === '/message/content/parts' ||
                            op.p === '/message/content';
                        if (!isAssistantTextPath) continue;

                        if (op.o === 'append' && typeof op.v === 'string') {
                            if (op.p === '/message/content/parts/0') {
                                fallbackAppendText += op.v;
                            } else {
                                fallbackReplacementText = extractTextFromValue(op.v);
                            }
                        } else if (op.o === 'replace' || op.o === 'add') {
                            fallbackReplacementText = extractTextFromValue(op.v);
                        }
                    }

                    const visibleState = !streamState.message?.author?.role || isUserVisibleAssistantMessage(streamState.message);
                    if (!visibleState) continue;
                    answerMessage = streamState.message || answerMessage;
                    const imagesChanged = collectSideAIImageGroups(streamState.message, reqId);
                    if (imagesChanged && fullText) emitChunkText(fullText, 'images.metadata');
                    const stateText = extractStateText();
                    if (statePatchEventCount <= 5) {
                        debugLog(reqId || 'no-req-id', 'STREAM', 'chatgpt-api-inpage.js:readConversationStream', 'stream.patchBatch', {
                            patchCount: patches.length,
                            appliedPatchCount,
                            stateTextLength: stateText.length,
                            stateTextTail: getTextTail(stateText),
                            ops: patches.slice(0, 12).map((op) => ({
                                op: op?.o || null,
                                path: op?.p || null,
                                valueType: typeof op?.v,
                                valueLength: typeof op?.v === 'string' ? op.v.length : (Array.isArray(op?.v) ? op.v.length : null),
                                valueTail: typeof op?.v === 'string' ? getTextTail(op.v, 80) : ''
                            })),
                            compactTextDeltaCount
                        });
                    }
                    if (stateText) {
                        stateTextEventCount++;
                        acceptReplacementText(stateText, 'patch.state', {
                            authoritative: true,
                            appliedPatchCount,
                            patchCount: patches.length
                        });
                        continue;
                    }

                    if (streamState.message?.author?.role && !isUserVisibleAssistantMessage(streamState.message)) continue;
                    if (fallbackReplacementText) {
                        acceptReplacementText(fallbackReplacementText, 'patch.fallbackReplacement');
                    } else if (fallbackAppendText) {
                        if (looksLikeHiddenToolCallText(fallbackAppendText)) {
                            suppressedFragmentCount++;
                            debugLog(reqId || 'no-req-id', 'STREAM', 'chatgpt-api-inpage.js:readConversationStream', 'stream.suppressedHiddenToolCallAppend', {
                                appendedLength: fallbackAppendText.length,
                                appendedTail: getTextTail(fallbackAppendText),
                                rawChunkCount,
                                sseLineCount,
                                parsedEventCount
                            });
                            continue;
                        }
                        if (fullText && looksLikeAnswerEndingFragment(fallbackAppendText) && fullText.length < 80) {
                            suppressedFragmentCount++;
                            debugLog(reqId || 'no-req-id', 'STREAM', 'chatgpt-api-inpage.js:readConversationStream', 'stream.suppressedAppendFragment', {
                                appendedLength: fallbackAppendText.length,
                                appendedTail: getTextTail(fallbackAppendText),
                                currentLength: fullText.length,
                                currentTail: getTextTail(fullText),
                                rawChunkCount,
                                sseLineCount,
                                parsedEventCount
                            });
                            continue;
                        }
                        fullText += fallbackAppendText;
                        appendEventCount++;
                        logTextProgress('patch.fallbackAppend', { appendedLength: fallbackAppendText.length });
                        emitChunkText(fullText, 'patch.fallbackAppend');
                    }
                    continue;
                }
                const vMsg = parsed.v?.message;
                if (vMsg?.author?.role === 'assistant' && vMsg?.content) {
                    const text = extractTextFromMessage(vMsg);
                    if (text && text !== fullText) {
                        fullMessageEventCount++;
                        acceptReplacementText(text, 'v.message', { authoritative: true });
                    }
                }
                if (parsed.message?.author?.role === 'assistant' && parsed.message?.content?.parts) {
                    const text = extractTextFromMessage(parsed.message);
                    if (text && text !== fullText) {
                        legacyEventCount++;
                        acceptReplacementText(text, 'legacy.message', { authoritative: true });
                    }
                }
            } catch (e) {
                parseErrorCount++;
                if (parseErrorCount <= 3) {
                    debugLog(reqId || 'no-req-id', 'STREAM', 'chatgpt-api-inpage.js:readConversationStream', 'stream.parseError', {
                        message: e?.message || 'unknown',
                        dataPrefix: data.slice(0, 180),
                        rawChunkCount,
                        sseLineCount,
                        textLength: fullText.length
                    });
                }
                if (e.message && !e.message.includes('JSON')) throw e;
            }
        }
    }
    } finally {
        pollStopped = true;
        pollController.abort();
    }
    if (buffer.trim()) {
        debugLog(reqId || 'no-req-id', 'STREAM', 'chatgpt-api-inpage.js:readConversationStream', 'stream.leftoverBufferAtReaderDone', {
            bufferLength: buffer.length,
            bufferPrefix: buffer.slice(0, 180),
            textLength: fullText.length,
            tail: getTextTail(fullText)
        });
    }
    // Snapshot polling is only a fallback; completion must not wait for it.
    // Image metadata arrives after the answer text as patches to content_references.
    // Resolve the final references before the response is sent to the Google frame.
    const finalMessage = answerMessage || streamState.message || streamState.v?.message;
    collectSideAIImageGroups(finalMessage, reqId);
    collectSideAISources(finalMessage, reqId);
    debugLog(reqId || 'no-req-id', 'STREAM', 'chatgpt-api-inpage.js:readConversationStream', 'stream.complete', {
        rawChunkCount,
        rawBytes,
        sseLineCount,
        parsedEventCount,
        appendEventCount,
        replaceEventCount,
        statePatchEventCount,
        stateTextEventCount,
        fullMessageEventCount,
        legacyEventCount,
        parseErrorCount,
        ignoredShorterReplacementCount,
        suppressedFragmentCount,
        compactTextDeltaCount,
        pollStarted,
        pollUpdateCount,
        doneMarkerSeen,
        conversationIdPresent: !!conversationId,
        emittedTextLength: emittedText.length,
        finalTextLength: fullText.length,
        finalTail: getTextTail(fullText)
    });
    return { fullText, conversationId, emittedTextLength: emittedText.length, suppressedFragmentCount, pollUpdateCount };
}

async function runLegacyApiCall(prompt, reqId, onChunk, session) {
    const BASE = location.origin;
    await initConversationMetadata(session.accessToken, reqId);
    await delay(100 + Math.random() * 200);
    const pPayload = generatePParameter();
    const reqRes = await fetch(BASE + '/backend-api/sentinel/chat-requirements', {
        method: 'POST',
        credentials: 'include',
        headers: getHeaders(session.accessToken),
        body: JSON.stringify({ p: pPayload })
    });
    if (!reqRes.ok) throw new Error('Failed to get chat requirements: ' + reqRes.status);
    const reqData = await reqRes.json();
    if (reqData.proofofwork?.required && reqData.proofofwork?.seed && reqData.proofofwork?.difficulty) {
        reqData.proofToken = solveProofOfWork(reqData.proofofwork.seed, reqData.proofofwork.difficulty);
    }

    const tzOffset = -new Date().getTimezoneOffset();
    const timezone = getTimezone();
    const message = buildUserMessage(prompt);
    const body = buildConversationBody(message, prompt, tzOffset, timezone);
    const headers = getHeaders(session.accessToken, {
        'accept': 'text/event-stream',
        'x-openai-target-path': '/backend-api/conversation',
        'x-openai-target-route': '/backend-api/conversation'
    });
    if (reqData.token) headers['openai-sentinel-chat-requirements-token'] = reqData.token;
    if (reqData.proofToken) headers['openai-sentinel-proof-token'] = reqData.proofToken;

    // #region agent log
    debugLog(reqId || 'no-req-id', 'H3', 'chatgpt-api-inpage.js:legacy', 'sentinel.requirements', {
        ok: reqRes.ok,
        hasToken: !!reqData.token,
        proofRequired: !!reqData.proofofwork?.required,
        turnstileRequired: !!reqData.turnstile?.required,
        hasTurnstileDx: !!reqData.turnstile?.dx,
        prepareFinalizeImplemented: false
    });
    // #endregion
    // #region agent log
    debugLog(reqId || 'no-req-id', 'H2', 'chatgpt-api-inpage.js:legacy', 'conversation.requestShape', {
        model: body.model,
        conversationModeKind: body.conversation_mode?.kind || null,
        gizmoId: body.conversation_mode?.gizmo_id || null,
        blockedFeatures: body.blocked_features || [],
        supportsBuffering: !!body.supports_buffering,
        hasClientContextualInfo: !!body.client_contextual_info,
        hasTimezoneOffset: typeof body.timezone_offset_min === 'number',
        hasTurnstileHeader: false,
        hasOaiSessionIdHeader: !!headers['oai-session-id'],
        usingLegacyRequirementsEndpoint: true
    });
    // #endregion

    const convRes = await fetch(BASE + '/backend-api/conversation', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify(body)
    });
    if (!convRes.ok) {
        const errText = await convRes.text();
        throw new Error('API error: ' + convRes.status + ' - ' + errText.substring(0, 200));
    }
    const result = await readConversationStream(convRes, reqId, onChunk, {
        accessToken: session.accessToken,
        pollConversation: true
    });
    return { ...result, transport: 'legacy' };
}

async function runModernApiCall(prompt, reqId, onChunk, session) {
    const BASE = location.origin;
    const sessionId = getSessionId();
    const turnTraceId = generateUUID();
    const tzOffset = -new Date().getTimezoneOffset();
    const timezone = getTimezone();
    const message = buildUserMessage(prompt);
    const pPayload = generatePParameter();

    // Regular ChatGPT requests do not need a custom-GPT initialization round trip.
    const prepareRes = await fetch(BASE + '/backend-api/sentinel/chat-requirements/prepare', {
        method: 'POST',
        credentials: 'include',
        headers: getHeaders(session.accessToken, {
            'x-openai-target-path': '/backend-api/sentinel/chat-requirements/prepare',
            'x-openai-target-route': '/backend-api/sentinel/chat-requirements/prepare'
        }),
        body: JSON.stringify({ p: pPayload })
        });
    if (!prepareRes.ok) throw new Error('Failed to prepare chat requirements: ' + prepareRes.status);
    const prepareData = await prepareRes.json();
    const prepareToken = prepareData.prepare_token;
    if (!prepareToken) throw new Error('Missing prepare token');
    const proofToken = (prepareData.proofofwork?.required && prepareData.proofofwork?.seed && prepareData.proofofwork?.difficulty)
        ? solveProofOfWork(prepareData.proofofwork.seed, prepareData.proofofwork.difficulty)
        : null;

    const conversationPrepareBody = buildPrepareBody(message, prompt, tzOffset, timezone);
    const finalizeBody = {
        prepare_token: prepareToken,
        proofofwork: proofToken || undefined,
        turnstile: prepareData.turnstile?.dx || undefined
    };
    const [conversationPrepareRes, finalizeRes] = await Promise.all([
        fetch(BASE + '/backend-api/f/conversation/prepare', {
        method: 'POST',
        credentials: 'include',
        headers: getHeaders(session.accessToken, {
            'x-conduit-token': 'no-token',
            'x-oai-turn-trace-id': turnTraceId,
            'x-openai-target-path': '/backend-api/f/conversation/prepare',
            'x-openai-target-route': '/backend-api/f/conversation/prepare'
        }),
        body: JSON.stringify(conversationPrepareBody)
    }),
        fetch(BASE + '/backend-api/sentinel/chat-requirements/finalize', {
        method: 'POST',
        credentials: 'include',
        headers: getHeaders(session.accessToken, {
            'x-openai-target-path': '/backend-api/sentinel/chat-requirements/finalize',
            'x-openai-target-route': '/backend-api/sentinel/chat-requirements/finalize'
        }),
        body: JSON.stringify(finalizeBody)
    })
    ]);
    if (!conversationPrepareRes.ok) throw new Error('Failed to prepare conversation conduit: ' + conversationPrepareRes.status);
    if (!finalizeRes.ok) throw new Error('Failed to finalize chat requirements: ' + finalizeRes.status);
    const [conversationPrepareData, finalizeData] = await Promise.all([
        conversationPrepareRes.json(), finalizeRes.json()
    ]);
    const conduitToken = conversationPrepareData.conduit_token || 'no-token';
    const requirementsToken = finalizeData.token;
    if (!requirementsToken) throw new Error('Missing finalized chat requirements token');

    const extraData = encodeSentinelExtraData(message.id, !!prepareData.turnstile?.dx, !!prepareData.so?.collector_dx);
    try {
        await fetch(BASE + '/backend-api/sentinel/ping', {
            method: 'POST',
            credentials: 'include',
            headers: getHeaders(session.accessToken, {
                'openai-sentinel-chat-requirements-prepare-token': prepareToken,
                'openai-sentinel-chat-requirements-token': requirementsToken,
                'openai-sentinel-proof-token': proofToken || '',
                'openai-sentinel-turnstile-token': prepareData.turnstile?.dx || '',
                'openai-sentinel-so-token': prepareData.so?.collector_dx || '',
                'openai-sentinel-extra-data': extraData,
                'x-openai-target-path': '/backend-api/sentinel/ping',
                'x-openai-target-route': '/backend-api/sentinel/ping'
            })
        });
    } catch (_) {}

    // #region agent log
    debugLog(reqId || 'no-req-id', 'H3', 'chatgpt-api-inpage.js:modern', 'sentinel.requirements', {
        ok: finalizeRes.ok,
        hasToken: !!requirementsToken,
        proofRequired: !!prepareData.proofofwork?.required,
        turnstileRequired: !!prepareData.turnstile?.required,
        hasTurnstileDx: !!prepareData.turnstile?.dx,
        prepareFinalizeImplemented: true
    });
    // #endregion

    const conversationBody = buildConversationBody(message, prompt, tzOffset, timezone);
    const conversationHeaders = getHeaders(session.accessToken, {
        'accept': 'text/event-stream',
        'x-conduit-token': conduitToken,
        'x-oai-turn-trace-id': turnTraceId,
        'x-openai-target-path': '/backend-api/f/conversation',
        'x-openai-target-route': '/backend-api/f/conversation',
        'openai-sentinel-chat-requirements-prepare-token': prepareToken,
        'openai-sentinel-chat-requirements-token': requirementsToken,
        'openai-sentinel-proof-token': proofToken || '',
        'openai-sentinel-turnstile-token': prepareData.turnstile?.dx || '',
        'openai-sentinel-so-token': prepareData.so?.collector_dx || '',
        'openai-sentinel-extra-data': extraData
    });
    conversationHeaders['oai-session-id'] = sessionId;

    // #region agent log
    debugLog(reqId || 'no-req-id', 'H2', 'chatgpt-api-inpage.js:modern', 'conversation.requestShape', {
        model: conversationBody.model,
        conversationModeKind: conversationBody.conversation_mode?.kind || null,
        gizmoId: conversationBody.conversation_mode?.gizmo_id || null,
        blockedFeatures: conversationBody.blocked_features || [],
        supportsBuffering: !!conversationBody.supports_buffering,
        hasClientContextualInfo: !!conversationBody.client_contextual_info,
        hasTimezoneOffset: typeof conversationBody.timezone_offset_min === 'number',
        hasTurnstileHeader: !!conversationHeaders['openai-sentinel-turnstile-token'],
        hasOaiSessionIdHeader: !!conversationHeaders['oai-session-id'],
        usingLegacyRequirementsEndpoint: false
    });
    // #endregion

    let submissionStarted = true;
    try {
    const convRes = await fetch(BASE + '/backend-api/f/conversation', {
        method: 'POST',
        credentials: 'include',
        headers: conversationHeaders,
        body: JSON.stringify(conversationBody)
    });
    if (!convRes.ok) {
        submissionStarted = ![404, 405].includes(convRes.status);
        const errText = await convRes.text();
        throw new Error('API error: ' + convRes.status + ' - ' + errText.substring(0, 200));
    }
    const result = await readConversationStream(convRes, reqId, onChunk, {
        accessToken: session.accessToken,
        pollConversation: true
    });
    return { ...result, transport: 'modern' };
    } catch (error) {
        error.sideAISubmitted = submissionStarted;
        throw error;
    }
}

async function runApiCall(prompt, reqId, onChunk) {
    const BASE = location.origin;
    window.__aiextApiRunCount = (window.__aiextApiRunCount || 0) + 1;
    // #region agent log
    debugLog(reqId || 'no-req-id', 'H1', 'chatgpt-api-inpage.js:225', 'runApiCall.start', {
        apiRunCount: window.__aiextApiRunCount,
        promptLength: typeof prompt === 'string' ? prompt.length : -1,
        usesGizmoInteraction: false,
        blockedFeaturesPlanned: []
    });
    // #endregion
    const sessionHeaders = { 'Accept': '*/*', 'Cache-Control': 'no-cache', 'oai-device-id': getDeviceId(), 'oai-language': 'en-US', 'oai-session-id': getSessionId() };
    Object.assign(sessionHeaders, getClientHeaders());
    const sessionRes = await fetch(BASE + '/api/auth/session', { method: 'GET', credentials: 'include', headers: sessionHeaders });
    if (!sessionRes.ok) throw new Error('Failed to get session - please login to ChatGPT');
    const session = await sessionRes.json();
    if (!session.accessToken) throw new Error('No access token - please login to ChatGPT');
    // #region agent log
    debugLog(reqId || 'no-req-id', 'H5', 'chatgpt-api-inpage.js:228', 'session.capabilityContext', {
        sessionKeys: Object.keys(session || {}).slice(0, 20),
        accountPlan: session.account_plan || session.plan_type || session.user?.plan_type || session.user?.account_plan || null,
        hasTeamWorkspace: !!session.workspace_id,
        hasAccessToken: !!session.accessToken
    });
    // #endregion
    // #region agent log
    debugLog(reqId || 'no-req-id', 'H10', 'chatgpt-api-inpage.js:229', 'client.metadataAvailability', {
        sessionStorageKeys: Object.keys(sessionStorage || {}).filter(k => /oai|conduit|turn|trace|session/i.test(k)).slice(0, 20),
        localStorageKeys: Object.keys(localStorage || {}).filter(k => /oai|conduit|turn|trace|session/i.test(k)).slice(0, 20),
        documentDatasetKeys: Object.keys(document.documentElement?.dataset || {}).slice(0, 20)
    });
    // #endregion

    let result;
    try {
        result = await runModernApiCall(prompt, reqId, onChunk, session);
    } catch (modernError) {
        if (modernError.sideAISubmitted) throw modernError;
        // #region agent log
        debugLog(reqId || 'no-req-id', 'H3', 'chatgpt-api-inpage.js:modernFallback', 'modern.flowFailedFallingBack', {
            message: modernError?.message || 'unknown'
        });
        // #endregion
        result = await runLegacyApiCall(prompt, reqId, onChunk, session);
    }

    if (shouldRecoverFinalText(result)) {
        const recoveredText = await fetchConversationFinalText(result.conversationId, session.accessToken, reqId);
        if (recoveredText && recoveredText !== result.fullText) {
            debugLog(reqId || 'no-req-id', 'STREAM', 'chatgpt-api-inpage.js:runApiCall', 'stream.finalRecoveryApplied', {
                transport: result.transport || null,
                streamTextLength: result.fullText?.length || 0,
                recoveredTextLength: recoveredText.length,
                streamTail: getTextTail(result.fullText || ''),
                recoveredTail: getTextTail(recoveredText)
            });
            result.fullText = recoveredText;
            if (onChunk) onChunk(result.fullText, reqId);
        } else {
            debugLog(reqId || 'no-req-id', 'STREAM', 'chatgpt-api-inpage.js:runApiCall', 'stream.finalRecoverySkipped', {
                transport: result?.transport || null,
                streamTextLength: result?.fullText?.length || 0,
                recoveredTextLength: recoveredText.length,
                reason: recoveredText ? 'same-as-stream' : 'no-recovered-text'
            });
        }
    } else {
        debugLog(reqId || 'no-req-id', 'STREAM', 'chatgpt-api-inpage.js:runApiCall', 'stream.finalRecoveryNotNeeded', {
            transport: result?.transport || null,
            streamTextLength: result?.fullText?.length || 0,
            streamTail: getTextTail(result?.fullText || '')
        });
    }

    // #region agent log
    debugLog(reqId || 'no-req-id', 'H1', 'chatgpt-api-inpage.js:318', 'runApiCall.complete', {
        apiRunCount: window.__aiextApiRunCount,
        transport: result?.transport || null,
        conversationIdPresent: !!result?.conversationId,
        fullTextLength: result?.fullText?.length || 0
    });
    // #endregion
    return { fullText: result.fullText, conversationId: result.conversationId, accessToken: session.accessToken };
}

async function hideConversation(conversationId, accessToken) {
    if (!conversationId || !accessToken) return;
    const BASE = location.origin;
    try {
        await fetch(BASE + '/backend-api/conversation/' + conversationId, {
            method: 'PATCH',
            credentials: 'include',
            headers: getHeaders(accessToken),
            body: JSON.stringify({ is_visible: false })
        });
    } catch (_) {}
}

function sendResponse(reqId, data) {
    if (typeof data.text === 'string') data = { ...data, text: cleanResponseMarkup(data.text) };
    logResponseBridge('google', reqId, data);
    window.postMessage({ type: MSG_PREFIX + 'response', reqId, ...data }, '*');
}

const responseBridgeDebugLengths = {};

function logResponseBridge(channel, id, data) {
    try {
        const key = channel + ':' + (id || 'no-id');
        const textLength = typeof data?.text === 'string' ? data.text.length : 0;
        const previousLength = responseBridgeDebugLengths[key] || 0;
        const shouldLog =
            data?.done ||
            data?.error ||
            textLength < 500 ||
            textLength - previousLength >= 750;
        if (!shouldLog) return;
        responseBridgeDebugLengths[key] = textLength;
        debugLog(id || 'no-id', 'STREAM', 'chatgpt-api-inpage.js:sendResponse', 'stream.inpagePostMessage', {
            channel,
            chunk: !!data?.chunk,
            done: !!data?.done,
            hasError: !!data?.error,
            error: data?.error || null,
            textLength,
            textTail: getTextTail(data?.text || '')
        });
    } catch (_) {}
}

// Check the actual API listener, not a readiness flag from an older document.
window.addEventListener('message', function(e) {
    if (window === window.top || e.source !== window.parent ||
        !/^chrome-extension:\/\/[a-p]{32}$/.test(e.origin) ||
        e.data?.type !== 'SIDEAI_API_HEALTH_CHECK') return;
    e.source.postMessage({ type: 'SIDEAI_API_HEALTH_READY', nonce: e.data.nonce }, e.origin);
});

window.addEventListener('message', function(e) {
    if (e.source !== window || !e.data || e.data.type !== MSG_PREFIX + 'request') return;
    const { reqId, prompt, noBill } = e.data;
    runApiCall(prompt, reqId, (text, id) => {
        sendResponse(id, { text, chunk: true });
    }).then((result) => {
        const { fullText, conversationId, accessToken } = result;
        if (conversationId && accessToken) hideConversation(conversationId, accessToken).catch(() => {});
        sendResponse(reqId, { text: withSideAISources(fullText,reqId), done: true, noBill });
    }).catch((err) => {
        sideAISourceSets.delete(reqId);
        sideAIImageSets.delete(reqId);
        sideAIImageGroups.delete(reqId);
        sendResponse(reqId, { error: err.message });
    });
});

// Writing Assistant - same API, different response format (requestId, WRITING_ASSISTANT_RESPONSE)
window.addEventListener('message', function(e) {
    if (e.source !== window || !e.data || e.data.type !== MSG_PREFIX + 'request-wa') return;
    const { requestId, prompt } = e.data;
    if (!requestId || !prompt) return;
    function sendWa(data) {
        if (typeof data.text === 'string') data = { ...data, text: cleanResponseMarkup(data.text).replace(/\uE200entity\uE202([\s\S]*?)\uE201/g, (_all, payload) => { try { const entity = JSON.parse(payload); return Array.isArray(entity) ? String(entity[1] || '') : ''; } catch (_) { return ''; } }).replace(/\uE200[\s\S]*?\uE201/g, '').replace(/\uE200[^\uE201]*$/, '') };
        if(data.done || data.error)sideAISourceSets.delete(requestId);
        logResponseBridge('writingAssistant', requestId, data);
        window.postMessage({ type: MSG_PREFIX + 'response-wa', requestId, ...data }, '*');
    }
    runApiCall(prompt, requestId, (text) => {
        sendWa({ text, chunk: true });
    }).then((result) => {
        const { fullText, conversationId, accessToken } = result;
        if (conversationId && accessToken) hideConversation(conversationId, accessToken).catch(() => {});
        sendWa({ text: fullText, done: true });
    }).catch((err) => {
        sendWa({ error: err.message });
    });
});

})();
