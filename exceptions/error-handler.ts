import type { ErrorRequestHandler } from "express";
import { config } from "../config";
import { BaseError } from "./base.error";

function getStatusCode(error: any): number {
  if (error instanceof BaseError) return error.statusCode;
  if (typeof error?.statusCode === "number") return error.statusCode;
  if (typeof error?.status === "number") return error.status;

  // body-parser JSON parse error
  if (error?.type === "entity.parse.failed") return 400;

  return 500;
}

function getSafeMessage(error: any, statusCode: number): string {
  if (error instanceof BaseError) return error.message;
  if (statusCode === 400 && error?.type === "entity.parse.failed") return "Invalid JSON body";
  if (!config.isProduction && typeof error?.message === "string" && error.message.trim() !== "") return error.message;
  if (statusCode === 404) return "Not Found";
  return "Internal Server Error";
}

function getCode(error: any, statusCode: number): string {
  if (error instanceof BaseError) return error.code;
  if (statusCode === 400 && error?.type === "entity.parse.failed") return "INVALID_JSON";
  if (statusCode === 404) return "NOT_FOUND";
  return "INTERNAL_ERROR";
}

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const statusCode = getStatusCode(error);
  const message = getSafeMessage(error, statusCode);
  const code = getCode(error, statusCode);

  if (!config.isProduction && !(error instanceof BaseError)) {
    // eslint-disable-next-line no-console
    console.error("Unhandled error:", error);
  }

  const payload: Record<string, unknown> = {
    success: false,
    message,
    statusCode,
    code,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString(),
  };

  if (error instanceof BaseError) {
    payload.data = error.data ?? null;
  } else if (!config.isProduction) {
    payload.data = { stack: error?.stack ?? null };
  }

  res.status(statusCode).json(payload);
};


