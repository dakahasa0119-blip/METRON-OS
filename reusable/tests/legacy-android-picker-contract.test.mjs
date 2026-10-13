import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

function chrome() {
  const choices=[
    process.env.CHROME_BIN,"/usr/bin/google-chrome","/usr/bin/google-chrome-stable",
    "/usr/bin/chromium","/usr/bin/chromium-browser",
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES,"Google","Chrome","Application","chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && join(process.env["PROGRAMFILES(X86)"],"Microsoft","Edge","Application","msedge.exe")
  ].filter(Boolean);
  return choices.find(existsSync)||"";
}
test("legacy WebView picker selects input/send/response, blocks click and cancels",
  {skip:!chrome()},()=>{
    const dir=mkdtempSync(join(tmpdir(),"arc-picker-contract-"));
    try{
      const script=readFileSync(
        new URL("../../app/src/main/assets/selector_picker.js",import.meta.url),"utf8"
      );
      function assertions(){
        const assert=(condition,message)=>{if(!condition)throw Error(message);};
        const messages=[];
        window.AndroidBridge={onPicked:s=>messages.push(s)};
        const host=document.getElementById("host");
        const shadow=host.attachShadow({mode:"open"});
        shadow.innerHTML='<button id="send-now"><svg id="nested"></svg></button>';
        const button=shadow.getElementById("send-now");
        let siteClicks=0;
        button.addEventListener("click",()=>siteClicks++);
        assert(MetronSelectorPicker.start("send"),"picker start send");
        const icon=shadow.getElementById("nested");
        icon.dispatchEvent(new PointerEvent("pointerdown",{
          bubbles:true,composed:true,cancelable:true
        }));
        icon.dispatchEvent(new MouseEvent("click",{
          bubbles:true,composed:true,cancelable:true
        }));
        assert(messages[0]==="#send-now","send role chose button not nested icon");
        assert(siteClicks===0,"picker intercepted site action");
        assert(!MetronSelectorPicker.active,"picker stops after choice");

        assert(MetronSelectorPicker.start("input"),"picker start input");
        document.getElementById("prompt").click();
        assert(messages[1]==="#prompt","input selector result");

        assert(MetronSelectorPicker.start("resp"),"picker start response");
        document.getElementById("response-inner").click();
        assert(messages[2]==="#response","response ancestor chosen");

        MetronSelectorPicker.start("resp");
        document.dispatchEvent(new KeyboardEvent("keydown",{
          key:"Escape",bubbles:true,cancelable:true
        }));
        assert(messages[3]==="","escape announces cancellation");
        assert(!MetronSelectorPicker.active,"escape stops picker");
        assert(!MetronSelectorPicker.start("unsafe"),"invalid role never arms");
      }
      const html='<!doctype html><html><body><input id="prompt">'+
        '<article id="response"><span id="response-inner">ok</span></article>'+
        '<div id="host"></div><pre id="result">WAIT</pre><script>'+script+
        '\ntry {('+assertions.toString()+')(); '+
        'document.getElementById("result").textContent="PICKER_CONTRACT_PASS"; }'+
        'catch(e){document.getElementById("result").textContent="PICKER_CONTRACT_FAIL:"+e.message;}' +
        '</script></body></html>';
      const file=join(dir,"test.html");writeFileSync(file,html,"utf8");
      const args=["--headless=new","--disable-gpu","--disable-background-networking",
        "--disable-sync","--disable-extensions","--no-first-run",
        "--user-data-dir="+join(dir,"profile"),"--dump-dom",pathToFileURL(file).href];
      if(process.getuid?.()===0)args.unshift("--no-sandbox");
      const out=execFileSync(chrome(),args,{
        encoding:"utf8",timeout:25000,stdio:["ignore","pipe","ignore"]
      });
      assert.match(out,/PICKER_CONTRACT_PASS/,out.match(/PICKER_CONTRACT_FAIL:[^<]*/)?.[0]);
    }finally{rmSync(dir,{recursive:true,force:true});}
});
