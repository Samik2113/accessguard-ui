export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiErrorResponse {
  ok: false;
  error: ApiErrorBody;
}
