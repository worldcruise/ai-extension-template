import fs from 'node:fs';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
const root = process.argv[2];
if (!root) throw new Error("Usage: node scripts/reproduce-v211.mjs /absolute/path/to/extracted-v2.1.1/tech-int-chat");
const {ChatGPTService}=await import(pathToFileURL(root+'/services/ChatGPTService.js'));
const {ClipboardService}=await import(pathToFileURL(root+'/services/ClipboardService.js'));
const results=[];
const calls=[];
globalThis.chrome={tabs:{async query(){calls.push('find-tab');return [];}}};
try {await new ChatGPTService({content:async()=> 'Test transcript'},{}).submit({state:1,data:{selectedIds:['a']},requestId:'repro_request_1'});}
catch(e){results.push({case:'No ChatGPT tab',error:e.message,clipboard_attempts:0,path:calls});}
let listener, response, legacyCalls=0;
const context=vm.createContext({window:{addEventListener(){}},console,
 document:{addEventListener(){},hidden:false,hasFocus:()=>true,execCommand(){legacyCalls++;return true;}},
 navigator:{clipboard:{writeText(){return Promise.reject(Object.assign(new Error('Document is not focused.'),{name:'NotAllowedError'}));}}},
 chrome:{runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener(f){listener=f;}}}}});
vm.runInContext(fs.readFileSync(root+'/popup.js','utf8'),context);
listener({target:'tech-int-chat-panel-clipboard',type:'WRITE_CLIPBOARD_TEXT',text:'Prompt + transcript',requestId:'repro_request_2',expiresAt:Date.now()+4500},
 {id:'test',url:'chrome-extension://test/background.js'},r=>response=r);
await new Promise(r=>setImmediate(r));
results.push({case:'Native API rejects (controlled reproduction)',result:response,focused_local_legacy_attempts:legacyCalls});
const bridgeCalls=[]; let now=1000;
const api={runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,
 getContexts:async()=>{bridgeCalls.push('offscreen-contexts');return [];},
 sendMessage(m,cb){bridgeCalls.push(m.target);now=6000;cb({requestId:m.requestId,ok:false,code:'clipboard_write_denied'});}},
 offscreen:{createDocument:async()=>bridgeCalls.push('offscreen-create'),closeDocument:async()=>{}}};
const result=await new ClipboardService(api,()=>now).copy({text:'Prompt + transcript',requestId:'repro_request_3',expiresAt:5500},
 {id:'test',url:'https://chatgpt.com/',tab:{id:1},frameId:0});
results.push({case:'Panel response consumes shared deadline (controlled reproduction)',result,path:bridgeCalls});
const report={source:'actual v2.1.1 archive',scope:'Static control-flow reproductions with mocked browser boundaries; not proof of the user machine failure',results};
console.log(JSON.stringify(report,null,2));
