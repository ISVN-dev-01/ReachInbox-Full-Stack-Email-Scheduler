export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.');
  }
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!response.ok)
    throw new ApiError(
      response.status,
      body?.error?.message ?? 'The server is unavailable. Please try again.',
    );
  return body as T;
}
export async function get<T>(path: string) {
  return (await request<{ data: T }>(path)).data;
}
export async function post<T>(path: string, body?: unknown, headers?: Record<string, string>) {
  return (
    await request<{ data: T }>(path, { method: 'POST', body: JSON.stringify(body ?? {}), headers })
  ).data;
}
