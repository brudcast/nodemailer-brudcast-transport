import type { BrudcastResponse, BrudcastValidationIssue } from "./types";

/**
 * Read the validation issues from a response body as a list
 *
 * @param errors - The body's `errors` field
 * @returns The issues, the values of an object, or an empty list for anything else
 */
const toIssues = (errors: unknown): BrudcastValidationIssue[] => {
  if (Array.isArray(errors)) {
    return errors;
  }
  return typeof errors === "object" && errors !== null ? Object.values(errors) : [];
};

/**
 * The options of a BrudcastError: the standard `cause`, and the seconds the service asked to wait
 * before retrying
 */
export interface BrudcastErrorOptions extends ErrorOptions {
  retryAfter?: number | undefined;
}

/**
 * A send or verify that the Brudcast mailing service refused, or could not be reached for
 *
 * `statusCode` is the HTTP status, or 0 when no response arrived, in which case the original
 * error is the `cause`. `retryAfter` is the response's `Retry-After` header in seconds, from
 * either a number of seconds or an HTTP-date, and is undefined when the header is absent or not
 * valid.
 */
export class BrudcastError extends Error {
  readonly statusCode: number;
  readonly response: BrudcastResponse;
  readonly errors: BrudcastValidationIssue[];
  readonly retryAfter: number | undefined;

  constructor(
    message: string,
    statusCode: number,
    response: BrudcastResponse,
    options?: BrudcastErrorOptions
  ) {
    const { retryAfter, ...errorOptions } = options ?? {};
    super(message, errorOptions);
    this.name = "BrudcastError";
    this.statusCode = statusCode;
    this.response = response;
    this.errors = toIssues(response.errors);
    this.retryAfter = retryAfter;
  }
}
