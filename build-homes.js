import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const CERTS_DIR = path.resolve("./certificates");
const HOMES_DIR = path.resolve("./homes");

// Remove the old homes directory if it exists
if (fs.existsSync(HOMES_DIR)) {
  console.log("Removing existing homes directory...");
  fs.rmSync(HOMES_DIR, {
    recursive: true,
    force: true,
  });
}
// Recreate an empty homes directory
fs.mkdirSync(HOMES_DIR, { recursive: true });

const certFiles = fs
  .readdirSync(CERTS_DIR)
  .filter((file) => /\.(p12|pfx)$/i.test(file));

const homePaths = [];

for (let i = 0; i < certFiles.length; i++) {
  const file = certFiles[i];

  const match = file.match(/^(.+)__(.+)\.(p12|pfx)$/i);

  if (!match) {
    console.log(`Skipping invalid filename: ${file}`);
    continue;
  }

  const password = match[2];

  const id = String(i + 1).padStart(3, "0");

  const homeDir = path.join(HOMES_DIR, id);

  const nssDir = path.join(homeDir, ".local", "share", "pki", "nssdb");

  fs.mkdirSync(nssDir, {
    recursive: true,
  });

  console.log(`Creating HOME ${id}`);

  try {
    // Initialize empty NSS database
    execSync(`certutil -N -d sql:${nssDir} --empty-password`, {
      stdio: "inherit",
    });

    // Import certificate
    execSync(
      `pk12util -i "${path.join(
        CERTS_DIR,
        file,
      )}" -d sql:${nssDir} -W "${password}"`,
      {
        stdio: "inherit",
      },
    );

    // Verify import
    const output = execSync(`certutil -L -d sql:${nssDir}`).toString();

    console.log(output);

    homePaths.push(homeDir);
  } catch (err) {
    console.error(`Failed: ${file}`);
    console.error(err.message);
  }
}

fs.writeFileSync(path.join(HOMES_DIR, "home.txt"), homePaths.join("\n"));

console.log(`Done.`);
console.log(`${homePaths.length} HOME directories created.`);
