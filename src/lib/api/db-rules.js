import { ApiError } from "./api-error.js";

// Our triggers reject invalid changes with
//   RAISE EXCEPTION '<readable message>' USING ERRCODE = 'check_violation'
// which reaches Node as code 23514 with NO constraint name (a real CHECK
// constraint violation always has one). The message is our own text, not
// SQL internals, so it is safe to show to the user as a 409 Conflict.
// Returns null for any other error, which the caller should rethrow.
export function toBusinessRuleError(err) {
  if (err?.code !== "23514" || err?.constraint) return null;
  const code = /Invalid application status transition/.test(err.message) ? "INVALID_TRANSITION" : "RULE_VIOLATION";
  return new ApiError(409, code, err.message, err.hint ? { hint: err.hint } : undefined);
}

// Run a block, translating trigger errors. Everything else passes through.
export function rethrowBusinessRule(err) {
  throw toBusinessRuleError(err) || err;
}
