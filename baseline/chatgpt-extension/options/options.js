// Returns icon HTML: .svg → img; else → Font Awesome
function getIconHtml(item) {
    if (item.icon?.endsWith('.svg')) {
        return `<img src="${chrome.runtime.getURL(`icons/${item.icon}`)}" alt="${item.name}">`;
    }
    return `<i class="fas fa-${(item.icon || 'lightbulb').replace(/^fa-/, '')}"></i>`;
}

function buildSideAITrackedUrl(rawUrl, source) {
    if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
    try {
        const url = new URL(rawUrl);
        if (url.hostname !== 'sideai.app') return rawUrl;
        url.searchParams.set('utm_source', source);
        url.searchParams.set('utm_medium', 'chrome_extension');
        url.searchParams.set('utm_campaign', 'sideai_extension');
        return url.toString();
    } catch (_) {
        return rawUrl;
    }
}


// Default prompts that can't be deleted
const DEFAULT_PROMPTS = [
    { id: 'copy', name: 'Copy', icon: 'copy.svg', pinned: true },
    // { id: 'read', name: 'Read aloud', icon: 'sound.svg', pinned: false },
    { id: 'improve', name: 'Improve writing', icon: 'improve.svg', pinned: true },
    { id: 'continue', name: 'Continue writing', icon: 'continue.svg', pinned: false },
    { id: 'explain', name: 'Explain', icon: 'explain.svg', pinned: true },
    { id: 'summarize', name: 'Summarize', icon: 'summarize.svg', pinned: false },
    { id: 'answer', name: 'Answer this question', icon: 'answer.svg', pinned: true },
    { id: 'fix', name: 'Fix spelling & grammar', icon: 'spell.svg', pinned: false },
    { id: 'translate', name: 'Translate into', icon: 'translate.svg', pinned: false, hasSubmenu: true },
    { id: 'shorter', name: 'Make shorter', icon: 'shorter.svg', pinned: false },
    { id: 'longer', name: 'Make longer', icon: 'longer.svg', pinned: false }
];

// Default menu items
const DEFAULT_MENU_ITEMS = [
    { id: 'copy', name: 'Copy', icon: 'copy.svg', pinned: true },
    // { id: 'read', name: 'Read aloud', icon: 'sound.svg', pinned: false },
    { id: 'improve', name: 'Improve writing', icon: 'improve.svg', pinned: true },
    { id: 'continue', name: 'Continue writing', icon: 'continue.svg', pinned: false },
    { id: 'explain', name: 'Explain', icon: 'explain.svg', pinned: true },
    { id: 'summarize', name: 'Summarize', icon: 'summarize.svg', pinned: false },
    { id: 'answer', name: 'Answer this question', icon: 'answer.svg', pinned: true },
    { id: 'fix', name: 'Fix spelling & grammar', icon: 'spell.svg', pinned: false },
    { id: 'translate', name: 'Translate into', icon: 'translate.svg', pinned: false, hasSubmenu: true },
    { id: 'shorter', name: 'Make shorter', icon: 'shorter.svg', pinned: false },
    { id: 'longer', name: 'Make longer', icon: 'longer.svg', pinned: false }
];

const AVAILABLE_ICONS = [
    'book-bookmark', 'circle-question',
    'lightbulb', 'magic', 'wand-magic-sparkles', 'brain', 'comment', 'comments',
    'pen', 'pencil', 'highlighter', 'marker', 'paint-brush', 'paintbrush',
    'copy', 'paste', 'scissors', 'cut', 'clone', 'layer-group',
    'book', 'bookmark', 'note-sticky',
    'language', 'globe', 'earth-americas', 'flag', 'map',
    'chart-line', 'chart-bar', 'chart-pie', 'chart-simple', 'chart-column', 'chart-area',
    'check', 'xmark', 'plus', 'minus', 'times', 'equals',
    'compress', 'expand', 'minimize', 'maximize', 'arrows-up-down', 'arrows-left-right',
    'star', 'heart', 'thumbs-up', 'thumbs-down', 'smile', 'face-smile',
    'robot', 'microchip', 'code', 'terminal', 'keyboard', 'desktop',
    'gear', 'gears', 'wrench', 'screwdriver-wrench', 'sliders', 'gauge',
    'clock', 'hourglass', 'calendar', 'bell', 'envelope', 'paper-plane',
    'volume-high', 'pen-to-square', 'spell-check'
];

function getDefaultUsageDataForAll() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return {
        isLicensed: false,
        planType: null,
        expiresAt: null,
        resetTime: tomorrow.toISOString(),
        textMenu: { count: 0, limit: 3 },
        google: { count: 0, limit: 10 },
        writingAssistant: { count: 0, limit: 3 },
        screenshot: { count: 0, limit: 3 }
    };
}

class OptionsManager {
    constructor() {
        this.showList = document.getElementById('showList');
        this.hideList = document.getElementById('hideList');
        this.newItemBtn = document.getElementById('newPromptBtn');
        this.modal = document.getElementById('promptModal');
        this.tabs = document.querySelectorAll('.tab');
        this.menuItems = [];
        this.hiddenItems = [];
        this.selectedIcon = 'lightbulb';
        this.blockedSites = [];
        this.globalDisabled = false;
        
        this.init();
        this.setupIconSearch();
        this.setupMessageListener();
        this.setupBlockedSites();

        // Setup icon picker close and done buttons
        const iconPickerCloseBtn = document.querySelector('#iconPickerModal .close-btn');
        const iconPickerDoneBtn = document.querySelector('#iconPickerModal .done-btn');
        iconPickerCloseBtn.addEventListener('click', () => this.closeIconPicker());
        iconPickerDoneBtn.addEventListener('click', () => this.handleIconPickerDone());
    }

