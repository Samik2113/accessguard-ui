import { PublicClientApplication, type AuthenticationResult, type PopupRequest } from '@azure/msal-browser';

const tenantId = String(import.meta.env.VITE_ENTRA_TENANT_ID || '').trim();
const clientId = String(import.meta.env.VITE_ENTRA_CLIENT_ID || '').trim();
const redirectUri = String(import.meta.env.VITE_ENTRA_REDIRECT_URI || window.location.origin).trim();
const apiScope = String(import.meta.env.VITE_ENTRA_API_SCOPE || '').trim();

const configured = Boolean(tenantId && clientId && apiScope);

const msalInstance = configured
  ? new PublicClientApplication({
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        redirectUri
      },
      cache: {
        cacheLocation: 'localStorage'
      }
    })
  : null;

let initialized = false;

async function getMsalInstance() {
  if (!msalInstance) {
    throw new Error('Entra SSO is not configured. Set VITE_ENTRA_TENANT_ID, VITE_ENTRA_CLIENT_ID, and VITE_ENTRA_API_SCOPE.');
  }
  if (!initialized) {
    await msalInstance.initialize();
    initialized = true;
  }
  return msalInstance;
}

function getPopupRequest(): PopupRequest {
  return {
    scopes: ['openid', 'profile', 'email', apiScope],
    prompt: 'select_account'
  };
}

export function isEntraSsoConfigured() {
  return configured;
}

export async function signInWithEntraPopup(): Promise<AuthenticationResult> {
  const instance = await getMsalInstance();
  const loginResult = await instance.loginPopup(getPopupRequest());
  if (loginResult.account) instance.setActiveAccount(loginResult.account);

  try {
    const silentResult = await instance.acquireTokenSilent({
      scopes: [apiScope],
      account: loginResult.account || instance.getActiveAccount() || undefined
    });
    if (silentResult.account) instance.setActiveAccount(silentResult.account);
    return silentResult;
  } catch {
    const popupResult = await instance.acquireTokenPopup({
      scopes: [apiScope],
      account: loginResult.account || instance.getActiveAccount() || undefined
    });
    if (popupResult.account) instance.setActiveAccount(popupResult.account);
    return popupResult;
  }
}

export async function logoutFromEntra() {
  if (!configured) return;
  const instance = await getMsalInstance();
  const account = instance.getActiveAccount() || instance.getAllAccounts()[0] || undefined;
  await instance.logoutPopup({ account, postLogoutRedirectUri: redirectUri });
}