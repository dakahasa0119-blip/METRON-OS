#!/usr/bin/env node
/**
 * Start METRON Mini OS from the repository root or any working directory.
 * Default local data directory: <repository>/.metron-mini-data (gitignored).
 */
import { fileURLToPath } from "node:url";
import { join,resolve,dirname,isAbsolute } from "node:path";
import { createMiniServer } from "./server.mjs";
import {loadProjectStartup} from "./project-config.mjs";
import {loadProjectSetupStartup} from "./project-setup-config.mjs";
import {randomBytes} from "node:crypto";
import {villageSourceVersion} from "./village-version.mjs";
const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),"..");
export async function startMini({env=process.env,log=console.log}={}){
  const root=env.METRON_MINI_DATA||join(projectRoot,".metron-mini-data"),port=Number(env.METRON_MINI_PORT||"8766");
  const {setupSlots}=loadProjectSetupStartup(env);
  const projects=loadProjectStartup(env,{allowSetupSlots:setupSlots.length>0});
  const villageEnabled=env.METRON_VILLAGE_BOOTSTRAP!=="0";
  if(villageEnabled&&env.METRON_VILLAGE_BASE&&!isAbsolute(env.METRON_VILLAGE_BASE))
    throw Object.assign(new Error("absolute village base required"),{code:"village_bootstrap_absolute_base_required"});
  const projectOperatorToken=projects.projectOperatorToken||(villageEnabled?randomBytes(32).toString("hex"):null);
  const mini=await createMiniServer({root,port,workOptions:{projectPlans:projects.projectPlans},
    projectOperatorToken,projectCodexOptions:projects.projectCodexOptions,projectSetupSlots:setupSlots,
    villageBootstrapOptions:villageEnabled?{baseRoot:resolve(env.METRON_VILLAGE_BASE||join(root,"created-villages")),
      sourceVersion:villageSourceVersion()}:null});
  log("METRON_MINI_RUNNING "+mini.url);
  log("Data location: "+resolve(root));
  log("Local server only. Stop with Ctrl+C. Startup does not contact original GAS or AI providers.");
  if(projectOperatorToken){
    log("Mini owner page (local capability; do not share): "+mini.url+"/experience#project-operator="+projectOperatorToken);
    log("Village creation, local child launch and project preparation require separate owner actions. Reading or restarting starts none of them.");
    log("Project workers run only after an explicit per-attempt confirmation on that page.");
  }
  return mini;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const mini=await startMini();
    for(const signal of ["SIGINT","SIGTERM"])
      process.once(signal,()=>mini.close().then(()=>process.exit(0)));
  }catch(error){
    const code=/^[a-z][a-z0-9_]{1,119}$/.test(error?.code||"")?error.code:"project_startup_configuration_failed";
    console.error("METRON_PROJECT_SETUP_FAILED "+code);
    console.error("Check the absolute METRON_PROJECT_REGISTRY path, owner registration JSON, pinned checkouts/tests and optional METRON_CODEX_EXECUTABLE. See docs/METRON_MINI_PROJECT_USER_FLOW_2026-10-15.md. No worker was started.");
    console.error("For prepared slots check METRON_PROJECT_SETUP_MANIFEST. New-village storage uses the dedicated METRON_VILLAGE_BASE or the data root's created-villages folder; no child is started by startup.");
    process.exitCode=1;
  }
}
