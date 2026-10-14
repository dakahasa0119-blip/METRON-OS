#!/usr/bin/env node
/**
 * Start METRON Mini OS from the repository root or any working directory.
 * Default local data directory: <repository>/.metron-mini-data (gitignored).
 */
import { fileURLToPath } from "node:url";
import { join,resolve,dirname } from "node:path";
import { createMiniServer } from "./server.mjs";
const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const root=process.env.METRON_MINI_DATA||join(projectRoot,".metron-mini-data");
const portRaw=process.env.METRON_MINI_PORT||"8766";
const port=Number(portRaw);
const mini=await createMiniServer({root,port});
console.log("METRON_MINI_RUNNING "+mini.url);
console.log("Data location: "+resolve(root));
console.log("Local only. Stop with Ctrl+C. Original GAS and AI providers are not contacted.");
for(const signal of ["SIGINT","SIGTERM"]){
  process.once(signal,()=>mini.close().then(()=>process.exit(0)));
}
