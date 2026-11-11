// Readiness and manual input fixture only; no prompt generation or AI responses.
export function chatFixtureScript() {
  if (document.querySelector('form[data-logged-out]')) return;
  const account = document.createElement('button');
  account.type = 'button'; account.dataset.testid = 'accounts-profile-button';
  account.setAttribute('aria-label', 'Open profile menu'); account.textContent = 'Fixture account';
  document.body.prepend(account);
}
