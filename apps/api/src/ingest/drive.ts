import { createSign } from 'node:crypto';

import { htmlToMarkdown } from '@sunny/knowledge';

/**
 * Google Drive as a knowledge source (Blueprint §2 "Google Drive Sync", §3.1).
 *
 * Two ways an installer connects a folder:
 *
 *   - **Share with the service account** (`service_account`): they share the
 *     folder, Viewer only, with the platform's service account. Nothing to sign
 *     in to; the platform reads exactly what was shared. Credentials: the
 *     service-account key JSON in `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` (from
 *     Secret Manager in production).
 *   - **Google sign-in** (`oauth`): they connect with OAuth and the platform
 *     keeps a refresh token for `drive.readonly`. Credentials: the OAuth client
 *     in `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`.
 *
 * Read-only by construction: the only scope ever requested is
 * `drive.readonly`, and no method here writes (Blueprint §4.1).
 *
 * **Acceptance status:** this client is written against the Drive REST v3
 * documentation and exercised in tests through the `DriveClient` interface with
 * a fake. It has not been run against a real Google project, because no
 * credentials are available to this build. That is the blocker, and it is
 * stated rather than assumed away.
 */

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  version?: string;
  webViewLink?: string;
  parents?: string[];
  trashed?: boolean;
}

export type DriveContent =
  | { kind: 'text'; markdown: string }
  | { kind: 'needs-extraction'; reason: string }
  | { kind: 'unsupported'; reason: string };

export interface DriveChange {
  fileId: string;
  removed: boolean;
  file?: DriveFile;
}

export interface DriveClient {
  /** Every file under the folder, recursively, and the ids of every folder walked. */
  listFolder(folderId: string): Promise<{ files: DriveFile[]; folderIds: string[] }>;
  read(file: DriveFile): Promise<DriveContent>;
  startPageToken(): Promise<string>;
  changes(pageToken: string): Promise<{ changes: DriveChange[]; newStartPageToken: string }>;
}

export const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const API = 'https://www.googleapis.com/drive/v3';
const FILE_FIELDS = 'id,name,mimeType,modifiedTime,version,webViewLink,parents,trashed';

export function driveLink(file: DriveFile): string {
  return file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`;
}

// ─── credentials ─────────────────────────────────────────────────────────────

export type TokenProvider = () => Promise<string>;

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/** A signed JWT-bearer assertion for the service account (RFC 7523). */
export function serviceAccountAssertion(key: ServiceAccountKey, nowSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: key.client_email,
      scope: SCOPE,
      aud: key.token_uri ?? 'https://oauth2.googleapis.com/token',
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${base64url(signer.sign(key.private_key))}`;
}

function cachedToken(
  fetchToken: () => Promise<{ token: string; expiresIn: number }>,
): TokenProvider {
  let current: { token: string; expiresAt: number } | null = null;
  return async () => {
    if (current && current.expiresAt > Date.now() + 60_000) return current.token;
    const { token, expiresIn } = await fetchToken();
    current = { token, expiresAt: Date.now() + expiresIn * 1000 };
    return token;
  };
}

async function tokenRequest(
  url: string,
  body: URLSearchParams,
): Promise<{ token: string; expiresIn: number }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !json.access_token) {
    throw new Error(
      `Google token request failed (${response.status}): ${json.error_description ?? json.error ?? 'no token'}`,
    );
  }
  return { token: json.access_token, expiresIn: json.expires_in ?? 3600 };
}

export function serviceAccountTokens(keyJson: string): TokenProvider {
  const key = JSON.parse(keyJson) as ServiceAccountKey;
  if (!key.client_email || !key.private_key) {
    throw new Error('The service-account key is missing client_email or private_key.');
  }
  return cachedToken(() =>
    tokenRequest(
      key.token_uri ?? 'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: serviceAccountAssertion(key, Math.floor(Date.now() / 1000)),
      }),
    ),
  );
}

export function oauthTokens(
  client: { id: string; secret: string },
  refreshToken: string,
): TokenProvider {
  return cachedToken(() =>
    tokenRequest(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: client.id,
        client_secret: client.secret,
        refresh_token: refreshToken,
      }),
    ),
  );
}

// ─── reading files ───────────────────────────────────────────────────────────

