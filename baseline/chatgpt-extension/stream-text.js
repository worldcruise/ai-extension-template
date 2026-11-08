// Preserve completed text while snapshots, citations and model revisions arrive.
(() => {
    if (globalThis.SideAIStreamText) return;
    function stabilize(previous, incoming, done = false) {
        if (typeof incoming !== 'string' || !incoming) return previous || '';
        if (done || !previous || incoming.startsWith(previous)) return incoming;
        if (previous.startsWith(incoming)) return previous;
        // Late image metadata decorates an existing answer; it is not a rewrite
        // of a completed paragraph. Let real pictures replace their placeholders.
        if (/(?:\uE200image_group\uE202|!\[|<img\b)/.test(previous) && /(?:!\[|<img\b)/.test(incoming)) {
            const withoutImages = text => text
                .replace(/\uE200image_group\uE202[^\uE201]*\uE201|\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)|!\[[^\]]*\]\([^)]*\)|<a\b[^>]*>\s*<img\b[^>]*>\s*<\/a>|<img\b[^>]*>|<br\s*\/?>/g, '')
                .replace(/\s+/g, ' ').trim();
            if (withoutImages(incoming).startsWith(withoutImages(previous))) return incoming;
        }
        // The active paragraph may evolve; completed paragraphs remain in place.
        const boundary = previous.lastIndexOf('\n\n') + 2;
        if (boundary > 1 && incoming.startsWith(previous.slice(0, boundary))) return incoming;
        let common = 0;
        while (common < previous.length && common < incoming.length && previous[common] === incoming[common]) common++;
        if (boundary <= 1 && common >= Math.max(24, previous.length * 0.85)) return incoming;
        return previous;
    }
    globalThis.SideAIStreamText = Object.freeze({ stabilize });
})();
