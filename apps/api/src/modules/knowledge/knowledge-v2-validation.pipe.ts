import { HttpStatus, ValidationPipe, type Type } from "@nestjs/common";
import { compareKnowledgeCanonicalText } from "@leadvirt/knowledge";
import type { KnowledgeV2FieldError } from "@leadvirt/types";
import type { ValidationError } from "class-validator";
import { knowledgeV2Error } from "./knowledge-v2-http.js";

const MAX_FIELD_ERRORS = 40;
const MAX_ERROR_DEPTH = 8;
const MAX_FIELD_LENGTH = 240;
const MAX_MESSAGE_LENGTH = 300;

function safeSegment(value: string) {
  const sanitized = value.replace(/[^\p{L}\p{N}_-]/gu, "_").slice(0, 80);
  return sanitized || "field";
}

function constraintCode(value: string) {
  const normalized = value
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z\d]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()
    .slice(0, 64);
  return `KNOWLEDGE_VALIDATION_${normalized || "INVALID"}`;
}

function safeMessage(value: string) {
  return value
    .replace(/\p{Cc}+/gu, " ")
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
}

function flattenValidationErrors(errors: ValidationError[]) {
  const fieldErrors: KnowledgeV2FieldError[] = [];
  const seen = new Set<string>();
  let truncated = false;

  const visit = (error: ValidationError, parent: string, depth: number) => {
    if (fieldErrors.length >= MAX_FIELD_ERRORS - 1 || depth > MAX_ERROR_DEPTH) {
      truncated = true;
      return;
    }

    const segment = safeSegment(error.property);
    const field = (parent ? `${parent}.${segment}` : segment).slice(0, MAX_FIELD_LENGTH);
    const constraints = Object.entries(error.constraints ?? {}).sort(([left], [right]) =>
      compareKnowledgeCanonicalText(left, right),
    );

    for (const [constraint, message] of constraints) {
      if (fieldErrors.length >= MAX_FIELD_ERRORS - 1) {
        truncated = true;
        break;
      }
      const code = constraintCode(constraint);
      const key = `${field}\u0000${code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fieldErrors.push({
        field,
        code,
        message: safeMessage(message) || "The field is invalid.",
      });
    }

    for (const child of error.children ?? []) {
      visit(child, field, depth + 1);
    }
  };

  for (const error of errors) {
    visit(error, "", 0);
  }

  if (truncated) {
    fieldErrors.push({
      field: "request",
      code: "KNOWLEDGE_VALIDATION_TOO_MANY_ERRORS",
      message: "Additional validation errors were omitted.",
    });
  }
  if (fieldErrors.length === 0) {
    fieldErrors.push({
      field: "request",
      code: "KNOWLEDGE_VALIDATION_INVALID",
      message: "The request is invalid.",
    });
  }

  return fieldErrors;
}

export function createKnowledgeV2ValidationPipe(expectedType?: Type<unknown>) {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    ...(expectedType ? { expectedType } : {}),
    validationError: { target: false, value: false },
    exceptionFactory: (errors: ValidationError[]) =>
      knowledgeV2Error(
        HttpStatus.BAD_REQUEST,
        "KNOWLEDGE_VALIDATION_INPUT_INVALID",
        "The request contains invalid fields.",
        { fieldErrors: flattenValidationErrors(errors) },
      ),
  });
}

export const knowledgeV2ValidationPipe = createKnowledgeV2ValidationPipe();
