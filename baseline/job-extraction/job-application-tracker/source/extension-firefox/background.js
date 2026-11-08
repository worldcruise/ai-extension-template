chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'save_job') {
    fetch('http://localhost:3000/api/extension', {
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
        chrome.tabs.query({ url: "http://localhost:3000/*" }, (tabs) => {
          tabs.forEach(tab => chrome.tabs.reload(tab.id));
        });
      } else {
        sendResponse({ success: false, error: data.error });
      }
    })
    .catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    
    return true; // Indicates we will respond asynchronously
  }
});
