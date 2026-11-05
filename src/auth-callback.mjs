// Remove the one-use code from this tab's address/history before rendering.
const query=location.search;
history.replaceState(null,'',chrome.runtime.getURL('auth-callback.html'));
const status=document.getElementById('callback-status');
try{
  const reply=await chrome.runtime.sendMessage({type:'auth.callback',query});
  status.textContent=reply?.ok?'Connected to ChatGPT. Return to the AI agent panel; you can close this tab.':'Sign-in could not be verified. Return to the AI agent panel to try again.';
}catch{status.textContent='The extension was reloaded. Reopen the AI agent panel and sign in again.';}