/** A CSV export (Google Sheets) as a Markdown table, so a price list stays a table. */
export function csvToMarkdown(csv: string): string {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i]!;
    if (quoted) {
      if (ch === '"' && csv[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && csv[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  const filled = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (filled.length === 0) return '';
  const width = Math.max(...filled.map((r) => r.length));
  const line = (cells: string[]) =>
    `| ${[...cells, ...Array<string>(width - cells.length).fill('')]
      .map((c) => c.trim().replace(/\|/g, '\\|').replace(/\n/g, ' '))
      .join(' | ')} |`;
  return [
    line(filled[0]!),
    line(Array<string>(width).fill('---')),
    ...filled.slice(1).map(line),
  ].join('\n');
}

export class RestDriveClient implements DriveClient {
  readonly #token: TokenProvider;

  constructor(token: TokenProvider) {
    this.#token = token;
  }

  async #get(path: string, params: Record<string, string> = {}): Promise<Response> {
    const url = new URL(`${API}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${await this.#token()}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Drive API ${path} failed (${response.status}): ${text.slice(0, 200)}`);
    }
    return response;
  }

  async listFolder(folderId: string): Promise<{ files: DriveFile[]; folderIds: string[] }> {
    const files: DriveFile[] = [];
    const folderIds: string[] = [];
    const queue = [folderId];
    while (queue.length > 0 && folderIds.length < 200) {
      const folder = queue.shift()!;
      folderIds.push(folder);
      let pageToken: string | undefined;
      do {
        const response = await this.#get('/files', {
          q: `'${folder.replace(/'/g, "\\'")}' in parents and trashed = false`,
          fields: `nextPageToken,files(${FILE_FIELDS})`,
          pageSize: '200',
          supportsAllDrives: 'true',
          includeItemsFromAllDrives: 'true',
          ...(pageToken ? { pageToken } : {}),
        });
        const json = (await response.json()) as { files?: DriveFile[]; nextPageToken?: string };
        for (const file of json.files ?? []) {
          if (file.mimeType === FOLDER_MIME) queue.push(file.id);
          else files.push(file);
        }
        pageToken = json.nextPageToken;
      } while (pageToken);
    }
    return { files, folderIds };
  }

  async read(file: DriveFile): Promise<DriveContent> {
    const id = encodeURIComponent(file.id);
    switch (file.mimeType) {
      case 'application/vnd.google-apps.document': {
        // Docs export to Markdown natively, which keeps headings and tables.
        try {
          const response = await this.#get(`/files/${id}/export`, { mimeType: 'text/markdown' });
          return { kind: 'text', markdown: await response.text() };
        } catch {
          const response = await this.#get(`/files/${id}/export`, { mimeType: 'text/html' });
          return { kind: 'text', markdown: htmlToMarkdown(await response.text()).markdown };
        }
      }
      case 'application/vnd.google-apps.spreadsheet': {
        const response = await this.#get(`/files/${id}/export`, { mimeType: 'text/csv' });
        return {
          kind: 'text',
          markdown: `# ${file.name}\n\n${csvToMarkdown(await response.text())}`,
        };
      }
      case 'application/vnd.google-apps.presentation': {
        const response = await this.#get(`/files/${id}/export`, { mimeType: 'text/plain' });
        return { kind: 'text', markdown: await response.text() };
      }
      case 'text/markdown':
      case 'text/plain': {
        const response = await this.#get(`/files/${id}`, {
          alt: 'media',
          supportsAllDrives: 'true',
        });
        return { kind: 'text', markdown: await response.text() };
      }
      case 'text/html': {
        const response = await this.#get(`/files/${id}`, {
          alt: 'media',
          supportsAllDrives: 'true',
        });
        return { kind: 'text', markdown: htmlToMarkdown(await response.text()).markdown };
      }
      case 'application/pdf':
        return {
          kind: 'needs-extraction',
          reason:
            'PDF text extraction is not available in this pipeline yet. Convert it to a Google Doc (Open with › Google Docs) and it will be read on the next sync.',
        };
      default:
        return {
          kind: 'unsupported',
          reason: `Files of type ${file.mimeType} are not read. Use a Google Doc, Sheet, or a text/Markdown file.`,
        };
    }
  }

  async startPageToken(): Promise<string> {
    const response = await this.#get('/changes/startPageToken', { supportsAllDrives: 'true' });
    const json = (await response.json()) as { startPageToken: string };
    return json.startPageToken;
  }

  async changes(pageToken: string): Promise<{ changes: DriveChange[]; newStartPageToken: string }> {
    const changes: DriveChange[] = [];
    let token: string | undefined = pageToken;
    let newStartPageToken = pageToken;
    while (token) {
      const response = await this.#get('/changes', {
        pageToken: token,
        fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS}))`,
        pageSize: '500',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      });
      const json = (await response.json()) as {
        changes?: DriveChange[];
        nextPageToken?: string;
        newStartPageToken?: string;
      };
      changes.push(...(json.changes ?? []));
      token = json.nextPageToken;
      if (json.newStartPageToken) newStartPageToken = json.newStartPageToken;
    }
    return { changes, newStartPageToken };
  }
}
