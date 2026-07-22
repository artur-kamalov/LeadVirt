import { randomUUID } from "node:crypto";
import { lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";

function fail(code) {
  console.error(`FAIL: ${code}`);
  process.exit(1);
}

function findKeyAssignments(lines) {
  const assignments = [];
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    if (line.slice(0, separator).trim() === "KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY") {
      assignments.push({ index, line, separator });
    }
  }
  return assignments;
}

const envPath = process.argv[2];
if (!envPath || !isAbsolute(envPath)) fail("KNOWLEDGE_ARTIFACT_ENV_PATH_INVALID");

let metadata;
let contents;
try {
  metadata = await lstat(envPath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 1024 * 1024) {
    fail("KNOWLEDGE_ARTIFACT_ENV_FILE_INVALID");
  }
  contents = await readFile(envPath, "utf8");
} catch {
  fail("KNOWLEDGE_ARTIFACT_ENV_FILE_UNREADABLE");
}

if (contents.includes("\0")) fail("KNOWLEDGE_ARTIFACT_ENV_FILE_INVALID");

const lineEnding = contents.includes("\r\n") ? "\r\n" : "\n";
const lines = contents.split(/\r?\n/u);
const assignments = findKeyAssignments(lines);

if (assignments.length === 0) fail("KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY_ASSIGNMENT_INVALID");

const assignment = assignments[assignments.length - 1];
const rawValue = assignment.line.slice(assignment.separator + 1);
const leadingWhitespace = rawValue.match(/^\s*/u)?.[0] ?? "";
const trailingWhitespace = rawValue.match(/\s*$/u)?.[0] ?? "";
let value = rawValue.trim();
let quote = "";
if (
  value.length >= 2 &&
  ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
) {
  quote = value[0];
  value = value.slice(1, -1);
}

if (!/^[A-Za-z0-9+/]{43}=$/u.test(value)) {
  fail("KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY_INVALID");
}
const keyBytes = Buffer.from(value, "base64");
if (keyBytes.byteLength !== 32) fail("KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY_INVALID");
const canonicalValue = keyBytes.toString("base64");

const shadowedAssignmentIndexes = new Set(assignments.slice(0, -1).map(({ index }) => index));
if (canonicalValue === value && shadowedAssignmentIndexes.size === 0) {
  console.log("PASS: knowledge artifact encryption key is canonical.");
  process.exit(0);
}

lines[assignment.index] =
  `${assignment.line.slice(0, assignment.separator + 1)}${leadingWhitespace}${quote}${canonicalValue}${quote}${trailingWhitespace}`;
const updatedLines = lines.filter((_, index) => !shadowedAssignmentIndexes.has(index));
const updatedAssignments = findKeyAssignments(updatedLines);
if (updatedAssignments.length !== 1 || updatedAssignments[0].line !== lines[assignment.index]) {
  fail("KNOWLEDGE_ARTIFACT_ENV_FILE_UPDATE_FAILED");
}
const updatedContents = updatedLines.join(lineEnding);
const directory = dirname(envPath);
const temporaryPath = join(directory, `.${basename(envPath)}.${randomUUID()}.tmp`);
let temporaryHandle;
try {
  temporaryHandle = await open(temporaryPath, "wx", 0o600);
  await temporaryHandle.writeFile(updatedContents, "utf8");
  await temporaryHandle.chmod(metadata.mode & 0o777);
  if (process.platform !== "win32") {
    await temporaryHandle.chown(metadata.uid, metadata.gid);
  }
  await temporaryHandle.sync();
  await temporaryHandle.close();
  temporaryHandle = undefined;
  await rename(temporaryPath, envPath);
  if (process.platform !== "win32") {
    const directoryHandle = await open(directory, "r");
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  }
} catch {
  if (temporaryHandle) await temporaryHandle.close().catch(() => undefined);
  await unlink(temporaryPath).catch(() => undefined);
  fail("KNOWLEDGE_ARTIFACT_ENV_FILE_UPDATE_FAILED");
}

console.log(
  "PASS: knowledge artifact encryption key assignments were normalized without changing effective key bytes.",
);
