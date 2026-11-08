// Shared across passes: the tab creates a new HighlightEngine for every scan.
var HighlightThisRenderer = (() => {
    const names = new Set();
    const rangeGroups = new Map();
    const paintTargets = new Set();
    const visibleTargets = new WeakSet();
    let printing = false;
    const visibilityObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(changes => {
        for (const change of changes) {
            // display:contents has visible text but no box for intersection
            // testing. Conservatively keep those ranges eligible for painting.
            const boxlessText = !change.boundingClientRect.width && !change.boundingClientRect.height &&
                getComputedStyle(change.target).display === 'contents';
            if (change.isIntersecting || boxlessText) visibleTargets.add(change.target);
            else visibleTargets.delete(change.target);
        }
        syncPaintRanges();
    }, { rootMargin: '300px' }) : null;
    window.addEventListener('beforeprint', () => { printing = true; syncPaintRanges(); });
    window.addEventListener('afterprint', () => { printing = false; syncPaintRanges(); });
    const observers = new Map();
    const wrappers = new Set();
    const legacyGroups = new Set();
    const textGroups = new WeakMap();
    let entries = [];
    let activeIndex = -1;
    let previousRanges = new WeakMap();
    let nextRanges = new WeakMap();
    let subtreeCache = new WeakMap();
    let cacheInputs = [];
    function invalidate(node) {
        for (let current = node; current; current = current.parentNode || current.host) {
            subtreeCache.delete(current);
        }
    }
    function mutationsChanged(records, schedule = true) {
        let changed = false;
        let attributesChanged = false;
        for (const record of records) {
            if (record.type === 'attributes') {
                // Attribute changes can alter inherited editability/skip rules.
                // Invalidate for the next scan without waking on UI class churn.
                attributesChanged = true;
                continue;
            }
            const element = record.target.nodeType === 1 ? record.target : record.target.parentElement;
            if (element?.closest('head, script, style, noscript, textarea')) continue;
            // Static ranges do not follow text edits. Remove affected paint
            // ranges immediately; the next scan rebuilds the correct offsets.
            if (record.type === 'characterData') {
                const previous = previousRanges.get(record.target);
                if (previous) {
                    for (const range of previous.ranges.values()) {
                        for (const highlight of rangeGroups.values()) highlight.delete(range);
                    }
                    previous.ranges.clear();
                }
            }
            invalidate(record.target);
            changed = true;
        }
        if (attributesChanged) subtreeCache = new WeakMap();
        if (schedule && changed && typeof HighlightPending !== 'undefined') HighlightPending = true;
    }
    // A framework can retain and rewrite the original text node after we split it.
    // Remove only untouched fragments we created, never text changed by the page.
    function repairRewrittenText() {
        for (const group of legacyGroups) {
            const original = group.original;
            if (!original?.isConnected || original.parentNode !== group.parent ||
                original.data === group.snapshots.get(original)) continue;
            const fragments = [...group].filter(node => node !== original);
            if (!fragments.every(node => node.data === group.snapshots.get(node) &&
                (node.parentNode === group.parent ||
                 (node.parentElement?.matches('em.Highlight[Highlight]') && node.parentElement.parentNode === group.parent)))) continue;
            invalidate(group.parent);
            for (const node of fragments) {
                if (node.parentNode === group.parent) node.remove();
                else { wrappers.delete(node.parentElement); node.parentElement.remove(); }
            }
            for (const node of group) textGroups.delete(node);
            legacyGroups.delete(group);
        }
    }
    const supported = !!globalThis.CSS?.highlights && typeof globalThis.Highlight === 'function';

    function observe(root) {
        if (document.readyState === 'loading') return;
        if (typeof Config !== 'undefined' && !Config.updateOnDomChange) return;
        if (observers.has(root)) return;
        const observer = new MutationObserver(records => {
            if (typeof Config !== 'undefined' && !Config.updateOnDomChange) return;
            mutationsChanged(records);
        });
        observer.observe(root, { childList: true, characterData: true, subtree: true,
            attributes: true, attributeFilter: ['class', 'id', 'contenteditable', 'role'] });
        observers.set(root, observer);
    }

    function clearRanges() {
        if (supported) for (const name of names) CSS.highlights.delete(name);
        names.clear();
        rangeGroups.clear();
        visibilityObserver?.disconnect();
        paintTargets.clear();
    }

    function begin() {
        for (const observer of observers.values()) mutationsChanged(observer.takeRecords(), false);
        repairRewrittenText();
        ensureHighlightStyles();
        entries = [];
        nextRanges = new WeakMap();
        for (const [root, observer] of observers) {
            if (root !== document && !root.host.isConnected) {
                observer.disconnect();
                observers.delete(root);
            }
        }
        for (const wrapper of wrappers) {
            if (!wrapper.isConnected) wrappers.delete(wrapper);
        }
        for (const group of legacyGroups) {
            if (![...group].some(node => node.isConnected)) legacyGroups.delete(group);
        }
        observe(document);
    }

    function syncPaintRanges() {
        const groups = new Map();
        for (const entry of entries) {
            if (!entry.range) continue;
            if (!entry.range.startContainer.isConnected || entry.node.data !== entry.text) continue;
            if (!printing && visibilityObserver && !visibleTargets.has(entry.range.startContainer.parentElement)) continue;
            const name = 'highlight-this-' + entry.config.cssClass;
            if (!groups.has(name)) groups.set(name, new Set());
            groups.get(name).add(entry.range);
        }
        // Keep registry objects and unchanged ranges stable. Replacing every
        // Highlight on every pass invalidates browser painting across the page.
        for (const [name, highlight] of rangeGroups) {
            if (!groups.has(name)) {
                CSS.highlights.delete(name);
                rangeGroups.delete(name);
                names.delete(name);
            } else {
                const desired = groups.get(name);
                for (const range of highlight) if (!desired.has(range)) highlight.delete(range);
                for (const range of desired) if (!highlight.has(range)) highlight.add(range);
            }
        }
        for (const [name, ranges] of groups) {
            if (rangeGroups.has(name)) continue;
            const highlight = new globalThis.Highlight();
            for (const range of ranges) highlight.add(range);
            rangeGroups.set(name, highlight);
            CSS.highlights.set(name, highlight);
            names.add(name);
        }
    }

    function finish() {
        // Keep all matches for counts, notifications and navigation, but ask
        // Chrome to paint only ranges near the viewport (including scrollers).
        // Offscreen registered highlights cause substantial native rendering/GC
        // work even when their text has not changed.
        const nextTargets = new Set(entries.filter(entry => entry.range).map(entry => entry.range.startContainer.parentElement));
        for (const target of paintTargets) {
            if (!nextTargets.has(target)) {
                visibilityObserver?.unobserve(target);
                paintTargets.delete(target);
                visibleTargets.delete(target);
            }
        }
        for (const target of nextTargets) {
            if (target && !paintTargets.has(target)) {
                paintTargets.add(target);
                visibilityObserver?.observe(target);
            }
        }
        syncPaintRanges();
        // Ignore our synchronous wrapper/style changes, avoiding observer loops.
        for (const observer of observers.values()) observer.takeRecords();
        previousRanges = nextRanges;
    }

    function clear() {
        repairRewrittenText();
        subtreeCache = new WeakMap();
        cacheInputs = [];
        clearRanges();
        for (const wrapper of wrappers) {
            if (wrapper.parentNode) wrapper.replaceWith(...wrapper.childNodes);
        }
        // Rejoin only adjacent fragments of the same original text node. A
        // parent.normalize() would also merge unrelated text owned by the page.
        for (const group of legacyGroups) {
            for (const node of group) {
                if (!node.parentNode || group.has(node.previousSibling)) continue;
                while (group.has(node.nextSibling)) {
                    const next = node.nextSibling;
                    node.appendData(next.data);
                    next.remove();
                }
            }
            for (const node of group) textGroups.delete(node);
        }
        legacyGroups.clear();
        wrappers.clear();
        entries = [];
        activeIndex = -1;
        previousRanges = new WeakMap();
    }

    function geometry(entry) {
        if (entry.element) return entry.element;
        if (!entry.node?.isConnected || entry.node.data !== entry.text) return null;
        if (typeof entry.range.getClientRects === 'function') return entry.range;
        const range = document.createRange();
        range.setStart(entry.node, entry.start);
        range.setEnd(entry.node, entry.end);
        return range;
    }

    document.addEventListener('click', event => {
        const path = event.composedPath();
        for (const entry of entries) {
            if (!entry.range || !entry.range.startContainer.isConnected || entry.config.action?.type == 0) continue;
            if (!path.includes(entry.range.startContainer.parentElement)) continue;
            const range = geometry(entry);
            if (!range) continue;
            for (const rect of range.getClientRects()) {
                if (event.clientX >= rect.left && event.clientX <= rect.right &&
                    event.clientY >= rect.top && event.clientY <= rect.bottom) {
                    clickHandler(null, entry.config, range.toString());
                    return;
                }
            }
        }
    });

    function jumpToNext() {
        const positions = new Map();
        const visible = entries.filter(entry => {
            const node = entry.range ? entry.range.startContainer : entry.element;
            if (!node.isConnected) return false;
            const position = geometry(entry);
            if (!position || !position.getClientRects().length) return false;
            positions.set(entry, position);
            return true;
        }).sort((a, b) => positions.get(a).getBoundingClientRect().top -
            positions.get(b).getBoundingClientRect().top);
        if (!visible.length) return;
        activeIndex = (activeIndex + 1) % visible.length;
        for (const entry of visible) entry.element?.classList.remove('active');
        const entry = visible[activeIndex];
        if (entry.element) {
            entry.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            entry.element.classList.add('active');
        } else {
            // Scroll to the word itself, even inside a long paragraph or panel.
            for (let parent = entry.range.startContainer.parentElement; parent;
                parent = parent.parentElement || parent.getRootNode().host) {
                if (parent === document.scrollingElement) break;
                const overflow = getComputedStyle(parent).overflowY;
                if (/(auto|scroll)/.test(overflow) && parent.scrollHeight > parent.clientHeight) {
                    const rect = positions.get(entry).getBoundingClientRect();
                    parent.scrollTop += rect.top - parent.getBoundingClientRect().top - parent.clientHeight / 2;
                }
            }
            const rect = positions.get(entry).getBoundingClientRect();
            window.scrollBy({ top: rect.top - window.innerHeight / 2, behavior: 'smooth' });
        }
    }

    return {
        supported, observe, begin, finish, clear, jumpToNext,
        rangeFor(node, start, end) {
            const previous = previousRanges.get(node);
            const range = previous?.text === node.data ? previous.ranges.get(start + ':' + end) : null;
            if (range && range.startContainer === node && range.endContainer === node &&
                range.startOffset === start && range.endOffset === end) return range;
            if (typeof globalThis.StaticRange === 'function') {
                return new StaticRange({ startContainer: node, startOffset: start,
                    endContainer: node, endOffset: end });
            }
            const created = document.createRange();
            created.setStart(node, start);
            created.setEnd(node, end);
            return created;
        },
        cacheFor(...inputs) {
            if (inputs.length !== cacheInputs.length || inputs.some((value, i) => value !== cacheInputs[i])) {
                subtreeCache = new WeakMap();
                cacheInputs = inputs;
            }
            return subtreeCache;
        },
        trackFragments(original, ...fragments) {
            let group = textGroups.get(original);
            if (!group || !legacyGroups.has(group)) {
                group = new Set([original]);
                group.original = original;
                group.parent = original.parentNode;
                group.snapshots = new Map();
                legacyGroups.add(group);
                textGroups.set(original, group);
            }
            for (const node of fragments) {
                group.add(node);
                textGroups.set(node, group);
            }
            for (const node of group) group.snapshots.set(node, node.data);
        },
        add(entry) {
            entries.push(entry);
            if (entry.element) wrappers.add(entry.element);
            if (!entry.range) return true;
            const node = entry.range.startContainer;
            const key = JSON.stringify([entry.range.startOffset, entry.range.endOffset,
                entry.config.cssClass, entry.config.word]);
            if (!nextRanges.has(node)) nextRanges.set(node, { text: node.data, keys: new Set(), ranges: new Map() });
            nextRanges.get(node).keys.add(key);
            nextRanges.get(node).ranges.set(entry.range.startOffset + ':' + entry.range.endOffset, entry.range);
            const previous = previousRanges.get(node);
            return !previous || previous.text !== node.data || !previous.keys.has(key);
        }
    };
})();

