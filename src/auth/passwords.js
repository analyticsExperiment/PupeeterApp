const crypto = require("crypto");

const ITERATIONS = 210000;
const KEYLEN = 64;
const DIGEST = "sha512";

function hashPassword(password) {
  const input = String(password || "");
  if (!input) throw new Error("Password is required");
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.pbkdf2Sync(input, salt, ITERATIONS, KEYLEN, DIGEST).toString("hex");
  return `pbkdf2$${DIGEST}$${ITERATIONS}$${salt}$${derived}`;
}

function verifyPasswordHash(password, storedHash) {
  const input = String(password || "");
  const stored = String(storedHash || "");
  if (!stored.startsWith("pbkdf2$")) return false;

  const parts = stored.split("$");
  if (parts.length !== 5) return false;

  const [, digest, iterationsRaw, salt, expectedHex] = parts;
  const iterations = Number.parseInt(iterationsRaw, 10);
  if (!Number.isFinite(iterations) || iterations <= 0 || !salt || !expectedHex) {
    return false;
  }

  const derived = crypto.pbkdf2Sync(input, salt, iterations, KEYLEN, digest).toString("hex");
  const expected = Buffer.from(expectedHex, "hex");
  const actual = Buffer.from(derived, "hex");
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

module.exports = {
  hashPassword,
  verifyPasswordHash
};
