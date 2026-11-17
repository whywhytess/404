import type { ApiErrorBody, ErrorCode, PublicUser } from '@webcove/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'INTERNAL',
      err?.message ?? 'Something went wrong',
      err?.details,
    );
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  delete: <T>(url: string) => request<T>('DELETE', url),
};

export type Role = 'student' | 'ta' | 'instructor' | 'admin';

export interface Course {
  id: string;
  code: string;
  title: string;
  endDate: string | null;
  joinCode?: string;
  role: Role;
}

export interface Assignment {
  id: string;
  courseId: string;
  title: string;
  description: string;
  status: 'open' | 'closed';
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StaffMember extends PublicUser {
  role?: 'instructor' | 'ta';
}

export type { PublicUser };

/** Field-level messages from a VALIDATION_FAILED error, keyed by field path. */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || err.code !== 'VALIDATION_FAILED') return {};
  const fields =
    (err.details as { fields?: { path: string; message: string }[] } | undefined)?.fields ?? [];
  return Object.fromEntries(fields.map((f) => [f.path, f.message]));
}

export const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : 'Something went wrong';

export interface Issue {
  code: string;
  file?: string;
  message: string;
}

export interface Version {
  id: string;
  number: number;
  fileCount: number;
  totalBytes: number;
  warningCount: number;
  warnings: Issue[];
  filesAvailable: boolean;
  createdAt: string;
}

export interface Submission {
  id: string;
  assignmentId: string;
  studentId: string;
  subdomain: string;
  currentVersionId: string | null;
  previousVersionId: string | null;
  takenDown: boolean;
  takenDownReason: string | null;
  updatedAt: string;
}

/**
 * Upload a ZIP with progress reporting (XMLHttpRequest, because fetch cannot report
 * upload progress). Resolves with the JSON body or rejects with ApiError.
 */
export function uploadArchive<T>(
  url: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () =>
      reject(new ApiError(0, 'NETWORK', 'The upload failed. Check your connection and try again.'));
    xhr.onload = () => {
      const body = xhr.response as ({ error?: ApiErrorBody['error'] } & T) | null;
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
      else {
        const err = body?.error;
        reject(
          new ApiError(
            xhr.status,
            err?.code ?? 'INTERNAL',
            err?.message ?? 'Upload failed',
            err?.details,
          ),
        );
      }
    };
    const form = new FormData();
    form.append('archive', file);
    xhr.send(form);
  });
}

export const formatBytes = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;

export interface ViewLink {
  url: string;
  origin: string;
  expiresAt: string;
  subdomain: string;
  versionId: string;
}

/** Ask the platform for a short-lived access link to a submission (FR-23). */
export const getViewLink = (submissionId: string) =>
  api.post<ViewLink>(`/api/submissions/${submissionId}/view-token`);
