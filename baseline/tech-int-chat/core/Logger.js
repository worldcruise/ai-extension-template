// Deliberately never pass transcript/prompt payloads to the logger.
export const logger = Object.freeze({
    warn(code) { console.warn("[tech-int-chat]", String(code)); }
});
