import { apiRequest } from "../queryClient";

export async function typedRequest<TResponse>(
  method: string,
  url: string,
  data?: unknown,
): Promise<TResponse> {
  const args: [string, string, ...unknown[]] = [method, url];
  if (data !== undefined) args.push(data);
  const res = await apiRequest(...args);
  return res.json() as Promise<TResponse>;
}

export function rawRequest(method: string, url: string, data?: unknown): Promise<Response> {
  const args: [string, string, ...unknown[]] = [method, url];
  if (data !== undefined) args.push(data);
  return apiRequest(...args);
}
