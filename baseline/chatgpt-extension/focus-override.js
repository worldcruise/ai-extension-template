// Override focus-related functions before the page loads
(() => {
    // Store original functions
    const originalFocus = HTMLElement.prototype.focus;
    const originalBlur = HTMLElement.prototype.blur;

    // Override focus
    HTMLElement.prototype.focus = function(...args) {
        // Only allow focus if explicitly called by user interaction
        if (document.hasFocus() || args.some(arg => arg?.preventScroll === true)) {
            return originalFocus.apply(this, args);
        }
    };

    // Override blur
    HTMLElement.prototype.blur = function(...args) {
        // Always allow blur
        return originalBlur.apply(this, args);
    };

    // Prevent autofocus attribute
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'attributes' && mutation.attributeName === 'autofocus') {
                mutation.target.removeAttribute('autofocus');
            }
        }
    });

    // Start observing as soon as the document is available
    if (document.documentElement) {
        observer.observe(document.documentElement, {
            attributes: true,
            subtree: true,
            attributeFilter: ['autofocus']
        });
    }
})();
