// permission_prompt.js

async function notifyBackground(message) {
  try {
    await chrome.runtime.sendMessage(message);
  } catch (error) {
    console.error('Unable to notify background page about microphone permission result:', error);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // If permission is granted, send a message to the background script
    await notifyBackground({ type: 'mic-permission-granted' });
    console.log('Microphone permission granted in permission prompt page.');
    // Stop the stream immediately as we only needed the permission
    stream.getTracks().forEach(track => track.stop());
  } catch (error) {
    // If permission is denied or an error occurs, send a message to the background script
    await notifyBackground({ type: 'mic-permission-denied', error: error.name + ': ' + error.message });
    console.error('Microphone permission denied in permission prompt page:', error);
  } finally {
    // Close the current tab after attempting to get permission
    window.close();
  }
});