    setupMessageListener() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if ((request.type === 'switchOptionsTab' && request.tab) || 
                (request.type === 'openOptions' && request.section)) {
                // Get the tab name from either tab or section parameter
                const tabName = request.tab || request.section;
                
                // Find the tab button with matching data-tab attribute
                const tabButton = Array.from(this.tabs).find(tab => 
                    tab.getAttribute('data-tab') === tabName
                );
                
                if (tabButton) {
                    // Simulate a click on the tab button
                    tabButton.click();
                }
            } else if (request.type === 'blocked-sites-updated') {
                // Update blocked sites list when changes occur
                this.setupBlockedSites();
            }
        });
    }

    async init() {
        await this.loadState();
        this.setupEventListeners();
        this.setupDragAndDrop();
        this.renderLists();
        this.setupUsageAndLicense();
        await this.setupShortcuts();
        this.updateBlockedSitesFullscreenMode();
    }

    async setupShortcuts() {
        await setupSideAIShortcutSettings();
    }

    isDefaultItemId(id) {
        return DEFAULT_MENU_ITEMS.some(def => def.id === id);
    }

    uniqueIds(ids = []) {
        const seen = new Set();
        return (Array.isArray(ids) ? ids : []).filter(id => {
            if (!id || seen.has(id)) return false;
            seen.add(id);
            return true;
        });
    }

    normalizeMenuItems(items = []) {
        const seen = new Set();
        return (Array.isArray(items) ? items : [])
            .filter(item => item && typeof item.id === 'string' && item.id.trim())
            .filter(item => {
                if (seen.has(item.id)) return false;
                seen.add(item.id);
                return true;
            });
    }

    async loadState() {
        const { menuItems = DEFAULT_MENU_ITEMS, hiddenItems = [], customItems = [] } = 
            await chrome.storage.sync.get(['menuItems', 'hiddenItems', 'customItems']);

        const storedMenuItems = Array.isArray(menuItems) && menuItems.length ? menuItems : DEFAULT_MENU_ITEMS;
        const storedCustomItems = Array.isArray(customItems) ? customItems : [];
        const combinedById = new Map();

        storedMenuItems.forEach(item => {
            if (item?.id) combinedById.set(item.id, item);
        });
        // Custom items are the source of truth for user-created action details.
        storedCustomItems.forEach(item => {
            if (item?.id) combinedById.set(item.id, item);
        });

        const uniqueHiddenItems = this.uniqueIds(hiddenItems);
        const needsStorageCleanup =
            combinedById.size !== storedMenuItems.length + storedCustomItems.length ||
            storedMenuItems.some(item => item?.id && !this.isDefaultItemId(item.id)) ||
            uniqueHiddenItems.length !== (Array.isArray(hiddenItems) ? hiddenItems.length : 0);

        this.menuItems = this.normalizeMenuItems(Array.from(combinedById.values())).sort((a, b) => {
            const orderA = a.order !== undefined ? a.order : Number.MAX_SAFE_INTEGER;
            const orderB = b.order !== undefined ? b.order : Number.MAX_SAFE_INTEGER;
            return orderA - orderB;
        });
        this.hiddenItems = uniqueHiddenItems;

        // Migration: ensure "Explain" is in the list (was missing from older defaults)
        if (!this.menuItems.some(item => item.id === 'explain')) {
            const explainItem = DEFAULT_MENU_ITEMS.find(d => d.id === 'explain');
            if (explainItem) {
                const continueIdx = this.menuItems.findIndex(i => i.id === 'continue');
                const insertAt = continueIdx >= 0 ? continueIdx + 1 : 0;
                this.menuItems.splice(insertAt, 0, { ...explainItem });
                await this.saveState();
            }
        }
        // Migration: ensure "Answer this question" is in the list
        if (!this.menuItems.some(item => item.id === 'answer')) {
            const answerItem = DEFAULT_MENU_ITEMS.find(d => d.id === 'answer');
            if (answerItem) {
                const summarizeIdx = this.menuItems.findIndex(i => i.id === 'summarize');
                const insertAt = summarizeIdx >= 0 ? summarizeIdx + 1 : 0;
                this.menuItems.splice(insertAt, 0, { ...answerItem });
                await this.saveState();
            }
        }
        // Migration: use static SVG icons for Explain/Answer (instant load, no Font Awesome delay)
        let iconFixed = false;
        this.menuItems.forEach(item => {
            if (item.id === 'explain' && item.icon !== 'explain.svg') {
                item.icon = 'explain.svg';
                iconFixed = true;
            } else if (item.id === 'answer' && item.icon !== 'answer.svg') {
                item.icon = 'answer.svg';
                iconFixed = true;
            }
        });
        if (iconFixed) await this.saveState();
        if (needsStorageCleanup) await this.saveState();
    }

    async saveState() {
        this.hiddenItems = this.uniqueIds(this.hiddenItems);
        this.menuItems = this.normalizeMenuItems(this.menuItems)
            .map((item, index) => ({ ...item, order: index }));

        const customItems = this.menuItems.filter(item => !this.isDefaultItemId(item.id));
        const defaultItems = this.menuItems.filter(item => this.isDefaultItemId(item.id));
        
        await chrome.storage.sync.set({
            menuItems: defaultItems,
            customItems: customItems,
            hiddenItems: this.hiddenItems
        });
    }

    renderLists() {
        // Clear both lists
        this.showList.innerHTML = '';
        this.hideList.innerHTML = '';

        // Sort items into visible and hidden
        const visibleItems = this.menuItems.filter(item => !this.hiddenItems.includes(item.id));
        const hiddenItems = this.menuItems.filter(item => this.hiddenItems.includes(item.id));

        // Render visible items
        visibleItems.forEach(item => {
            this.showList.appendChild(this.createMenuItem(item));
        });

        // Render hidden items
        hiddenItems.forEach(item => {
            this.hideList.appendChild(this.createMenuItem(item));
        });
    }

    setupEventListeners() {
        // New item button
        this.newItemBtn.addEventListener('click', () => this.openModal());

        // Tab switching
        this.tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const tabId = tab.getAttribute('data-tab');
                this.tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                
                document.querySelectorAll('.tab-content').forEach(content => {
                    content.classList.remove('active');
                });
                document.getElementById(`${tabId}-tab`).classList.add('active');
                this.updateBlockedSitesFullscreenMode(tabId);
            });
        });

        // Modal events
        document.querySelector('.close-btn').addEventListener('click', () => this.closeModal());
        document.querySelector('.cancel-btn').addEventListener('click', () => this.closeModal());
        document.querySelector('.save-btn').addEventListener('click', () => this.saveItem());
        document.querySelector('.icon-picker-btn').addEventListener('click', () => this.openIconPicker());

        // Scene checkbox logic
        const sceneWriting = document.getElementById('sceneWriting');
        const sceneReading = document.getElementById('sceneReading');
        const sceneAll = document.getElementById('sceneAll');
        sceneAll.addEventListener('change', () => {
            if (sceneAll.checked) {
                sceneWriting.checked = true;
                sceneReading.checked = true;
            }
        });
        const syncAllCheckbox = () => {
            sceneAll.checked = sceneWriting.checked && sceneReading.checked;
        };
        sceneWriting.addEventListener('change', syncAllCheckbox);
        sceneReading.addEventListener('change', syncAllCheckbox);

        // Item actions (edit, delete, pin/unpin)
        [this.showList, this.hideList].forEach(list => {
            list.addEventListener('click', async (e) => {
                const menuItem = e.target.closest('.menu-item');
                if (!menuItem) return;

                if (e.target.closest('.ai-menu-pin')) {
                    await this.toggleItemVisibility(menuItem.dataset.id);
                } else if (e.target.closest('.edit-btn')) {
                    const item = this.menuItems.find(i => i.id === menuItem.dataset.id);
                    if (item) this.openModal(item);
                } else if (e.target.closest('.delete-btn')) {
                    await this.deleteItem(menuItem.dataset.id);
                }
            });
        });
    }

    updateBlockedSitesFullscreenMode(forcedTabId = null) {
        const activeTabId = forcedTabId || document.querySelector('.tab.active')?.getAttribute('data-tab');
        const shouldUseFullscreenGrid = activeTabId === 'blocked-sites';
        document.body.classList.toggle('blocked-sites-fullscreen', shouldUseFullscreenGrid);
    }

    setupDragAndDrop() {
        [this.showList, this.hideList].forEach(container => {
            container.addEventListener('dragover', e => {
                e.preventDefault();
                const draggable = document.querySelector('.dragging');
                if (!draggable) return;
                
                const afterElement = this.getDragAfterElement(container, e.clientY);
                if (afterElement) {
                    container.insertBefore(draggable, afterElement);
                } else {
                    container.appendChild(draggable);
                }
            });
        });

        // Drag and drop functionality
        document.addEventListener('dragstart', e => {
            const menuItem = e.target.closest('.menu-item');
            if (menuItem) {
                const sourceList = menuItem.closest('.menu-list');
                menuItem.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/html', menuItem.outerHTML);
                e.dataTransfer.setData('text/plain', menuItem.dataset.id);
                if (sourceList && sourceList.id) e.dataTransfer.setData('application/x-source-list-id', sourceList.id);
            }
        });

        document.addEventListener('dragend', e => {
            const menuItem = e.target.closest('.menu-item');
            if (menuItem) {
                menuItem.classList.remove('dragging');
                this.cleanupDragState();
            }
        });

        document.addEventListener('dragover', e => {
            e.preventDefault();
            const menuList = e.target.closest('.menu-list');
            
            if (menuList) {
                menuList.classList.add('drag-active');
                
                // Remove existing placeholder
                const existingPlaceholder = menuList.querySelector('.drag-placeholder');
                if (existingPlaceholder) {
                    existingPlaceholder.remove();
                }
                
                // Find the drop position
                const afterElement = this.getDragAfterElement(menuList, e.clientY);
                
                // Create placeholder element
                const placeholder = document.createElement('div');
                placeholder.className = 'drag-placeholder';
                placeholder.textContent = 'Drop here';
                
                // Insert placeholder at the correct position
                if (afterElement == null) {
                    menuList.appendChild(placeholder);
                } else {
                    menuList.insertBefore(placeholder, afterElement);
                }
            }
        });

        document.addEventListener('dragleave', e => {
            const menuItem = e.target.closest('.menu-item');
            const menuList = e.target.closest('.menu-list');
            
            if (menuItem && !menuItem.contains(e.relatedTarget)) {
                menuItem.classList.remove('drag-over');
            }
            
            if (menuList && !menuList.contains(e.relatedTarget)) {
                menuList.classList.remove('drag-active');
                // Remove placeholder when leaving the list
                const placeholder = menuList.querySelector('.drag-placeholder');
                if (placeholder) {
                    placeholder.remove();
                }
            }
        });

        document.addEventListener('drop', async (e) => {
            e.preventDefault();
            const draggedId = e.dataTransfer.getData('text/plain');
            const targetList = e.target.closest('.menu-list');

            if (!draggedId || !targetList || ![this.showList, this.hideList].includes(targetList)) {
                this.cleanupDragState();
                return;
            }

            const draggedElement = document.querySelector(`.menu-item.dragging[data-id="${draggedId}"]`);
            if (draggedElement && draggedElement.closest('.menu-list') !== targetList) {
                const afterElement = this.getDragAfterElement(targetList, e.clientY);
                if (afterElement) {
                    targetList.insertBefore(draggedElement, afterElement);
                } else {
                    targetList.appendChild(draggedElement);
                }
            }

            await this.persistMenuStateFromDom(targetList, draggedId);
            this.cleanupDragState();
            this.renderLists();
        });
    }

    cleanupDragState() {
        document.querySelectorAll('.menu-item').forEach(item => {
            item.classList.remove('dragging', 'drag-over');
        });
        document.querySelectorAll('.menu-list').forEach(list => {
            list.classList.remove('drag-active');
            list.querySelectorAll('.drag-placeholder').forEach(placeholder => placeholder.remove());
        });
    }

    async persistMenuStateFromDom(targetList = null, draggedId = null) {
        let visibleIds = this.uniqueIds(Array.from(this.showList.querySelectorAll('.menu-item[data-id]'))
            .map(item => item.dataset.id)
            .filter(Boolean));
        let hiddenIds = this.uniqueIds(Array.from(this.hideList.querySelectorAll('.menu-item[data-id]'))
            .map(item => item.dataset.id)
            .filter(Boolean));

        if (draggedId && targetList === this.hideList) {
            visibleIds = visibleIds.filter(id => id !== draggedId);
        } else if (draggedId && targetList === this.showList) {
            hiddenIds = hiddenIds.filter(id => id !== draggedId);
        }

        // If a corrupted DOM briefly contains the same action in both lists, keep one copy only.
        hiddenIds = hiddenIds.filter(id => !visibleIds.includes(id));
        const domIds = this.uniqueIds([...visibleIds, ...hiddenIds]);

        if (domIds.length === 0) return;

        const itemsById = new Map(this.normalizeMenuItems(this.menuItems).map(item => [item.id, item]));
        const orderedItems = domIds
            .map(id => itemsById.get(id))
            .filter(Boolean);

        this.menuItems.forEach(item => {
            if (!domIds.includes(item.id)) {
                orderedItems.push(item);
            }
        });

        this.menuItems = orderedItems.map((item, index) => ({ ...item, order: index }));
        this.hiddenItems = hiddenIds;

        await this.saveState();
        await this.verifyPersistedMenuState();

        try {
            await chrome.runtime.sendMessage({
                type: 'menuOrderUpdated',
                menuItems: this.menuItems,
                hiddenItems: this.hiddenItems
            });
        } catch (error) {
            console.debug('No active content script to notify about menu order update:', error);
        }
    }

    async verifyPersistedMenuState() {
        const stored = await chrome.storage.sync.get(['menuItems', 'customItems', 'hiddenItems']);
        const storedItems = this.normalizeMenuItems([...(stored.menuItems || []), ...(stored.customItems || [])])
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            .map(item => item.id);
        const currentItems = this.normalizeMenuItems(this.menuItems).map(item => item.id);
        const storedHidden = this.uniqueIds(stored.hiddenItems || []);
        const currentHidden = this.uniqueIds(this.hiddenItems);

        const sameItems = storedItems.length === currentItems.length &&
            storedItems.every((id, index) => id === currentItems[index]);
        const sameHidden = storedHidden.length === currentHidden.length &&
            storedHidden.every((id, index) => id === currentHidden[index]);

        if (!sameItems || !sameHidden) {
            await this.saveState();
        }
    }

    getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.menu-item:not(.dragging)')];
        
        if (draggableElements.length === 0) return null;
        
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    setupIconSearch() {
        const searchInput = document.getElementById('iconSearch');
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            this.filterIcons(searchTerm);
        });
    }

    filterIcons(searchTerm) {
        const filteredIcons = AVAILABLE_ICONS.filter(icon => 
            icon.toLowerCase().includes(searchTerm)
        );
        this.renderIconGrid(filteredIcons);
    }

    renderIconGrid(icons = AVAILABLE_ICONS) {
        const iconPicker = document.getElementById('iconPicker');
        iconPicker.innerHTML = '';
        
        icons.forEach(icon => {
            const iconButton = document.createElement('button');
            iconButton.className = 'icon-option';
            if (this.selectedIcon === icon) {
                iconButton.classList.add('selected');
            }
            
            const iconElement = document.createElement('i');
            iconElement.className = `fas fa-${icon}`;
            
            iconButton.appendChild(iconElement);
            iconButton.addEventListener('click', () => {
                this.selectedIcon = icon;
                this.updateIconPreview();
                iconPicker.querySelectorAll('.icon-option').forEach(btn => {
                    btn.classList.remove('selected');
                });
                iconButton.classList.add('selected');
            });
            
            iconPicker.appendChild(iconButton);
        });
    }

    updateIconPreview() {
        const iconPreview = document.getElementById('selectedIcon');
        iconPreview.innerHTML = `<i class="fas fa-${this.selectedIcon}"></i>`;
    }

    createMenuItem(item) {
        const div = document.createElement('div');
        div.className = 'menu-item';
        div.draggable = true;
        div.dataset.id = item.id;
        
        const iconHtml = getIconHtml(item);
        
        div.innerHTML = `
            ${iconHtml}
            <span class="menu-item-name">${item.name}</span>
            <div class="menu-item-actions">
                ${!DEFAULT_MENU_ITEMS.some(def => def.id === item.id) ? `
                    <button class="edit-btn">Edit</button>
                    <button class="delete-btn">Delete</button>
                ` : ''}
                <div class="ai-menu-pin" title="${this.hiddenItems.includes(item.id) ? 'Show in menu' : 'Hide from menu'}">
                    <i class="fas ${this.hiddenItems.includes(item.id) ? 'fa-eye-slash' : 'fa-eye'}"></i>
                </div>
            </div>
        `;
        
        return div;
    }

    openModal(item = null) {
        const nameInput = document.getElementById('promptName');
        const contentInput = document.getElementById('promptContent');
        const sceneWriting = document.getElementById('sceneWriting');
        const sceneReading = document.getElementById('sceneReading');
        const sceneAll = document.getElementById('sceneAll');
        
        if (item) {
            nameInput.value = item.name;
            contentInput.value = item.content || '';
            this.selectedIcon = item.icon || 'lightbulb';
            this.modal.dataset.editId = item.id;
            // Restore scene checkboxes
            const scene = item.scene || 'all';
            sceneWriting.checked = scene === 'writing' || scene === 'all';
            sceneReading.checked = scene === 'reading' || scene === 'all';
            sceneAll.checked = scene === 'all';
        } else {
            nameInput.value = '';
            contentInput.value = '';
            this.selectedIcon = 'lightbulb';
            delete this.modal.dataset.editId;
            // Default: all scenes
            sceneWriting.checked = true;
            sceneReading.checked = true;
            sceneAll.checked = true;
        }
        
        this.updateIconPreview();
        this.modal.classList.add('show');
    }

    closeModal() {
        this.modal.classList.remove('show');
    }

    openIconPicker() {
        const iconPicker = document.getElementById('iconPicker');
        iconPicker.innerHTML = '';
        
        AVAILABLE_ICONS.forEach(icon => {
            const iconButton = document.createElement('button');
            iconButton.className = 'icon-option';
            if (this.selectedIcon === icon) {
                iconButton.classList.add('selected');
            }
            
            const iconElement = document.createElement('i');
            iconElement.className = `fas fa-${icon}`;
            
            iconButton.appendChild(iconElement);
            iconButton.addEventListener('click', () => {
                this.selectedIcon = icon;
                this.updateIconPreview();
                iconPicker.querySelectorAll('.icon-option').forEach(btn => {
                    btn.classList.remove('selected');
                });
                iconButton.classList.add('selected');
            });
            
            iconPicker.appendChild(iconButton);
        });
        
        document.getElementById('iconPickerModal').classList.add('show');
    }

    closeIconPicker() {
        document.getElementById('iconPickerModal').classList.remove('show');
    }

    handleIconPickerDone() {
        this.closeIconPicker();
    }

    async saveItem() {
        const name = document.getElementById('promptName').value.trim();
        const content = document.getElementById('promptContent').value.trim();
        
        if (!name) {
            alert('Please enter a name for the item');
            return;
        }

        // Determine scene from checkboxes
        const sceneAll = document.getElementById('sceneAll').checked;
        const sceneWriting = document.getElementById('sceneWriting').checked;
        const sceneReading = document.getElementById('sceneReading').checked;
        let scene = 'all';
        if (sceneAll || (sceneWriting && sceneReading)) {
            scene = 'all';
        } else if (sceneWriting) {
            scene = 'writing';
        } else if (sceneReading) {
            scene = 'reading';
        }

        const id = this.modal.dataset.editId || `custom_${Date.now()}`;
        
        if (this.modal.dataset.editId) {
            // Edit existing item
            const index = this.menuItems.findIndex(item => item.id === id);
            if (index !== -1) {
                this.menuItems[index] = { 
                    ...this.menuItems[index], 
                    name, 
                    content,  
                    icon: this.selectedIcon,
                    isCustom: true,
                    scene
                };
            }
        } else {
            // Add new item
            this.menuItems.push({ 
                id, 
                name, 
                content,  
                icon: this.selectedIcon,
                isCustom: true,
                scene
            });
        }

        await this.saveState();
        this.renderLists();
        this.closeModal();
    }

    async deleteItem(itemId) {
        if (!confirm('Are you sure you want to delete this item?')) return;

        this.menuItems = this.menuItems.filter(item => item.id !== itemId);
        this.hiddenItems = this.hiddenItems.filter(id => id !== itemId);
        
        await this.saveState();
        this.renderLists();
    }

    async toggleItemVisibility(itemId) {
        if (this.hiddenItems.includes(itemId)) {
            this.hiddenItems = this.hiddenItems.filter(id => id !== itemId);
        } else {
            this.hiddenItems.push(itemId);
        }
        
        await this.saveState();
        this.renderLists();
    }

    setupUsageAndLicense() {
        this.loadUsageData();
        this.setupLicenseActivation();
        this.setupBuyLicenseLink();
        
        // Refresh usage data every 60 seconds
        setInterval(() => this.loadUsageData(), 60000);
    }

    async loadUsageData() {
        try {
            const usageData = await this.getUsageDataForAll();
            this.updateUsageDisplay(usageData);
        } catch (error) {
            console.error('Failed to load usage data:', error);
        }
    }

    async getUsageDataForAll() {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: 'getUsageDataForAll' }, (response) => {
                if (chrome.runtime.lastError || response == null || typeof response !== 'object') {
                    if (chrome.runtime.lastError) {
                        console.warn('getUsageDataForAll:', chrome.runtime.lastError.message);
                    }
                    resolve(getDefaultUsageDataForAll());
                    return;
                }
                resolve(response);
            });
        });
    }

    updateUsageDisplay(usageData) {
        const base = getDefaultUsageDataForAll();
        if (!usageData || typeof usageData !== 'object') {
            usageData = base;
        } else {
            usageData = {
                ...base,
                ...usageData,
                textMenu: { ...base.textMenu, ...(usageData.textMenu || {}) },
                google: { ...base.google, ...(usageData.google || {}) },
                writingAssistant: { ...base.writingAssistant, ...(usageData.writingAssistant || {}) },
                screenshot: { ...base.screenshot, ...(usageData.screenshot || {}) }
            };
        }

        const usageStatus = document.getElementById('usageStatus');
        const resetTime = document.getElementById('resetTime');
        const usageRemaining = document.getElementById('usageRemaining');
        const licenseStatus = document.getElementById('licenseStatus');
        const licenseTitle = document.getElementById('licenseTitle');
        const licenseDescription = document.getElementById('licenseDescription');
        const licenseIcon = document.getElementById('licenseIcon');
        const licenseInputSection = document.getElementById('licenseInputSection');
        const licenseFeatures = document.getElementById('licenseFeatures');

        const { count, limit } = usageData.textMenu;
        const remaining = Math.max(0, limit - count);
        const progress = document.getElementById('sharedUsageProgress');
        const bar = document.getElementById('sharedUsageBar');
        const fill = document.getElementById('progressFillTextMenu');
        const stats = document.getElementById('usageDailyStats');
        if (progress) progress.hidden = !!usageData.isLicensed;
        if (bar) {
            bar.setAttribute('aria-valuemax', limit);
            bar.setAttribute('aria-valuenow', Math.min(count, limit));
        }
        if (fill) fill.style.width = `${limit > 0 ? Math.min(100, Math.max(0, count / limit * 100)) : 0}%`;
        if (stats) stats.textContent = `${count} / ${limit} uses today`;
        if (usageRemaining) usageRemaining.textContent = usageData.isLicensed
            ? 'Unlimited usage'
            : `${remaining} ${remaining === 1 ? 'use' : 'uses'} remaining today`;

        if (usageData.isLicensed) {
            const planLabels = { monthly: 'Monthly', yearly: 'Yearly', lifetime: 'Lifetime' };
            const planType = usageData.planType || 'lifetime';
            const planLabel = planLabels[planType] || 'Premium';

            if (usageStatus) usageStatus.textContent = `${planLabel} User`;
            if (resetTime) resetTime.textContent = 'Never';
            licenseStatus.classList.add('licensed');
            licenseTitle.textContent = `${planLabel} License Active`;
            if (usageData.expiresAt) {
                const expDate = new Date(usageData.expiresAt);
                licenseDescription.textContent = `Expires: ${expDate.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}`;
            } else {
                licenseDescription.textContent = 'Lifetime — never expires';
            }
            licenseIcon.className = 'fas fa-check-circle';
            licenseInputSection.style.display = 'none';
            licenseFeatures.style.display = 'block';

            const planInfo = document.getElementById('licensePlanInfo');
            if (planInfo) {
                const badgeClass = (usageData.expiresAt && new Date(usageData.expiresAt) < new Date()) ? 'plan-type-badge expired' : 'plan-type-badge';
                let infoHtml = `<span class="${badgeClass}">${planLabel}</span>`;
                if (usageData.expiresAt) {
                    const expDate = new Date(usageData.expiresAt);
                    infoHtml += ` <span>Valid until ${expDate.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</span>`;
                } else {
                    infoHtml += ' <span>Lifetime access — no expiration</span>';
                }
                planInfo.innerHTML = infoHtml;
            }
        } else {
            if (usageStatus) usageStatus.textContent = 'Free User';
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(0, 0, 0, 0);
            if (resetTime) resetTime.textContent = tomorrow.toLocaleTimeString();
            licenseStatus.classList.remove('licensed');
            licenseTitle.textContent = 'Free Version';
            licenseDescription.textContent = `Limited to ${limit} uses per day`;
            licenseIcon.className = 'fas fa-key';
            licenseInputSection.style.display = 'block';
            licenseFeatures.style.display = 'none';
        }
    }

    setupLicenseActivation() {
        const activateBtn = document.getElementById('activateLicense');
        const licenseInput = document.getElementById('licenseCode');
        const licenseInUseModal = document.getElementById('licenseInUseModal');
        const takeoverBtn = document.getElementById('licenseInUseTakeoverBtn');
        const buyBtn = document.getElementById('licenseInUseBuyBtn');

        const showLicenseInUseModal = (licenseCode) => {
            return new Promise((resolve) => {
                const onTakeover = async () => {
                    licenseInUseModal.classList.remove('show');
                    takeoverBtn.removeEventListener('click', onTakeover);
                    buyBtn.removeEventListener('click', onBuy);
                    resolve('takeover');
                };
                const onBuy = () => {
                    licenseInUseModal.classList.remove('show');
                    takeoverBtn.removeEventListener('click', onTakeover);
                    buyBtn.removeEventListener('click', onBuy);
                    window.open(buildSideAITrackedUrl('https://sideai.app/pricing?utm_source=ext_options_license_in_use_pricing&utm_medium=chrome_extension&utm_campaign=sideai_extension', 'ext_options_license_in_use_pricing'), '_blank');
                    resolve('buy');
                };
                takeoverBtn.addEventListener('click', onTakeover);
                buyBtn.addEventListener('click', onBuy);
                licenseInUseModal.classList.add('show');
            });
        };

        activateBtn.addEventListener('click', async () => {
            const licenseCode = licenseInput.value.trim();
            
            if (!licenseCode) {
                alert('Please enter a license code');
                return;
            }
            
            activateBtn.disabled = true;
            activateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Activating...';
            
            try {
                let result = await this.validateLicense(licenseCode, false);
                
                if (result.valid) {
                    alert(result.previous_session_revoked
                        ? 'License activated successfully! The previous session has been deactivated.'
                        : 'License activated successfully!');
                    licenseInput.value = '';
                    this.loadUsageData();
                } else if (result.in_use) {
                    activateBtn.disabled = false;
                    activateBtn.innerHTML = '<i class="fas fa-check"></i> Activate';
                    const choice = await showLicenseInUseModal(licenseCode);
                    if (choice === 'takeover') {
                        activateBtn.disabled = true;
                        activateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Activating...';
                        result = await this.validateLicense(licenseCode, true);
                        if (result.valid) {
                            alert('License activated successfully! The previous session has been deactivated.');
                            licenseInput.value = '';
                            this.loadUsageData();
                        } else {
                            alert(result.message || 'Activation failed. Please try again.');
                        }
                    }
                } else {
                    alert(result.message);
                }
            } catch (error) {
                alert('Error activating license. Please try again.');
                console.error('License activation error:', error);
            } finally {
                activateBtn.disabled = false;
                activateBtn.innerHTML = '<i class="fas fa-check"></i> Activate';
            }
        });
        
        // Allow Enter key to activate
        licenseInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                activateBtn.click();
            }
        });
    }

    async validateLicense(licenseCode, forceTakeover = false) {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ 
                type: 'validateLicense', 
                licenseCode: licenseCode,
                forceTakeover: forceTakeover
            }, (response) => {
                resolve(response || { valid: false, message: 'No response' });
            });
        });
    }

    setupBuyLicenseLink() {
        const planBtns = document.querySelectorAll('.plan-buy-btn[data-plan]');
        const installBtn = document.getElementById('planInstallBtn');
        const billingButtons = document.querySelectorAll('.website-pricing-toggle-btn[data-billing]');
        const savingsBanner = document.getElementById('websitePricingSavingsBanner');
        const proCta = document.getElementById('websiteProCta');
        const proPrice = document.getElementById('websiteProPrice');
        const proCadence = document.getElementById('websiteProCadence');
        const proDescription = document.getElementById('websiteProDescription');
        const proRibbon = document.getElementById('websiteProRibbon');
        const urls = {
            monthly: (typeof POLAR_CONFIG !== 'undefined' && POLAR_CONFIG.CHECKOUT_MONTHLY) || '',
            yearly: (typeof POLAR_CONFIG !== 'undefined' && POLAR_CONFIG.CHECKOUT_YEARLY) || '',
            lifetime: (typeof POLAR_CONFIG !== 'undefined' && POLAR_CONFIG.CHECKOUT_LIFETIME) || '',
        };
        const fallback = (typeof POLAR_CONFIG !== 'undefined' && POLAR_CONFIG.CHECKOUT_URL) || 'https://sideai.app/checkout/lifetime?utm_source=ext_options_upgrade_fallback&utm_medium=chrome_extension&utm_campaign=sideai_extension';
        const installUrl = 'https://chromewebstore.google.com/detail/sidebar-for-chatgpt-free/hcjmcpfahioghphbgfokmijhkccofkci';
        const yearlySavings = 40;
        const freeMonths = 8;
        const yearlySavingsPercent = 67;
        let billingCycle = 'yearly';

        const syncProPlan = () => {
            const isYearly = billingCycle === 'yearly';
            billingButtons.forEach(btn => {
                const active = btn.getAttribute('data-billing') === billingCycle;
                btn.classList.toggle('active', active);
                btn.setAttribute('aria-pressed', active ? 'true' : 'false');
            });

            if (savingsBanner) {
                savingsBanner.textContent = isYearly
                    ? `Get ${freeMonths} months free with annual billing - save $${yearlySavings}/year 🤩`
                    : `Switch to annual and save $${yearlySavings}/year`;
            }

            if (proPrice) proPrice.textContent = isYearly ? '$1.67' : '$5';
            if (proCadence) proCadence.textContent = '/ month';
            if (proDescription) {
                proDescription.textContent = isYearly
                    ? '$20 billed annually. Best value for regular SideAI users.'
                    : 'Billed monthly. Cancel whenever you want.';
            }
            if (proCta) {
                proCta.textContent = isYearly ? 'Get Annual' : 'Get Monthly';
                proCta.setAttribute('data-plan', isYearly ? 'yearly' : 'monthly');
            }
            if (proRibbon) {
                proRibbon.textContent = `-${yearlySavingsPercent}%`;
                proRibbon.style.display = isYearly ? 'flex' : 'none';
            }
        };

        billingButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                billingCycle = btn.getAttribute('data-billing') === 'monthly' ? 'monthly' : 'yearly';
                syncProPlan();
            });
        });

        if (installBtn) {
            installBtn.addEventListener('click', (e) => {
                e.preventDefault();
                window.open(installUrl, '_blank');
            });
        }

        planBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const plan = btn.getAttribute('data-plan');
                const url = urls[plan] || fallback;
                window.open(buildSideAITrackedUrl(url, `ext_options_upgrade_${plan || 'fallback'}`), '_blank');
            });
        });

        syncProPlan();
    }

    async setupBlockedSites() {
        // Get initial state
        const { blockedSites = [], globalDisabled = false, blockedTextMenuSites = [], globalTextMenuDisabled = false, writingAssistantDisabledSites = [], writingAssistantDisabledAll = false, googleChatgptEnabled = true } = await chrome.storage.sync.get(['blockedSites', 'globalDisabled', 'blockedTextMenuSites', 'globalTextMenuDisabled', 'writingAssistantDisabledSites', 'writingAssistantDisabledAll', 'googleChatgptEnabled']);
        this.blockedSites = blockedSites;
        this.globalDisabled = globalDisabled;
        this.blockedTextMenuSites = blockedTextMenuSites;
        this.globalTextMenuDisabled = globalTextMenuDisabled;
        this.writingAssistantDisabledSites = writingAssistantDisabledSites;
        this.writingAssistantDisabledAll = writingAssistantDisabledAll;
        this.googleChatgptEnabled = googleChatgptEnabled;

        // Setup event listeners
        const unblockAllBtn = document.getElementById('unblockAllBtn');
        unblockAllBtn.addEventListener('click', () => this.unblockAllSites());

        const unblockAllTextMenuBtn = document.getElementById('unblockAllTextMenuBtn');
        unblockAllTextMenuBtn.addEventListener('click', () => this.unblockAllTextMenuSites());

        const unblockAllWritingAssistantBtn = document.getElementById('unblockAllWritingAssistantBtn');
        if (unblockAllWritingAssistantBtn) unblockAllWritingAssistantBtn.addEventListener('click', () => this.unblockAllWritingAssistantSites());

        const googleChatgptCheckbox = document.getElementById('googleChatgptEnabled');
        if (googleChatgptCheckbox) {
            googleChatgptCheckbox.checked = this.googleChatgptEnabled;
            googleChatgptCheckbox.addEventListener('change', (e) => this.setGoogleChatgptEnabled(e.target.checked));
        }

        // Initial render
        this.renderBlockedSites();
    }

    async setGoogleChatgptEnabled(enabled) {
        this.googleChatgptEnabled = enabled;
        await chrome.storage.sync.set({ googleChatgptEnabled: enabled });
        const statusEl = document.getElementById('googleChatgptStatus');
        if (statusEl) statusEl.textContent = enabled ? 'Enabled' : 'Disabled';
    }

    async renderBlockedSites() {
        // const globalStatus = document.getElementById('globalStatus');
        const unblockAllBtn = document.getElementById('unblockAllBtn');
        const unblockAllTextMenuBtn = document.getElementById('unblockAllTextMenuBtn');

        // // Update global status
        // globalStatus.textContent = this.globalDisabled ? 'Extension is globally disabled' : 'Extension is enabled';

        // Render page assistant section
        this.renderPageAssistantSites();
        
        // Render text menu section
        this.renderTextMenuSites();

        // Render Writing Assistant section
        this.renderWritingAssistantSites();

        // Update Google Search ChatGPT status
        const googleChatgptStatus = document.getElementById('googleChatgptStatus');
        if (googleChatgptStatus) googleChatgptStatus.textContent = this.googleChatgptEnabled ? 'Enabled' : 'Disabled';

        // Show unblock all button if any blocking is active
        const hasAnyBlocking = this.globalDisabled || this.blockedSites.length > 0;
        const hasAnyTextMenuBlocking = this.globalTextMenuDisabled || this.blockedTextMenuSites.length > 0;
        const hasAnyWritingAssistantBlocking = this.writingAssistantDisabledAll || (this.writingAssistantDisabledSites && this.writingAssistantDisabledSites.length > 0);
        unblockAllBtn.style.display = hasAnyBlocking ? 'block' : 'none';
        unblockAllTextMenuBtn.style.display = hasAnyTextMenuBlocking ? 'block' : 'none';
        const unblockAllWritingAssistantBtn = document.getElementById('unblockAllWritingAssistantBtn');
        if (unblockAllWritingAssistantBtn) unblockAllWritingAssistantBtn.style.display = hasAnyWritingAssistantBlocking ? 'block' : 'none';
    }

    async renderPageAssistantSites() {
        const pageAssistantSitesList = document.getElementById('pageAssistantSitesList');
        const pageAssistantStatus = document.getElementById('pageAssistantStatus');

        // Update page assistant status
        pageAssistantStatus.textContent = this.globalDisabled ? 'Page Assistant is globally disabled' : 'Page Assistant is enabled';
        pageAssistantStatus.classList.toggle('is-disabled', this.globalDisabled);
        // Clear and rebuild list
        pageAssistantSitesList.innerHTML = '';

        if (this.blockedSites.length === 0 && !this.globalDisabled) {
            pageAssistantSitesList.innerHTML = '<div class="no-blocked-sites">No sites are currently blocked</div>';
            return;
        }

        // Add global disabled entry if applicable
        if (this.globalDisabled) {
            const globalItem = document.createElement('div');
            globalItem.className = 'blocked-site-item';
            globalItem.innerHTML = `
                <span class="blocked-site-url">Page Assistant disabled globally</span>
                <button class="unblock-site-btn" data-type="global">Enable Extension</button>
            `;
            pageAssistantSitesList.appendChild(globalItem);
        }

        // Add individual blocked sites
        this.blockedSites.forEach(site => {
            const item = document.createElement('div');
            item.className = 'blocked-site-item';
            item.innerHTML = `
                <span class="blocked-site-url">${site}</span>
                <button class="unblock-site-btn" data-site="${site}" data-component="page-assistant">Unblock</button>
            `;
            pageAssistantSitesList.appendChild(item);
        });

        // Setup unblock buttons
        pageAssistantSitesList.querySelectorAll('.unblock-site-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const type = e.target.dataset.type;
                const site = e.target.dataset.site;
                
                if (type === 'global') {
                    await this.enableExtension();
                } else if (site) {
                    await this.unblockSite(site);
                }
            });
        });
    }

    async renderTextMenuSites() {
        const textMenuSitesList = document.getElementById('textMenuSitesList');
        const textMenuStatus = document.getElementById('textMenuStatus');

        // Update text menu status
        textMenuStatus.textContent = this.globalTextMenuDisabled ? 'Text Menu is globally disabled' : 'Text Menu is enabled';
        textMenuStatus.classList.toggle('is-disabled', this.globalTextMenuDisabled);
        // Clear and rebuild list
        textMenuSitesList.innerHTML = '';

        if (this.blockedTextMenuSites.length === 0 && !this.globalTextMenuDisabled) {
            textMenuSitesList.innerHTML = '<div class="no-blocked-sites">No sites are currently blocked</div>';
            return;
        }

        // Add global disabled entry if applicable
        if (this.globalTextMenuDisabled) {
            const globalItem = document.createElement('div');
            globalItem.className = 'blocked-site-item';
            globalItem.innerHTML = `
                <span class="blocked-site-url">Text Menu disabled globally</span>
                <button class="unblock-site-btn" data-type="global-text-menu">Enable Text Menu</button>
            `;
            textMenuSitesList.appendChild(globalItem);
        }

        // Add individual blocked sites
        this.blockedTextMenuSites.forEach(site => {
            const item = document.createElement('div');
            item.className = 'blocked-site-item';
            item.innerHTML = `
                <span class="blocked-site-url">${site}</span>
                <button class="unblock-site-btn" data-site="${site}" data-component="text-menu">Unblock</button>
            `;
            textMenuSitesList.appendChild(item);
        });

        // Setup unblock buttons
        textMenuSitesList.querySelectorAll('.unblock-site-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const type = e.target.dataset.type;
                const site = e.target.dataset.site;
                
                if (type === 'global-text-menu') {
                    await this.enableTextMenu();
                } else if (site) {
                    await this.unblockTextMenuSite(site);
                }
            });
        });
    }

    async renderWritingAssistantSites() {
        const listEl = document.getElementById('writingAssistantSitesList');
        const statusEl = document.getElementById('writingAssistantStatus');
        if (!listEl || !statusEl) return;

        const disabledSites = this.writingAssistantDisabledSites || [];
        const disabledAll = !!this.writingAssistantDisabledAll;

        statusEl.textContent = disabledAll ? 'Writing Assistant is globally disabled' : 'Writing Assistant is enabled';
        statusEl.classList.toggle('is-disabled', disabledAll);
        listEl.innerHTML = '';

        if (disabledSites.length === 0 && !disabledAll) {
            listEl.innerHTML = '<div class="no-blocked-sites">No sites are currently blocked</div>';
            return;
        }

        if (disabledAll) {
            const globalItem = document.createElement('div');
            globalItem.className = 'blocked-site-item';
            globalItem.innerHTML = `
                <span class="blocked-site-url">Writing Assistant disabled globally</span>
                <button class="unblock-site-btn" data-type="global-writing-assistant">Enable Writing Assistant</button>
            `;
            listEl.appendChild(globalItem);
        }

        disabledSites.forEach(site => {
            const item = document.createElement('div');
            item.className = 'blocked-site-item';
            item.innerHTML = `
                <span class="blocked-site-url">${site}</span>
                <button class="unblock-site-btn" data-site="${site}" data-component="writing-assistant">Unblock</button>
            `;
            listEl.appendChild(item);
        });

        listEl.querySelectorAll('.unblock-site-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const type = e.target.dataset.type;
                const site = e.target.dataset.site;
                if (type === 'global-writing-assistant') {
                    await this.enableWritingAssistant();
                } else if (site) {
                    await this.unblockWritingAssistantSite(site);
                }
            });
        });
    }

    async unblockWritingAssistantSite(site) {
        this.writingAssistantDisabledSites = (this.writingAssistantDisabledSites || []).filter(s => s !== site);
        await chrome.storage.sync.set({ writingAssistantDisabledSites: this.writingAssistantDisabledSites });
        this.renderBlockedSites();
    }

    async enableWritingAssistant() {
        this.writingAssistantDisabledAll = false;
        await chrome.storage.sync.set({ writingAssistantDisabledAll: false });
        this.renderBlockedSites();
    }

    async unblockAllWritingAssistantSites() {
        if (!confirm('Are you sure you want to enable Writing Assistant on all sites?')) return;
        this.writingAssistantDisabledSites = [];
        this.writingAssistantDisabledAll = false;
        await chrome.storage.sync.set({ writingAssistantDisabledSites: [], writingAssistantDisabledAll: false });
        this.renderBlockedSites();
    }

    async unblockSite(site) {
        this.blockedSites = this.blockedSites.filter(s => s !== site);
        await chrome.storage.sync.set({ blockedSites: this.blockedSites });
        await chrome.runtime.sendMessage({ type: 'enable-site', site });
        this.renderBlockedSites();
    }

        async unblockAllSites() {
            if (!confirm('Are you sure you want to unblock all sites and enable the extension?')) {
                return;
            }

            this.blockedSites = [];
            this.globalDisabled = false;
            await chrome.storage.sync.set({ 
                blockedSites: [], 
                globalDisabled: false 
            });
            await chrome.runtime.sendMessage({ type: 'enable-all' });
            this.renderBlockedSites();
        }


    async enableExtension() {
        this.globalDisabled = false;
        await chrome.storage.sync.set({ globalDisabled: false });
        await chrome.runtime.sendMessage({ type: 'enable-all' });
        this.renderBlockedSites();
    }

    async unblockTextMenuSite(site) {
        this.blockedTextMenuSites = this.blockedTextMenuSites.filter(s => s !== site);
        await chrome.storage.sync.set({ blockedTextMenuSites: this.blockedTextMenuSites });
        await chrome.runtime.sendMessage({ type: 'enable-text-menu-site', site });
        this.renderBlockedSites();
    }

    async enableTextMenu() {
        this.globalTextMenuDisabled = false;
        await chrome.storage.sync.set({ globalTextMenuDisabled: false });
        await chrome.runtime.sendMessage({ type: 'enable-text-menu-all' });
        this.renderBlockedSites();
    }

    // Update item order after drag and drop
    async updateItemOrder(draggedId, newPosition, targetListId) {
        try {
            // Get the dragged item
            const draggedItem = this.menuItems.find(item => item.id === draggedId);
            if (!draggedItem) return;
            
            // Create a copy of the menu items array
            const itemsCopy = [...this.menuItems];
            
            // Remove the dragged item from its current position
            const filteredItems = itemsCopy.filter(item => item.id !== draggedId);
            
            // Insert the item at the new position
            const insertIndex = Math.max(0, Math.min(newPosition, filteredItems.length));
            filteredItems.splice(insertIndex, 0, draggedItem);
            
            // Update the menu items with the new order
            this.menuItems = filteredItems;
            
            // Update order property for all items
            this.menuItems.forEach((item, index) => {
                item.order = index;
            });
            
            // Save the new order
            await this.saveState();
            
            // Notify content scripts about the new order
            await chrome.runtime.sendMessage({ 
                type: 'menuOrderUpdated', 
                menuItems: this.menuItems 
            });
            
            console.log('Updated menu order:', this.menuItems.map(item => ({ id: item.id, order: item.order })));
            
        } catch (error) {
            console.error('Error updating item order:', error);
        }
    }

    async unblockAllTextMenuSites() {
        if (!confirm('Are you sure you want to unblock all sites and enable the text menu?')) {
            return;
        }

        this.blockedTextMenuSites = [];
        this.globalTextMenuDisabled = false;
        await chrome.storage.sync.set({ blockedTextMenuSites: [], globalTextMenuDisabled: false });
        await chrome.runtime.sendMessage({ type: 'enable-text-menu-all' });
        this.renderBlockedSites();
    }
}

// Initialize options manager when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new OptionsManager();
});
