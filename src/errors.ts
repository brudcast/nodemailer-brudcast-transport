import type { BrudcastResponse, BrudcastValidationIssue } from "./types";

export class BrudcastError extends Error {
  readonly statusCode: number;
  readonly response: BrudcastResponse;
  readonly errors?: BrudcastValidationIssue[];

  constructor(message: string, statusCode: number, response: BrudcastResponse) {
    super(message);
    this.name = "BrudcastError";
    this.statusCode = statusCode;
    this.response = response;
    this.errors = response.errors;
  }
}
