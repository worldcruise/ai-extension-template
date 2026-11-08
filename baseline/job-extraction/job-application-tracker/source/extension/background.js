chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'save_job') {
    chrome.tabs.query({}, (tabs) => {
      let trackerUrl = 'http://localhost:3000';
      const trackerTab = tabs.find(t => {
        if (!t.url || !t.title) return false;
        const isLocal = t.url.startsWith('http://localhost') || t.url.startsWith('http://127.0.0.1');
        const isTracker = t.title.includes('Tracker') || t.title.includes('AppTracker');
        return isLocal && isTracker;
      });
      
      if (trackerTab) {
        const urlObj = new URL(trackerTab.url);
        trackerUrl = urlObj.origin;
      }

      fetch(`${trackerUrl}/api/extension`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(request.data)
      })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          sendResponse({ success: true });
          chrome.tabs.query({ url: `${trackerUrl}/*` }, (appTabs) => {
            appTabs.forEach(tab => chrome.tabs.reload(tab.id));
          });
        } else {
          sendResponse({ success: false, error: data.error });
        }
      })
      .catch(err => {
        sendResponse({ success: false, error: err.message });
      });
    });
    
    return true; // Indicates we will respond asynchronously
  }
});
