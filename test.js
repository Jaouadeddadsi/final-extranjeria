import puppeteer from "puppeteer";

async function main() {
  const browser = await puppeteer.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--ozone-platform=x11"],
  });
  const page = await browser.newPage();

  await page.goto("https://www.google.com", {
    waitUntil: "networkidle2",
  });

  console.log("Browser started.");

  // Keep browser open until Ctrl+C
  // await new Promise(() => {});
  browser.disconnect();
  console.log("done done");
}

main().catch(console.error);
