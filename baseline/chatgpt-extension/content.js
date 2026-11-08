// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractText') {
        // Get all text content from the page
        const textContent = document.body.innerText;
        // Send text back to background script
        sendResponse({ text: textContent });
    }
});
