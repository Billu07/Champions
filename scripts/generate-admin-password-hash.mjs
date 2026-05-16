import { createHash, randomBytes } from "node:crypto";

const password = process.argv[2] ?? "";
const salt = process.argv[3] ?? randomBytes(16).toString("hex");

if (!password || password.length < 8) {
  process.stderr.write("Usage: node scripts/generate-admin-password-hash.mjs <password> [salt]\n");
  process.stderr.write("Password must be at least 8 characters.\n");
  process.exit(1);
}

const hash = createHash("sha256")
  .update(`${salt}:${password}`)
  .digest("hex");

process.stdout.write(`ADMIN_PASSWORD_SALT=${salt}\n`);
process.stdout.write(`ADMIN_PASSWORD_HASH=${hash}\n`);
