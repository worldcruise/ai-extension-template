// Screenshot Capture Module
// Based on the Ask-Screenshot-for-ChatGPT-Extension implementation

class ScreenshotCapture {
    constructor() {
        this.host = document.createElement('div');
        this.host.setAttribute('data-screenshot-capture-host', 'true');
        this.host.style.cssText = 'position: fixed; z-index: 2147483647; top: 0; left: 0; width: 100%; height: 100%; pointer-events: auto;';
        
        this.shadow = this.host.attachShadow({ mode: 'closed' });
        this.images = [];
        this.plusEnabled = false;
        this.isMinimal = false;
        this.inSeries = false;
        this.downloadMode = false;
        this.isCancelled = false;
        this.boundOnPointerDown = this.onPointerDown.bind(this);
        this.boundOnPointerMove = this.onPointerMove.bind(this);
        this.boundOnPointerUp = this.onPointerUp.bind(this);
        this.boundOnKeyUp = this.onKeyUp.bind(this);
        
        this.init();
    }

    init() {
        // Create wrapper
        const wrapper = document.createElement('div');
        wrapper.id = 'screenshot-wrapper';
        
        // Create background overlay
        const bg = document.createElement('div');
        bg.id = 'screenshot-bg';
        bg.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background-color: rgba(0, 0, 0, 0.4);
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: all;
        `;
        
        // Create prompt
        const prompt = document.createElement('div');
        prompt.id = 'screenshot-prompt';
        prompt.textContent = 'Drag area for screenshot';
        prompt.style.cssText = `
            background-color: rgba(0, 0, 0, 0.8);
            border: 1px solid #888;
            border-radius: 20px;
            font-size: 30px;
            padding: 15px;
            color: white;
            pointer-events: none;
            font-family: Segoe UI, Avenir, Courier, monospace;
        `;
        
        // Create controls
        const controls = document.createElement('div');
        controls.id = 'screenshot-controls';
        controls.style.cssText = `
            position: fixed;
            right: 10px;
            top: 10px;
            background-color: #000;
            border: 1px solid #aaa;
            border-radius: 10px;
            display: grid;
            grid-auto-flow: column;
            column-gap: 0.1em;
            font-size: 24px;
            padding: 5px;
            pointer-events: all;
        `;
        
        // Create buttons
        this.createButtons(controls);
        
        // Create selection rectangle
        const rect = document.createElement('div');
        rect.className = 'screenshot-rect';
        rect.style.cssText = `
            position: fixed;
            background-color: rgba(255, 255, 255, 0.13);
            border: 2px solid red;
            box-sizing: border-box;
            display: none;
        `;
        
        bg.appendChild(prompt);
        bg.appendChild(rect);
        wrapper.appendChild(bg);
        wrapper.appendChild(controls);
        
        // Create counter badge
        const counter = document.createElement('div');
        counter.id = 'screenshot-counter';
        counter.style.cssText = `
            position: fixed;
            right: 10px;
            top: 70px;
            background-color: #10a37f;
            color: white;
            border-radius: 20px;
            padding: 8px 16px;
            font-size: 16px;
            font-family: Segoe UI, Avenir, sans-serif;
            font-weight: bold;
            display: none;
            pointer-events: none;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        `;
        counter.textContent = '0 screenshots';
        
        wrapper.appendChild(counter);
        this.counter = counter;
        
        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            #screenshot-controls button {
                background-color: initial;
                border: none;
                color: white;
                cursor: pointer;
                font-size: inherit;
                line-height: 0;
                padding: 10px;
                position: relative;
            }
            #screenshot-controls button:hover {
                opacity: 0.75;
            }
            #screenshot-controls button:focus {
                outline: 1px solid #ff0;
            }
            #screenshot-controls button svg {
                pointer-events: none;
                width: 1em;
                height: 1em;
            }
            #screenshot-controls button.toggle.active {
                background-color: #7032ff;
            }
            #screenshot-counter {
                animation: counterPulse 0.3s ease;
            }
            @keyframes counterPulse {
                0% { transform: scale(1); }
                50% { transform: scale(1.1); }
                100% { transform: scale(1); }
            }
        `;
        
        this.shadow.appendChild(style);
        this.shadow.appendChild(wrapper);
        document.documentElement.appendChild(this.host);
        
        // Store references
        this.bg = bg;
        this.prompt = prompt;
        this.controls = controls;
        this.rect = rect;
        this.wrapper = wrapper;
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Focus first button
        this.controls.querySelector('button')?.focus();
    }

