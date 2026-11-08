// Default whitelist of allowed websites
let whitelist = ['linkedin.com', 'indeed.com', 'ycombinator.com', 'builtin.com', 'greenhouse.io', 'lever.co', 'ashbyhq.com'];

let teachModeActive = false;
let currentHoverEl = null;

chrome.storage.local.get(['whitelist'], (result) => {
  if (result.whitelist) {
    whitelist = result.whitelist;
  }
  init();
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.whitelist) {
    whitelist = changes.whitelist.newValue;
    init();
  }
});

function isWhitelisted() {
  const hostname = window.location.hostname;
  return whitelist.some(domain => hostname.includes(domain));
}

function init() {
  if (!isWhitelisted()) return;
  if (document.getElementById('apptracker-styles-injected')) return;
  
  // Mark as initialized
  const marker = document.createElement('div');
  marker.id = 'apptracker-styles-injected';
  marker.style.display = 'none';
  document.body.appendChild(marker);

  // Observer to find job cards dynamically as they load
  const observer = new MutationObserver(() => {
    if (!teachModeActive) identifyJobCards();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  identifyJobCards();
}

function extractTextLines(el) {
    const clone = el.cloneNode(true);
    const blocks = clone.querySelectorAll('div, p, li, br, h1, h2, h3, h4, h5, h6');
    blocks.forEach(b => { b.insertAdjacentText('afterend', '\\n'); });
    return clone.innerText.split('\\n').map(l => l.trim()).filter(l => l.length > 0 && l !== 'Save' && l !== 'Fetching...');
}

function extractLocation(rootEl, company) {
    let location = '';
    
    // Strategy 1: Primary description container (split by bullet)
    const primaryDesc = rootEl.querySelector('.job-details-jobs-unified-top-card__primary-description-container, .top-card-layout__first-subline');
    if (primaryDesc) {
        const parts = (primaryDesc.innerText || primaryDesc.textContent).split('·').map(p => p.trim());
        if (parts.length > 1) {
            const potentialLoc = parts[1];
            if (potentialLoc.length < 60 && !potentialLoc.toLowerCase().includes('applicant') && !potentialLoc.toLowerCase().includes('alum') && !potentialLoc.toLowerCase().includes('connection') && !potentialLoc.toLowerCase().includes('posted')) {
                location = potentialLoc;
            }
        }
    }
    
    // Strategy 2: Specific LinkedIn bullet/flavor elements
    if (!location) {
        const locEls = Array.from(rootEl.querySelectorAll('.topcard__flavor--bullet, .job-details-jobs-unified-top-card__bullet, span.tvm__text, .topcard__flavor'));
        for (const el of locEls) {
            const text = (el.innerText || el.textContent || '').trim();
            if (text && text.length > 2 && text.length < 50 && !text.toLowerCase().includes('alum') && !text.toLowerCase().includes('connection') && !text.toLowerCase().includes('posted') && !text.toLowerCase().includes('applicant') && !text.toLowerCase().includes('days ago') && !text.toLowerCase().includes('hours ago') && text !== company) {
                location = text;
                break;
            }
        }
    }
    
    return location;
}

async function scrapeSplitPane(card, link, fallbackData) {
    link.click();
    await new Promise(r => setTimeout(r, 1500));
    
    const elements = Array.from(document.querySelectorAll('div, article, section, main'));
    let bestPane = null;
    let maxScore = 0;
    
    for (const el of elements) {
        if (!el.getBoundingClientRect) continue;
        const rect = el.getBoundingClientRect();
        
        // Must have physical dimensions
        if (rect.width < 300 || rect.height < 400) continue;
        
        // Must not be the body/html
        if (el === document.body || el === document.documentElement) continue;
        
        // MUST NOT CONTAIN THE CARD!
        // This is the magic bullet. If an element contains the card, it is either the left pane, 
        // or a wrapper for both panes. By excluding it, we are guaranteed to only look at 
        // elements outside the left pane (i.e. the right pane!).
        if (el.contains(card)) continue;
        
        // Must be visible
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
        
        const textLen = (el.innerText || '').length;
        if (textLen > maxScore && textLen < 35000) {
            maxScore = textLen;
            bestPane = el;
        }
    }
    
    if (!bestPane) return fallbackData;
    
    let title = '';
    const excludeTitleWords = ['notifications', 'use ai', 'premium', 'messages', 'jobs', 'search', 'home', 'save', 'apply', 'skip', 'people you', 'reach out', 'about the', 'similar', 'skills', 'about this', 'who to', 'meet the'];
    const specificTitle = bestPane.querySelector('.job-details-jobs-unified-top-card__job-title, .top-card-layout__title');
    if (specificTitle) {
        title = specificTitle.innerText || specificTitle.textContent;
    }
    
    if (!title) {
        const h1s = Array.from(bestPane.querySelectorAll('h1')).filter(h => {
             const text = (h.innerText || h.textContent || '').trim().toLowerCase();
             return text.length > 0 && !excludeTitleWords.some(w => text.includes(w)) && !text.includes('linkedin');
        });
        if (h1s.length > 0) title = h1s[0].innerText || h1s[0].textContent;
    }
    
    if (!title) {
        const headings = Array.from(bestPane.querySelectorAll('h2, strong')).filter(h => {
             const text = (h.innerText || h.textContent || '').trim().toLowerCase();
             return text.length > 5 && text.length < 80 && !excludeTitleWords.some(w => text.includes(w));
        });
        if (headings.length > 0) title = headings[0].innerText || headings[0].textContent;
    }
    
    if (!title) {
        title = fallbackData.title.replace(/^\(\d+\)\s*/, '').replace(' | LinkedIn', '').replace(/^\d+\s+notifications?/i, '').trim();
    }
    
    let company = fallbackData.company;
    const companyLink = bestPane.querySelector('a[href*="/company/"], .job-details-jobs-unified-top-card__company-name, .topcard__org-name-link, .app-aware-link');
    if (companyLink && (companyLink.innerText || companyLink.textContent).trim().length > 0) {
        company = companyLink.innerText || companyLink.textContent;
    } else {
        const links = Array.from(bestPane.querySelectorAll('a'));
        for (const a of links) {
            const text = (a.innerText || a.textContent || '').trim();
            if (text && text.length > 1 && text.length < 50 && !text.includes('Apply') && !text.includes('Save') && !text.includes('LinkedIn') && text !== title && !text.includes('Home') && !text.includes('Skip')) {
                company = text;
                break;
            }
        }
    }
    
    let description = '';
    const allEls = Array.from(bestPane.querySelectorAll('h1, h2, h3, h4, h5, h6, strong, span, div'));
    for (const el of allEls) {
        const text = (el.innerText || el.textContent || '').trim().toLowerCase();
        if (text.length < 100 && (text.includes('about the job') || text.includes('about this role') || text.includes('job description'))) {
            let parent = el.parentElement;
            while (parent && (parent.innerText || parent.textContent || '').length < 500) {
                parent = parent.parentElement;
                if (parent === bestPane) break; 
            }
            if (parent) {
                description = parent.innerText || parent.textContent;
                break;
            }
        }
    }
    
    if (!description || description.length < 100) {
        description = bestPane.innerText || bestPane.textContent;
    }
    let location = extractLocation(bestPane, company) || fallbackData.location;
    
    return {
        title: title.trim(),
        company: company.trim(),
        location: location,
        url: fallbackData.url,
        description: description.replace(/Show more|Show less/gi, '').trim(),
        source_website: new URL(fallbackData.url).hostname.replace('www.', '')
    };
}

function scrapeStandalonePage(fallbackData) {
    const doc = document;
    let title = '';
    const excludeTitleWords = ['notifications', 'use ai', 'premium', 'messages', 'jobs', 'search', 'home', 'save', 'apply', 'skip', 'people you', 'reach out', 'about the', 'similar', 'skills', 'about this', 'who to', 'meet the'];
    const specificTitle = doc.querySelector('.job-details-jobs-unified-top-card__job-title, .top-card-layout__title');
    if (specificTitle) {
        title = specificTitle.innerText || specificTitle.textContent;
    }
    
    if (!title) {
        const h1s = Array.from(doc.querySelectorAll('h1')).filter(h => {
             const text = (h.innerText || h.textContent || '').trim().toLowerCase();
             return text.length > 0 && !excludeTitleWords.some(w => text.includes(w)) && !text.includes('linkedin');
        });
        if (h1s.length > 0) title = h1s[0].innerText || h1s[0].textContent;
    }
    
    if (!title && fallbackData.title) {
        const docTitle = fallbackData.title.replace(/^\(\d+\)\s*/, '').replace(' | LinkedIn', '').replace(/^\d+\s+notifications?/i, '').trim();
        if (docTitle.length > 0) {
             title = docTitle.split(' - ')[0].split(' at ')[0].trim();
        }
    }
    
    if (!title) {
        const headings = Array.from(doc.querySelectorAll('h2, strong')).filter(h => {
             const text = (h.innerText || h.textContent || '').trim().toLowerCase();
             return text.length > 5 && text.length < 80 && !excludeTitleWords.some(w => text.includes(w));
        });
        if (headings.length > 0) title = headings[0].innerText || headings[0].textContent;
    }
    
    let company = fallbackData.company;
    const companyLink = doc.querySelector('a[href*="/company/"], .job-details-jobs-unified-top-card__company-name, .topcard__org-name-link, .app-aware-link');
    if (companyLink && (companyLink.innerText || companyLink.textContent).trim().length > 0) {
        company = companyLink.innerText || companyLink.textContent;
    } else {
        const links = Array.from(doc.querySelectorAll('a'));
        for (const a of links) {
            const text = (a.innerText || a.textContent || '').trim();
            if (text && text.length > 1 && text.length < 50 && !text.includes('Apply') && !text.includes('Save') && !text.includes('LinkedIn') && text !== title && !text.includes('Home') && !text.includes('Skip')) {
                company = text;
                break;
            }
        }
    }
    
    let description = '';
    const allEls = Array.from(doc.querySelectorAll('h1, h2, h3, h4, h5, h6, strong, span, div'));
    for (const el of allEls) {
        const text = (el.innerText || el.textContent || '').trim().toLowerCase();
        if (text.length < 100 && (text.includes('about the job') || text.includes('about this role') || text.includes('job description'))) {
            let parent = el.parentElement;
            while (parent && (parent.innerText || parent.textContent || '').length < 500) {
                parent = parent.parentElement;
                if (!parent) break;
            }
            if (parent) {
                description = parent.innerText || parent.textContent;
                break;
            }
        }
    }
    
    if (!description || description.length < 100) {
        const elements = Array.from(doc.querySelectorAll('div, article, main'));
        let bestText = '';
        for (const el of elements) {
            const text = el.innerText || el.textContent || '';
            if (text.length > 500 && text.length < 25000) {
                if (text.length > bestText.length) {
                    bestText = text;
                }
            }
        }
        description = bestText;
    }
    
    if (!description) description = fallbackData.description;
    let location = extractLocation(doc, company) || fallbackData.location;
    
    return {
        title: title.trim(),
        company: company.trim(),
        location: location,
        url: fallbackData.url,
        description: description.replace(/Show more|Show less/gi, '').trim(),
        source_website: new URL(fallbackData.url).hostname.replace('www.', '')
    };
}

function showEditModal(jobData, onSave, onCancel) {
    const modal = document.createElement('div');
    modal.id = 'apptracker-modal';
    
    modal.innerHTML = `
      <h3 id="apptracker-modal-header" style="cursor: grab;">
        Review Job Details
        <span style="font-size: 12px; font-weight: normal; color: #94a3b8;">(Drag to move)</span>
      </h3>
      
      <div>
        <label>Job Title</label>
        <input type="text" id="apptracker-modal-title" value="${jobData.title.replace(/"/g, '&quot;')}">
      </div>
      
      <div>
        <label>Company</label>
        <input type="text" id="apptracker-modal-company" value="${jobData.company.replace(/"/g, '&quot;')}">
      </div>
      
      <div>
        <label>Location</label>
        <input type="text" id="apptracker-modal-location" value="${jobData.location.replace(/"/g, '&quot;')}">
      </div>
      
      <div>
        <label>Description</label>
        <textarea id="apptracker-modal-desc">${jobData.description.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
      </div>
      
      <div id="apptracker-modal-actions">
        <button id="apptracker-modal-cancel">Cancel</button>
        <button id="apptracker-modal-save">Save to Tracker</button>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Dragging Logic
    const header = modal.querySelector('#apptracker-modal-header');
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    let xOffset = 0;
    let yOffset = 0;

    header.addEventListener('mousedown', dragStart);
    document.addEventListener('mouseup', dragEnd);
    document.addEventListener('mousemove', drag);

    function dragStart(e) {
      initialX = e.clientX - xOffset;
      initialY = e.clientY - yOffset;
      if (e.target === header || e.target.parentNode === header) {
        isDragging = true;
        header.style.cursor = 'grabbing';
      }
    }

    function dragEnd(e) {
      initialX = currentX;
      initialY = currentY;
      isDragging = false;
      header.style.cursor = 'grab';
    }

    function drag(e) {
      if (isDragging) {
        e.preventDefault();
        currentX = e.clientX - initialX;
        currentY = e.clientY - initialY;
        xOffset = currentX;
        yOffset = currentY;
        
        // Disable 'right' property once we start translating, so it doesn't conflict
        modal.style.right = 'auto';
        modal.style.left = 'calc(100vw - 420px)'; // Start from the initial position
        modal.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
      }
    }
    
    const cancelBtn = modal.querySelector('#apptracker-modal-cancel');
    const saveBtn = modal.querySelector('#apptracker-modal-save');
    
    cancelBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        document.removeEventListener('mouseup', dragEnd);
        document.removeEventListener('mousemove', drag);
        modal.remove();
        onCancel();
    });
    
    saveBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const newData = {
            ...jobData,
            title: modal.querySelector('#apptracker-modal-title').value.trim(),
            company: modal.querySelector('#apptracker-modal-company').value.trim(),
            location: modal.querySelector('#apptracker-modal-location').value.trim(),
            description: modal.querySelector('#apptracker-modal-desc').value.trim()
        };
        
        document.removeEventListener('mouseup', dragEnd);
        document.removeEventListener('mousemove', drag);
        modal.remove();
        onSave(newData);
    });
}

async function identifyJobCards() {
  const hostname = window.location.hostname.replace('www.', '');
  const storageKey = `learned_selector_${hostname}`;
  
  chrome.storage.local.get([storageKey], (result) => {
    let selectors = [
      '.job-card-container',
      '.jobs-search-results__list-item',
      '.jobsearch-SerpJobCard',
      '.tapItem',
      '.job-listing',
      '.result-card',
      '[data-job-id]'
    ];

    if (result[storageKey]) {
      selectors = [result[storageKey]];
    }

    const cards = document.querySelectorAll(selectors.join(', '));
    cards.forEach(card => {
      if (card.dataset.apptrackerProcessed) return;
      card.dataset.apptrackerProcessed = 'true';

      if (window.getComputedStyle(card).position === 'static') {
        card.style.position = 'relative';
      }

      card.addEventListener('mouseenter', () => card.classList.add('apptracker-job-card-hover'));
      card.addEventListener('mouseleave', () => card.classList.remove('apptracker-job-card-hover'));

      const btn = document.createElement('button');
      btn.className = 'apptracker-save-card-btn';
      btn.innerText = 'Save';
      
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        let url = window.location.href;
        let link = card.querySelector('a');
        if (!link) link = card.closest('a');
        if (!link) link = card.parentElement?.querySelector('a');
        
        if (link && link.href) {
          let rawUrl = link.href;
          if (rawUrl.includes('linkedin.com/jobs/view/')) {
            url = rawUrl.split('?')[0];
          } else {
            url = rawUrl;
          }
        }

        const lines = extractTextLines(card);

        let title = card.querySelector('h2, h3, .job-card-list__title, .job-card-container__title, .base-search-card__title, .jobsearch-JobInfoHeader-title, strong')?.innerText;
        if (!title && lines.length > 0) title = lines[0].replace('(Verified job)', '').trim();
        if (!title) title = 'Unknown Title';
        
        let company = card.querySelector('.job-card-container__primary-description, .job-card-container__subtitle, .artdeco-entity-lockup__subtitle, .base-search-card__subtitle, .company, .employer')?.innerText;
        if (!company && lines.length > 1) {
            company = lines.find(l => l !== title && !l.includes(title) && !l.includes('Verified'));
        }
        if (!company) company = 'Unknown Company';
        
        const location = card.querySelector('.job-card-container__metadata-wrapper, .location')?.innerText || '';
        
        const fallbackData = { title, company, location, url, description: lines.join('\\n'), source_website: window.location.hostname };
        
        btn.innerText = 'Fetching...';
        
        const isSplitPane = window.location.href.includes('/jobs/search/') || window.location.href.includes('/jobs/collections/');
        let fullData = fallbackData;
        
        if (isSplitPane && link) {
            fullData = await scrapeSplitPane(card, link, fallbackData);
        } else {
            fullData = scrapeStandalonePage(fallbackData);
        }

        btn.innerText = 'Review...';
        showEditModal(fullData, (editedData) => {
            btn.innerText = 'Saving...';
            chrome.runtime.sendMessage({ action: 'save_job', data: editedData }, (response) => {
              if (response && response.success) {
                btn.innerText = 'Saved!';
                btn.style.background = '#16a34a';
              } else {
                btn.innerText = 'Failed';
                btn.style.background = '#dc2626';
              }
              setTimeout(() => { btn.innerText = 'Save'; btn.style.background = '#2563eb'; }, 2000);
            });
        }, () => {
            btn.innerText = 'Save';
            btn.style.background = '#2563eb';
        });
      });

      card.appendChild(btn);
    });
  });
}

// ----------------- TEACH MODE ----------------- //

function handleTeachMouseOver(e) {
  if (currentHoverEl) {
    currentHoverEl.classList.remove('apptracker-teach-hover');
  }
  currentHoverEl = e.target;
  currentHoverEl.classList.add('apptracker-teach-hover');
}

function handleTeachMouseOut(e) {
  if (currentHoverEl) {
    currentHoverEl.classList.remove('apptracker-teach-hover');
    currentHoverEl = null;
  }
}

function handleTeachClick(e) {
  e.preventDefault();
  e.stopPropagation();
  
  if (!currentHoverEl) return;
  
  const rect = currentHoverEl.getBoundingClientRect();
  if (rect.height > 800 || rect.width > 1200) {
    alert("This element is too large to be a job card! Please click on a smaller, specific job item in the list.");
    return;
  }
  
  // Generate a selector
  const tagName = currentHoverEl.tagName.toLowerCase();
  const classes = Array.from(currentHoverEl.classList).filter(c => c !== 'apptracker-teach-hover').map(c => '.' + c).join('');
  let selector = tagName + classes;
  
  if (selector === tagName) {
    if (currentHoverEl.id) {
      selector += '#' + currentHoverEl.id;
    }
  }

  const hostname = window.location.hostname.replace('www.', '');
  const storageKey = `learned_selector_${hostname}`;
  
  chrome.storage.local.set({ [storageKey]: selector }, () => {
    alert(`Learned job card format: ${selector}`);
    stopTeachMode();
    // Re-process page
    document.querySelectorAll('.apptracker-save-card-btn').forEach(btn => btn.remove());
    document.querySelectorAll('[data-apptracker-processed]').forEach(el => delete el.dataset.apptrackerProcessed);
    identifyJobCards();
  });
}

function startTeachMode() {
  teachModeActive = true;
  document.body.style.cursor = 'crosshair';
  document.addEventListener('mouseover', handleTeachMouseOver, true);
  document.addEventListener('mouseout', handleTeachMouseOut, true);
  document.addEventListener('click', handleTeachClick, true);
}

function stopTeachMode() {
  teachModeActive = false;
  document.body.style.cursor = '';
  document.removeEventListener('mouseover', handleTeachMouseOver, true);
  document.removeEventListener('mouseout', handleTeachMouseOut, true);
  document.removeEventListener('click', handleTeachClick, true);
  if (currentHoverEl) {
    currentHoverEl.classList.remove('apptracker-teach-hover');
    currentHoverEl = null;
  }
}

// Listen for popup messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extract_job') {
    if (!isWhitelisted()) {
      sendResponse({ success: false, error: 'Domain not whitelisted.' });
      return true;
    }
    const fallbackData = { title: document.title, company: 'Unknown', location: '', url: window.location.href, description: '' };
    const data = scrapeStandalonePage(fallbackData);
    
    showEditModal(data, (editedData) => {
        chrome.runtime.sendMessage({ action: 'save_job', data: editedData });
    }, () => {});
    
    sendResponse({ success: true, modalOpened: true });
  } else if (request.action === 'open_manual_modal') {
    const emptyData = { title: '', company: '', location: '', url: window.location.href, description: '' };
    showEditModal(emptyData, (editedData) => {
        chrome.runtime.sendMessage({ action: 'save_job', data: editedData });
    }, () => {});
    sendResponse({ success: true });
  } else if (request.action === 'start_teach_mode') {
    startTeachMode();
    sendResponse({ success: true });
  }
  return true;
});
