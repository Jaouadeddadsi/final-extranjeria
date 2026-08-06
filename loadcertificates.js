import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";
import { Client } from "pg";

const DATABASE_URL = "postgresql://jd:jd2025@38.242.129.87:5432/dgt";

const PASSWORD = "1234";
const OUTPUT_DIR = "./certificates";

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
  });

  await client.connect();

  const { rows } = await client.query(
    `SELECT * FROM dgt WHERE "isPayload" = true`,
  );

  for (const record of rows) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cert-"));

    const certFile = path.join(tmp, "cert.pem");
    const keyFile = path.join(tmp, "key.pem");

    fs.writeFileSync(certFile, record.cert);
    fs.writeFileSync(keyFile, record.key);

    const filename =
      record.nif.replace(/\s+/g, "").toLowerCase() + "__1234.p12";

    const output = path.join(OUTPUT_DIR, filename);

    execFileSync("openssl", [
      "pkcs12",
      "-export",
      "-inkey",
      keyFile,
      "-in",
      certFile,
      "-name",
      record.primer_apellido,
      "-passout",
      `pass:${PASSWORD}`,
      "-out",
      output,
    ]);

    fs.rmSync(tmp, {
      recursive: true,
      force: true,
    });

    console.log(`${filename} created`);
  }

  await client.end();
}

main().catch(console.error);