    createButtons(container) {
        // Close button
        this.closeButton = this.createButton(container, 'close', `
            <svg viewBox="0 0 512 512" fill="currentColor">
                <path d="M400 145.49 366.51 112 256 222.51 145.49 112 112 145.49 222.51 256 112 366.51 145.49 400 256 289.49 366.51 400 400 366.51 289.49 256 400 145.49z"/>
            </svg>
        `, 'Cancel');
        
        // Fullscreen button (visible area)
        this.fsButton = this.createButton(container, 'fs', `
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M18 7H22V9H16V3H18V7ZM8 9H2V7H6V3H8V9ZM18 17V21H16V15H22V17H18ZM8 15V21H6V17H2V15H8Z"/>
            </svg>
        `, 'Screenshot visible');
        
        // Full page button
        this.fullPageButton = this.createButton(container, 'fullPage', `
            <svg viewBox="0 0 512 512" fill="none" stroke="currentColor" stroke-width="32" stroke-linejoin="round">
                <path d="M416 221.25V416a48 48 0 0 1-48 48H144a48 48 0 0 1-48-48V96a48 48 0 0 1 48-48h98.75a32 32 0 0 1 22.62 9.37l141.26 141.26a32 32 0 0 1 9.37 22.62z"/>
                <path stroke-linecap="round" d="M256 56v120a32 32 0 0 0 32 32h120"/>
            </svg>
        `, 'Screenshot page');
        
        // Plus button (multiple screenshots)
        this.plusButton = this.createButton(container, 'plusOne toggle', `
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path fill="none" d="M0 0h24v24H0V0z"/>
                <path d="M10 8H8v4H4v2h4v4h2v-4h4v-2h-4V8zm4.5-1.92V7.9l2.5-.5V18h2V5l-4.5 1.08z"/>
            </svg>
        `, 'Multiple screenshots');
        
        // Check button (send)
        this.checkButton = this.createButton(container, 'check', `
            <svg viewBox="0 0 448 512" fill="currentColor">
                <path d="M438.6 105.4c12.5 12.5 12.5 32.8 0 45.3l-256 256c-12.5 12.5-32.8 12.5-45.3 0l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0L160 338.7 393.4 105.4c12.5-12.5 32.8-12.5 45.3 0z"/>
            </svg>
        `, 'Send');
    }

    createButton(container, className, svg, tooltip) {
        const button = document.createElement('button');
        button.className = className;
        button.innerHTML = svg;
        button.setAttribute('title', tooltip);
        container.appendChild(button);
        return button;
    }

    setupEventListeners() {
        // Button clicks
        this.closeButton.addEventListener('click', () => this.cancel());
        this.fsButton.addEventListener('click', () => this.handleStandard(null, true));
        this.fullPageButton.addEventListener('click', () => this.completeFullpage());
        this.checkButton.addEventListener('click', () => this.completeCheck());
        this.plusButton.addEventListener('click', () => {
            this.plusEnabled = !this.plusEnabled;
            this.plusButton.classList.toggle('active', this.plusEnabled);
            this.updateCounter(); // Show/hide counter based on mode
            this.plusButton.focus();
        });
        
        // Pointer events for selection
        window.addEventListener('pointerdown', this.boundOnPointerDown, true);
        window.addEventListener('pointermove', this.boundOnPointerMove, true);
        window.addEventListener('pointerup', this.boundOnPointerUp, true);
        window.addEventListener('keyup', this.boundOnKeyUp, true);
    }

