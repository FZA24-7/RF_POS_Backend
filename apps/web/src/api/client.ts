/** Present only inside the Electron desktop shell (see apps/desktop). There the API is same-origin: `/api`. */
interface DesktopBridge {
  isDesktop: true;
  apiBase: string;
}
declare global {
  interface Window {
    mafkDesktop?: DesktopBridge;
  }
}

const API_URL =
  (typeof window !== 'undefined' ? window.mafkDesktop?.apiBase : undefined) ??
  (import.meta.env.VITE_API_URL as string | undefined) ??
  'http://localhost:4000/api';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Holds the short-lived access token in memory only - never localStorage. */
let accessToken: string | null = null;
export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};
export const getAccessToken = (): string | null => accessToken;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  skipAuthRetry?: boolean;
}

let refreshInFlight: Promise<boolean> | null = null;

export const refreshAccessToken = async (): Promise<boolean> => {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });
        if (!res.ok) return false;
        const data = (await res.json()) as { accessToken: string };
        setAccessToken(data.accessToken);
        return true;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
};

export const apiRequest = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const doFetch = async (): Promise<Response> =>
    fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

  let res = await doFetch();

  // Access token expired mid-session - try exactly one silent refresh, then retry once.
  if (res.status === 401 && !options.skipAuthRetry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) res = await doFetch();
  }

  if (res.status === 204) return undefined as T;

  const contentType = res.headers.get('content-type') ?? '';
  const data = contentType.includes('application/json') ? await res.json() : undefined;

  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | undefined)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'UNKNOWN',
      err?.message ?? `Request failed (${res.status})`,
    );
  }

  return data as T;
};

export const tryRestoreSession = async (): Promise<boolean> => refreshAccessToken();

/**
 * Authenticated binary download (e.g. an invoice PDF). `window.location`
 * navigation cannot carry the in-memory bearer token, so this fetches the
 * file with it and triggers a browser save from a Blob.
 */
export const apiDownload = async (path: string, fallbackName: string): Promise<void> => {
  const doFetch = async (): Promise<Response> =>
    fetch(`${API_URL}${path}`, {
      credentials: 'include',
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    });
  let res = await doFetch();
  if (res.status === 401 && (await refreshAccessToken())) res = await doFetch();
  if (!res.ok) {
    let message = `Download failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: { message?: string } };
      message = data.error?.message ?? message;
    } catch {
      // not JSON - keep the generic message
    }
    throw new ApiError(res.status, 'DOWNLOAD_FAILED', message);
  }
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = match?.[1] ?? fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};
