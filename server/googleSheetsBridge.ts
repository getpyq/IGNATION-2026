interface AppsScriptEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
  status?: number;
}

export function isGoogleSheetsConfigured(): boolean {
  const url = process.env.APPS_SCRIPT_URL?.trim();
  return Boolean(url && url.startsWith('https://'));
}

export class AppsScriptError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

export async function callAppsScript<T>(
  action: string,
  payload: Record<string, unknown> = {}
): Promise<T> {
  const url = process.env.APPS_SCRIPT_URL?.trim();
  if (!url || !url.startsWith('https://')) {
    throw new AppsScriptError(
      'Google Apps Script Web App URL (APPS_SCRIPT_URL) is not configured. Deploy google-apps-script/Code.gs and set APPS_SCRIPT_URL in .env.',
      503
    );
  }

  const secret = process.env.APPS_SCRIPT_SECRET?.trim() || '';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
    },
    body: JSON.stringify({
      action,
      secret,
      payload,
    }),
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new AppsScriptError(
      `Apps Script request failed with HTTP ${response.status}.`,
      502
    );
  }

  const json = (await response.json()) as AppsScriptEnvelope<T>;
  if (!json.ok) {
    throw new AppsScriptError(
      json.error || 'Google Sheets Apps Script error.',
      json.status || 400
    );
  }

  return json.data as T;
}