    onPointerDown(e) {
        // Check if click is on the overlay background (not on buttons)
        const path = e.composedPath();
        const isOnControls = path.some(el => el === this.controls || el.id === 'screenshot-controls');
        const isOnBg = path.some(el => el === this.bg || el === this.host);
        
        if (isOnBg && !isOnControls) {
            this.startSelection(e);
        }
    }

    onPointerMove(e) {
        if (this.isSelecting) {
            this.updateSelection(e);
        }
    }

    onPointerUp(e) {
        if (this.isSelecting) {
            this.endSelection(e);
        }
    }

    onKeyUp(e) {
        if (e.key === 'Escape' || e.key === ' ') {
            this.cancel();
        } else if (e.key === 'Enter' && this.shadow.activeElement?.tagName === 'BUTTON') {
            this.shadow.activeElement.click();
        }
    }

    startSelection(e) {
        this.isSelecting = true;
        this.startX = e.clientX;
        this.startY = e.clientY;
        this.rect.style.display = 'block';
        this.rect.style.left = `${e.clientX}px`;
        this.rect.style.top = `${e.clientY}px`;
        this.rect.style.width = '0px';
        this.rect.style.height = '0px';
    }

    updateSelection(e) {
        const x = Math.min(this.startX, e.clientX);
        const y = Math.min(this.startY, e.clientY);
        const w = Math.abs(e.clientX - this.startX);
        const h = Math.abs(e.clientY - this.startY);
        
        this.rect.style.left = `${x}px`;
        this.rect.style.top = `${y}px`;
        this.rect.style.width = `${w}px`;
        this.rect.style.height = `${h}px`;
    }

    endSelection(e) {
        this.isSelecting = false;
        const w = Math.abs(e.clientX - this.startX);
        const h = Math.abs(e.clientY - this.startY);
        
        if (w > 25 && h > 25) {
            const bounds = {
                x: Math.min(this.startX, e.clientX),
                y: Math.min(this.startY, e.clientY),
                w: w,
                h: h
            };
            this.handleStandard(bounds, false);
        } else {
            this.rect.style.display = 'none';
        }
    }

    async handleStandard(bounds, visibleOnly) {
        this.controls.remove();
        this.prompt.remove();
        this.bg.style.backgroundColor = 'unset';
        this.rect.style.display = 'none';

        // Hide the overlay before snapshotting so captureVisibleTab doesn't
        // include the dim backdrop, prompt, or controls.
        const prevDisplay = this.host.style.display;
        this.host.style.display = 'none';
        await new Promise(r => requestAnimationFrame(r));
        await new Promise(r => requestAnimationFrame(r));
        await new Promise(r => setTimeout(r, 30));

        const screenshot = await this.getScreenshot(bounds, visibleOnly);

        this.host.style.display = prevDisplay;
        if (this.isCancelled) return;

        if (screenshot) {
            this.images.push(screenshot);
            this.updateCounter();

            if (!visibleOnly && this.plusEnabled) {
                this.isMinimal = true;
                this.inSeries = true;
                this.syncUI();
            } else {
                this.completeCheck();
            }
        } else {
            this.cancel();
        }
    }
    
    updateCounter() {
        if (this.counter) {
            const count = this.images.length;
            // Show counter when in multi-screenshot mode OR when we have multiple images
            if (count > 0 && (this.plusEnabled || this.inSeries || count > 1)) {
                this.counter.style.display = 'block';
                this.counter.textContent = count === 1 ? '1 screenshot' : `${count} screenshots`;
                // Trigger animation
                this.counter.style.animation = 'none';
                this.counter.offsetHeight; // Force reflow
                this.counter.style.animation = 'counterPulse 0.3s ease';
            } else {
                this.counter.style.display = 'none';
            }
        }
    }

