/**
 * Optional Claude Code CLI login adapter: no raw API key required by Mini.
 *
 * This invokes an operator-authenticated external AI CLI, not a fabricated
 * model output. Claude receives the visible fixture prompt and returns
 * one JSON result. Built-in and MCP tools are both disabled, so hidden tests
 * cannot be read using those tools and no model-operated shell commands run.
 */
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

const run=promisify(execFile);
const blocked=code=>Object.assign(new Error(code),{code});
function safeEnvironment(env){
  const keys=["PATH","Path","SystemRoot","HOME","USERPROFILE","APPDATA",
    "LOCALAPPDATA","TMP","TEMP","XDG_CONFIG_HOME","XDG_DATA_HOME",
    "XDG_CACHE_HOME","PROGRAMDATA","ProgramFiles","ProgramFiles(x86)"];
  const result={};
  for(const name of keys)if(typeof env[name]==="string")result[name]=env[name];
  // Do not pass ANTHROPIC_API_KEY or other application secrets.
  result.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1";
  return result;
}
/** Tests inject an executor stub; live uses a signed-in Claude Code CLI. */
export async function claudeCliReasoner(prompt,{
  executor=run,env=process.env,timeoutMs=90000
}={}){
  if(typeof prompt!=="string"||!prompt.trim()||prompt.length>12500)
    throw blocked("invalid_claude_prompt");
  if(typeof timeoutMs!=="number"||timeoutMs<100||timeoutMs>120000)
    throw blocked("invalid_claude_timeout");
  const scratch=mkdtempSync(join(tmpdir(),"metron-claude-prompt-"));
  try{
    const args=[
      "-p",prompt,
      "--output-format","json",
      "--max-turns","1",
      "--tools","",
      "--disallowedTools","mcp__*",
      "--permission-mode","plan",
      "--no-session-persistence"
    ];
    let output;
    try{
      const result=await executor("claude",args,{
        cwd:scratch,env:safeEnvironment(env),windowsHide:true,
        timeout:timeoutMs,maxBuffer:32000
      });
      output=result?.stdout;
    }catch{
      throw blocked("claude_cli_not_authenticated_or_unavailable");
    }
    if(typeof output!=="string"||output.length>32000)
      throw blocked("claude_cli_invalid_output");
    let packet;
    try{packet=JSON.parse(output);}catch{throw blocked("claude_cli_invalid_json");}
    if(packet?.is_error===true||typeof packet?.result!=="string"||
       !packet.result.trim()||packet.result.length>12000)
      throw blocked("claude_cli_no_usable_model_response");
    // Caller validates patch paths and runs tests in separate processes.
    return packet.result;
  }finally{
    rmSync(scratch,{recursive:true,force:true});
  }
}
