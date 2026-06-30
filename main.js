import fs from "fs";
import pLimit from "p-limit";
import {
  fetchData,
  deleteFolderRecursive,
  readFileLines,
  getAppointment,
} from "./help.js";

// Max concurant worker
const maxConcurrant = 8;

async function main() {
  // clear profiles
  await deleteFolderRecursive("./profiles");
  fs.mkdirSync("profiles");
  const limit = pLimit(maxConcurrant); // max concurrent executions
  // read proxies
  const proxies = await readFileLines("./proxies/proxies.txt");
  let datos = await fetchData();
  if (datos.length === 0) {
    console.log("No Pending data to search, plz add data to the app");
    return "Done";
  }
  // ################ Searching process ######
  const results = await Promise.all(
    datos.map((data, index) =>
      limit(() => getAppointment(data, proxies[index])),
    ),
  );
  return results;
}

main()
  .then((result) => {
    console.log(result);
  })
  .catch((error) => {
    console.log(error);
  });