    async getScreenshot(bounds, visibleOnly) {
        try {
            // Request screenshot from background script
            const requestScreenshot = () => {
                return new Promise((resolve) => {
                    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                        chrome.runtime.sendMessage({ type: 'REQUEST_SCREENSHOT' }, (dataUrl) => {
                            if (chrome.runtime.lastError) {
                                console.error('[Screenshot Capture] Error requesting screenshot:', chrome.runtime.lastError);
                                resolve(null);
                            } else {
                                resolve(dataUrl);
                            }
                        });
                    } else {
                        // If chrome APIs not available, try to get from window (if injected by content script)
                        if (window.__screenshotRequest) {
                            window.__screenshotRequest().then(resolve).catch(() => resolve(null));
                        } else {
                            console.error('[Screenshot Capture] Chrome APIs not available');
                            resolve(null);
                        }
                    }
                });
            };
            
            if (visibleOnly) {
                // Capture visible area
                const dataUrl = await requestScreenshot();
                return dataUrl;
            } else if (bounds) {
                // Capture selected area
                const fullScreenshot = await requestScreenshot();
                if (!fullScreenshot) return null;
                
                // Crop to bounds
                return await this.cropImage(fullScreenshot, bounds);
            } else {
                // Default: capture visible area
                const dataUrl = await requestScreenshot();
                return dataUrl;
            }
        } catch (error) {
            console.error('Error capturing screenshot:', error);
            return null;
        }
    }

    async cropImage(dataUrl, bounds) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = bounds.w;
                canvas.height = bounds.h;
                const ctx = canvas.getContext('2d');
                
                const scaleX = img.width / window.innerWidth;
                const scaleY = img.height / window.innerHeight;
                
                ctx.drawImage(
                    img,
                    bounds.x * scaleX,
                    bounds.y * scaleY,
                    bounds.w * scaleX,
                    bounds.h * scaleY,
                    0,
                    0,
                    bounds.w,
                    bounds.h
                );
                
                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = () => resolve(null);
            img.src = dataUrl;
        });
    }

    async completeFullpage() {
        this.bg.style.display = 'none';
        await new Promise(resolve => setTimeout(resolve, 300));
        
        try {
            const fullPageScreenshot = await this.captureFullPage();
            if (fullPageScreenshot) {
                this.images.push(fullPageScreenshot);
                this.inSeries = true;
                this.updateCounter();
            }
        } catch (error) {
            console.error('Error capturing full page:', error);
        }

        if (!this.images.length) {
            this.cancel();
            return;
        }

        // Do not send here; wait for user to click Send (check) button
        this.bg.style.display = '';
        this.isMinimal = true;
        this.inSeries = true;
        this.syncUI();
    }

    async captureFullPage() {
        const screenshots = [];
        const scrollElement = document.scrollingElement;
        let scrollTop = 0;
        let cancelled = false;
        
        const cancelHandler = () => {
            cancelled = true;
            this.isCancelled = true;
        };
        window.addEventListener('keyup', cancelHandler);
        window.addEventListener('pointerdown', cancelHandler);
        
        try {
            while (scrollTop < scrollElement.scrollHeight && !cancelled) {
                scrollElement.scrollTop = scrollTop;
                await new Promise(resolve => setTimeout(resolve, 750));
                
                const screenshot = await chrome.runtime.sendMessage({ type: 'REQUEST_SCREENSHOT' });
                if (screenshot) {
                    screenshots.push([screenshot, scrollTop]);
                }
                
                scrollTop += window.innerHeight;
            }
            
            if (cancelled || !screenshots.length) return null;
            
            // Combine screenshots
            return await this.mergeScreenshots(screenshots);
        } finally {
            window.removeEventListener('keyup', cancelHandler);
            window.removeEventListener('pointerdown', cancelHandler);
        }
    }

    async mergeScreenshots(screenshots) {
        const images = await Promise.all(screenshots.map(([dataUrl]) => {
            return new Promise((resolve) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => resolve(null);
                img.src = dataUrl;
            });
        }));
        
        const validImages = images.filter(img => img !== null);
        if (!validImages.length) return null;
        
        const lastScroll = screenshots[screenshots.length - 1][1];
        const totalHeight = lastScroll + window.innerHeight;
        const maxWidth = Math.max(...validImages.map(img => img.width));
        
        const canvas = document.createElement('canvas');
        canvas.width = maxWidth;
        canvas.height = totalHeight;
        const ctx = canvas.getContext('2d');
        
        let y = 0;
        validImages.forEach((img, index) => {
            const scrollTop = screenshots[index][1];
            ctx.drawImage(img, 0, scrollTop, img.width, img.height);
        });
        
        return canvas.toDataURL('image/png');
    }

    syncUI() {
        this.plusButton.classList.toggle('active', this.plusEnabled);
        
        // Rebuild controls
        this.controls.innerHTML = '';
        this.createButtons(this.controls);
        this.setupEventListeners();
        
        if (this.isMinimal) {
            this.wrapper.appendChild(this.controls);
            this.bg.style.backgroundColor = 'unset';
        } else {
            this.bg.appendChild(this.controls);
            this.bg.style.backgroundColor = null;
        }
        
        // Update counter visibility
        this.updateCounter();
    }

    completeCheck() {
        this.complete([...this.images]);
    }

    cancel() {
        this.isCancelled = true;
        this.complete([]);
    }

    complete(images = []) {
        if (this.onComplete) {
            this.onComplete(Array.isArray(images) ? images : []);
        }
        this.release();
    }

    release() {
        window.removeEventListener('pointerdown', this.boundOnPointerDown, true);
        window.removeEventListener('pointermove', this.boundOnPointerMove, true);
        window.removeEventListener('pointerup', this.boundOnPointerUp, true);
        window.removeEventListener('keyup', this.boundOnKeyUp, true);
        this.host?.remove();
    }

    static async capture(options = {}) {
        return new Promise((resolve) => {
            const capture = new ScreenshotCapture();
            capture.onComplete = (images) => {
                resolve(images || []);
            };
        });
    }
}

