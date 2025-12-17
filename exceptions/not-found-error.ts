import { BaseError } from "./base.error";

export class NotFoundError extends BaseError {
  constructor(resource = "Resource") {
    super(`${resource} not found`, 404, "NOT_FOUND");
  }
}
