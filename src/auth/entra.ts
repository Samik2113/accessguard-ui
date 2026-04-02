import { PublicClientApplication, type AuthenticationResult, type RedirectRequest } from '@azure/msal-browser';

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

function getInteractiveRequest(): RedirectRequest {
  return {
    scopes: ['openid', 'profile', 'email', apiScope],
    prompt: 'select_account',
    redirectUri
  };
}

export function isEntraSsoConfigured() {
  return configured;
}

export async function signInWithEntraRedirect(): Promise<void> {
  const instance = await getMsalInstance();
  await instance.loginRedirect(getInteractiveRequest());
}

export async function completeEntraRedirectIfPresent(): Promise<AuthenticationResult | null> {
  const instance = await getMsalInstance();
  const result = await instance.handleRedirectPromise();
  if (!result) return null;
  if (result.account) instance.setActiveAccount(result.account);

  if (result.accessToken) return result;

  const tokenResult = await instance.acquireTokenSilent({
      scopes: [apiScope],
      account: result.account || instance.getActiveAccount() || undefined
    });
  if (tokenResult.account) instance.setActiveAccount(tokenResult.account);
  return tokenResult;
}

export async function logoutFromEntra() {
  if (!configured) return;
  const instance = await getMsalInstance();
  const account = instance.getActiveAccount() || instance.getAllAccounts()[0] || undefined;
  await instance.logoutPopup({ account, postLogoutRedirectUri: redirectUri });
}