function showScreenshotHintToast() {
    const existing = document.getElementById('ai-screenshot-hint-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'ai-screenshot-hint-toast';
    toast.setAttribute('style', [
        'position:fixed',
        'z-index:2147483647',
        'top:24px',
        'left:50%',
        'transform:translateX(-50%)',
        'background:#111',
        'color:#fff',
        'padding:14px 18px',
        'border-radius:10px',
        'font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
        'box-shadow:0 8px 24px rgba(0,0,0,0.3)',
        'max-width:460px',
        'text-align:center'
    ].join(';'));
    toast.innerHTML = `
        <div style="font-weight:600;margin-bottom:6px;">Enable one-click screenshots</div>
        <div style="opacity:.85;margin-bottom:10px;">
          Grant sites access once so SideAI can capture screenshots when you ask.
        </div>
        <button id="ai-screenshot-grant-btn" style="
          background:#10a37f;color:#fff;border:0;border-radius:8px;
          padding:8px 14px;font:600 13px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
          cursor:pointer;">Grant access</button>
        <button id="ai-screenshot-dismiss-btn" style="
          background:transparent;color:#fff;border:1px solid #444;border-radius:8px;
          padding:8px 14px;margin-left:6px;font:500 13px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
          cursor:pointer;">Dismiss</button>`;

    document.body.appendChild(toast);
    const dismiss = () => { try { toast.remove(); } catch (_) {} };
    toast.querySelector('#ai-screenshot-grant-btn')?.addEventListener('click', () => {
        try { chrome.runtime.sendMessage({ type: 'OPEN_GRANT_PAGE' }); } catch (_) {}
        dismiss();
    });
    toast.querySelector('#ai-screenshot-dismiss-btn')?.addEventListener('click', dismiss);
}

function showScreenshotGrantedToast() {
    const existing = document.getElementById('ai-screenshot-granted-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'ai-screenshot-granted-toast';
    toast.setAttribute('style', [
        'position:fixed',
        'z-index:2147483647',
        'top:24px',
        'left:50%',
        'transform:translateX(-50%)',
        'background:#10a37f',
        'color:#fff',
        'padding:12px 16px 12px 18px',
        'border-radius:10px',
        'font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
        'box-shadow:0 8px 24px rgba(0,0,0,0.35)',
        'max-width:460px',
        'display:flex',
        'align-items:center',
        'gap:12px',
        'pointer-events:auto'
    ].join(';'));
    toast.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
             style="flex-shrink:0;">
            <path d="M20 6 9 17l-5-5"/>
        </svg>
        <div style="text-align:left;flex:1;">
            <div style="font-weight:600;">Access granted</div>
            <div style="opacity:.9;font-size:13px;">Re-select the area you want to screenshot.</div>
        </div>
        <button id="ai-screenshot-granted-close" aria-label="Dismiss" style="
            background:transparent;border:0;color:#fff;opacity:.85;cursor:pointer;
            padding:4px;margin:-4px -4px -4px 4px;line-height:0;border-radius:6px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
        </button>`;

    document.documentElement.appendChild(toast);
    const lift = () => {
        try {
            if (toast.parentNode === document.documentElement &&
                document.documentElement.lastElementChild !== toast) {
                document.documentElement.appendChild(toast);
            }
        } catch (_) {}
    };
    const observer = new MutationObserver(lift);
    observer.observe(document.documentElement, { childList: true });
    const intervalId = setInterval(lift, 150);
    setTimeout(() => clearInterval(intervalId), 1500);

    const cleanup = () => {
        try { observer.disconnect(); } catch (_) {}
        try { clearInterval(intervalId); } catch (_) {}
        try { toast.remove(); } catch (_) {}
    };
    toast.querySelector('#ai-screenshot-granted-close')?.addEventListener('click', cleanup);
}

// Listen for messages from background script (only if chrome.runtime is available)
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    // Check if listener is already added to avoid duplicates
    if (!window.__screenshotCaptureListenerAdded) {
        window.__screenshotCaptureListenerAdded = true;
        
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.type === 'PING_SCREENSHOT_CAPTURE') {
                sendResponse({ ready: true });
                return false;
            }

            if (request.type === 'SHOW_SCREENSHOT_HINT') {
                try { showScreenshotHintToast(); } catch (error) { console.warn('[Screenshot Capture] hint toast failed:', error); }
                sendResponse({ success: true });
                return false;
            }

            if (request.type === 'SHOW_SCREENSHOT_GRANTED') {
                try { showScreenshotGrantedToast(); } catch (error) { console.warn('[Screenshot Capture] granted toast failed:', error); }
                sendResponse({ success: true });
                return false;
            }

            if (request.type === 'START_CAPTURE') {
                console.log('[Screenshot Capture] Starting capture UI on page...');
                
                // Remove any existing capture UI
                const existingHost = document.querySelector('[data-screenshot-capture-host]');
                if (existingHost) {
                    existingHost.remove();
                }
                
                // Start screenshot capture
                ScreenshotCapture.capture().then((images) => {
                    console.log('[Screenshot Capture] Capture completed, images:', images?.length || 0);
                    
                    // Send images back via sendResponse
                    sendResponse({ 
                        success: true,
                        images: images || []
                    });
                }).catch((error) => {
                    console.error('[Screenshot Capture] Error:', error);
                    sendResponse({ success: false, error: error.message });
                });
                
                return true; // Will send response asynchronously
            }
            
            return false;
        });
    }
}

// Export for use in other scripts
if (typeof window !== 'undefined') {
    window.ScreenshotCapture = ScreenshotCapture;
}
