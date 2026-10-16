/** Fixed local source fingerprint for reproducible single-village startup. */
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
const files=[
  "./village-version.mjs","./village-bootstrap.mjs","./village-child.mjs","./runtime.mjs",
  "../reusable/gateway-jobs/checkpoint.mjs","../reusable/gateway-jobs/job-state.mjs",
  "../reusable/gateway-jobs/persistent-gateway.mjs","../reusable/mothership/mailbox.mjs",
  "../reusable/mothership/workflow.mjs","../reusable/baku-dna/code-cards.mjs"
];
export function villageSourceVersion(){
  const hashes=files.map(path=>[path,createHash("sha256").update(readFileSync(new URL(path,import.meta.url))).digest("hex")]);
  return "mini-village-v1:"+createHash("sha256").update(JSON.stringify(hashes)).digest("hex");
}
