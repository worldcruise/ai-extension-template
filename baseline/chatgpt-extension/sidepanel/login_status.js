(() => {
    const reason = new URLSearchParams(location.search).get('reason');
    const title = document.querySelector('h1');
    const description = document.querySelector('.container > p');
    const status = document.getElementById('login-status');
    const open = document.getElementById('open-login');
    const retry = document.getElementById('retry-chatgpt');
    if (reason === 'login') {
        title.textContent = 'Log in to ChatGPT to use SideAI';
        description.textContent = 'Sign in on the ChatGPT website to use SideAI. Then return here and click Try again.';
        document.querySelector('.icon').style.animation = 'none';
    } else if (reason === 'unavailable') {
        title.textContent = 'ChatGPT is still loading';
        description.textContent = 'Try loading ChatGPT again, or open it in a browser tab.';
        document.querySelector('.reopen-instruction').hidden = true;
        open.textContent = 'Open ChatGPT';
        retry.textContent = 'Try again';
        document.querySelector('.icon').style.animation = 'none';
    }
    async function openLoginTab() {
        open.disabled = true;
        try {
            if (reason === 'unavailable') {
                await chrome.tabs.create({ url: 'https://chatgpt.com/' });
            } else {
                const result = await chrome.runtime.sendMessage({ type: 'SIDEAI_OPEN_CHATGPT_LOGIN' });
                if (!result?.ok) throw new Error('Could not open login');
            }
            if (reason === 'unavailable') {
                status.textContent = 'ChatGPT opened in a browser tab. Return here and select Try again.';
            } else {
                title.textContent = 'Log in to ChatGPT to use SideAI';
                description.textContent = 'Complete sign-in in the new tab, then return here and try again.';
            }
        } catch (_) {
            status.textContent = 'Could not open a tab. Please open chatgpt.com to sign in.';
        } finally { open.disabled = false; }
    }
    open.addEventListener('click', openLoginTab);
    // A retry is a request to reload, never proof that authentication succeeded.
    retry.addEventListener('click', async () => {
        retry.disabled = true;
        status.textContent = 'Opening ChatGPT…';
        try {
            if (window !== window.top) {
                window.parent.postMessage({ type: 'SIDEAI_RETRY_LOGIN' }, chrome.runtime.getURL('').replace(/\/$/, ''));
            } else {
                const auth = await chrome.runtime.sendMessage({ type: 'SIDEAI_CHECK_AUTH' });
                status.textContent = auth?.allowed === true ? 'ChatGPT is signed in. Reopen the SideAI sidebar to continue.' :
                    auth?.loginRequired === true ? 'Please finish signing in on ChatGPT, then try again.' :
                    'Could not check ChatGPT. Please try again.';
            }
        } catch (_) {
            status.textContent = 'Could not check ChatGPT. Please try again.';
        } finally { retry.disabled = false; }
    });
    async function recoverSignedInPanel() {
        if (window === window.top || window.frameElement?.hidden) return;
        try {
            const auth = await chrome.runtime.sendMessage({ type: 'SIDEAI_CHECK_AUTH' });
            if (auth?.allowed === true && !window.frameElement?.hidden) {
                window.parent.postMessage({ type: 'SIDEAI_RETRY_LOGIN' }, chrome.runtime.getURL('').replace(/\/$/, ''));
            }
        } catch (_) {}
    }
    void recoverSignedInPanel();
})();
