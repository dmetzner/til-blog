// Generates public/.well-known/security.txt with a rolling Expires date.
// Runs on every build (prebuild hook) so the RFC 9116 Expires never goes stale.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", ".well-known", "security.txt");

const expires = new Date();
expires.setFullYear(expires.getFullYear() + 1);

const body = `Contact: https://github.com/dmetzner/til-blog/security/advisories/new
Expires: ${expires.toISOString()}
Preferred-Languages: en, de
Canonical: https://til.metzner.uk/.well-known/security.txt
`;

await mkdir(dirname(out), { recursive: true });
await writeFile(out, body);
console.log(`security.txt written, Expires: ${expires.toISOString()}`);