function HighlightEngine() {
    const skipTags = /^(?:SCRIPT|HEAD|NOSCRIPT|STYLE|TEXTAREA)$/;

    this.highlight = function (words, printHighlights, regexConfig, skipSelectors, loopNumber) {
        let cache;
        const scannedEntries = [];
        const configsByWord = new Map();
        for (const config of words) {
            if (!configsByWord.has(config.word)) configsByWord.set(config.word, []);
            configsByWord.get(config.word).push(config);
        }
        function addEntry(entry, fresh) {
            scannedEntries.push(entry);
            const isFresh = HighlightThisRenderer.add(entry);
            record(entry.config, fresh && isFresh);
        }
        const markers = {};
        const notifications = new Set();
        let count = 0;
        let notifyAnyway = false;
        const matchRegex = new RegExp(regexConfig.matchRegex || '', 'i');
        const matchRegexCS = new RegExp(regexConfig.matchRegexCS || '');
        const editableRegex = new RegExp(regexConfig.matchRegexEditable || '', 'i');
        const editableRegexCS = new RegExp(regexConfig.matchRegexEditableCS || '');
        const magicRegex = new RegExp(regexConfig.magicRegex || '', 'i');
        const magicRegexCS = new RegExp(regexConfig.magicRegexCS || '');

        function record(config, fresh) {
            markers[count++] = { word: config.word };
            if (fresh && config.notifyOnHighlight) {
                notifications.add(config.word);
                if (config.notifyFrequency == '2') notifyAnyway = true;
            }
        }

        function highlightText(node, editable) {
            const text = node.data;
            if (!text.trim()) return;
            const matches = [];
            let offset = 0;
            while (offset < text.length) {
                // Reuse the existing combined regex and word/group precedence.
                // Advancing past a match replaces the old splitText traversal.
                const remaining = text.slice(offset);
                let insensitive = (editable ? regexConfig.doMatchRegexEditable : regexConfig.doMatchRegex)
                    ? (editable ? editableRegex : matchRegex).exec(remaining) : null;
                const sensitive = (editable ? regexConfig.doMatchRegexEditableCS : regexConfig.doMatchRegexCS)
                    ? (editable ? editableRegexCS : matchRegexCS).exec(remaining) : null;
                if (insensitive && sensitive) {
                    if (insensitive.index > sensitive.index ||
                        (insensitive.index === sensitive.index && sensitive[1]?.length > insensitive[1]?.length)) {
                        insensitive = sensitive;
                    }
                }
                const result = insensitive || sensitive;
                if (!result) break;
                let found = result[1] || result[0];
                let start = result.index + (result[1] ? result[0].indexOf(result[1]) : 0);
                if (!found.length) {
                    offset += result.index + 1;
                    continue;
                }
                const config = words.find(word => {
                    if (editable && !word.showInEditableFields) return false;
                    if (!word.regexTokens && found.length < word.wordLengthForCompare) return false;
                    if (word.containerSelector && !node.parentElement.matches(word.containerSelector)) return false;
                    if (!word.findBackAgainstContent) return word.compiledRegex.test(found);
                    const contextual = word.compiledRegex.exec(result.input);
                    if (!contextual || contextual[0] !== result[1]) return false;
                    found = result[1];
                    start = contextual.index;
                    return true;
                });
                if (config) matches.push({ start: offset + start, end: offset + start + found.length, config });
                offset += start + found.length;
            }

            const useRange = config => Settings.rangeHighlighting === true && HighlightThisRenderer.supported && !config.useLegacyHighlight;
            // Preserve the old flex behavior only when this text needs wrappers.
            if (matches.some(match => !useRange(match.config)) &&
                getComputedStyle(node.parentElement).display === 'flex') {
                const span = document.createElement('span');
                node.replaceWith(span);
                span.appendChild(node);
            }
            // Split legacy matches first, tracking the remaining text segments.
            // Building ranges afterwards also handles adjacent matches, where a
            // live endpoint at a split boundary could otherwise enter a wrapper.
            const segments = [];
            for (let i = matches.length - 1; i >= 0; i--) {
                const { start, end, config } = matches[i];
                if (!useRange(config)) {
                    const matchNode = node.splitText(start);
                    const suffix = matchNode.splitText(end - start);
                    segments.push({ node: suffix, start: end });
                    const element = document.createElement('em');
                    element.classList.add('Highlight', config.cssClass);
                    element.setAttribute('Highlight', 'true');
                    element.setAttribute('htmatch', config.word);
                    element.setAttribute('htloopnumber', loopNumber);
                    element.textContent = matchNode.data;
                    HighlightThisRenderer.trackFragments(node, suffix, element.firstChild);
                    if (config.action?.type != 0) {
                        element.onclick = () => clickHandler(element, config, element.innerText);
                    }
                    matchNode.replaceWith(element);
                    matches[i].entry = { element, config };
                }
            }
            segments.push({ node, start: 0 });
            for (const match of matches) {
                if (useRange(match.config)) {
                    const segment = segments.find(segment => segment.start <= match.start &&
                        segment.start + segment.node.length >= match.end);
                    const range = HighlightThisRenderer.rangeFor(segment.node,
                        match.start - segment.start, match.end - segment.start);
                    match.entry = { range, config: match.config, node: segment.node,
                        start: match.start - segment.start, end: match.end - segment.start,
                        text: segment.node.data };
                }
                addEntry(match.entry, true);
            }
        }

        function visit(node, editable) {
            // Classic wrappers can skip unchanged subtrees. Modern mode walks
            // the tree to discover newly attached shadow roots, reusing ranges
            // independently through rangeFor().
            if (cache && cache.has(node)) {
                for (const entry of cache.get(node)) addEntry(entry, false);
                return;
            }
            const startIndex = scannedEntries.length;
            visitUncached(node, editable);
            if (cache && node.nodeType === Node.ELEMENT_NODE) cache.set(node, scannedEntries.slice(startIndex));
        }
        function visitUncached(node, editable) {
            if (node.nodeType === Node.TEXT_NODE) {
                if (node.parentElement) highlightText(node, editable);
                return;
            }
            if (node.nodeType === Node.ELEMENT_NODE) {
                if (skipTags.test(node.nodeName) || (skipSelectors && node.matches(skipSelectors))) return;
                if (node.matches('em.Highlight[Highlight]')) {
                    const config = (configsByWord.get(node.getAttribute('htmatch')) || []).find(word =>
                        node.classList.contains(word.cssClass));
                    if (config) {
                        addEntry({ element: node, config }, false);
                    }
                    return;
                }
                editable = editable || node.isContentEditable;
                if (node.shadowRoot) {
                    const root = node.shadowRoot;
                    HighlightThisRenderer.observe(root);
                    let style = root.querySelector('style[data-stylename="HighlightThisStyles"]');
                    if (!style) {
                        style = document.createElement('style');
                        style.dataset.stylename = 'HighlightThisStyles';
                        root.appendChild(style);
                    }
                    if (style.textContent !== CSSStyles) style.textContent = CSSStyles;
                    visit(root, editable);
                }
                // Preserve the existing fast subtree rejection while still
                // visiting hosts whose open shadow text isn't in textContent.
                if (regexConfig.useMagicRegex && node.textContent.length < 5000 &&
                    !(regexConfig.doMagicRegex && magicRegex.test(node.textContent)) &&
                    !(regexConfig.doMagicRegexCS && magicRegexCS.test(node.textContent)) &&
                    !Array.from(node.querySelectorAll('*')).some(element => element.shadowRoot)) return;
            }
            // Snapshot children: newly split legacy text is already processed.
            for (const child of Array.from(node.childNodes)) visit(child, editable);
        }

        if (!words.length) HighlightThisRenderer.clear();
        HighlightThisRenderer.begin();
        if ((Settings.rangeHighlighting !== true || !HighlightThisRenderer.supported) &&
            (typeof Config === 'undefined' || Config.updateOnDomChange) &&
            !words.some(word => word.containerSelector)) {
            cache = HighlightThisRenderer.cacheFor(words, regexConfig, skipSelectors, CSSStyles, Settings.rangeHighlighting);
        }
        try {
            if (document.body && words.length) visit(document.body, false);
        } finally {
            HighlightThisRenderer.finish();
        }
        return { numberOfHighlights: count, markers, notify: Array.from(notifications), notifyAnyway };
    };
}
