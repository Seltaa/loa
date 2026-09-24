import { readFileSync } from 'node:fs';
import ts from 'typescript';
import assert from 'node:assert/strict';
async function load(path){ const {outputText}=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}); return import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64')); }
const values=new Map();globalThis.localStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};globalThis.window={dispatchEvent(){}};
const store=await load('../src/notebookStore.ts');
store.recordMemory('An event','Context, stated feelings, and significance.');
assert.equal(store.readNotebook().entries.length,1);
store.recordMemory('An event','Context, stated feelings, and significance.');assert.equal(store.readNotebook().entries.length,1);
store.recordJournal('We made something together.');assert.equal(store.readNotebook().entries[0].kind,'journal');
assert.throws(()=>store.validate({version:1,entries:[{text:'bad'}]}));
store.saveNotebook({version:1,entries:[]});assert.equal(store.readNotebook().entries.length,0);
class Socket { static OPEN=1;readyState=1;close(){this.onclose?.({code:1000,reason:''})}send(){} }
globalThis.WebSocket=Socket;
const {GeminiLiveClient}=await load('../src/geminiLiveClient.ts');let closed=0;const order=[];
const client=new GeminiLiveClient({apiKey:'test-not-a-key',voiceName:'Puck',systemInstruction:'test',onClose:()=>closed++,onOutputText:()=>order.push('text'),onMessage:()=>order.push('event')});
client.connect();const socket=client.websocket;await socket.onmessage({data:JSON.stringify({serverContent:{outputTranscription:{text:'last chunk'},turnComplete:true}})});assert.deepEqual(order,['text','event']);client.disconnect();assert.equal(closed,0);assert.equal(socket.onmessage,null);
console.log('PASS: notebook persistence, deduplication, journal, validation, deletion, response ordering, intentional disconnect isolation.');

const appSource=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const parserSource=appSource.slice(appSource.indexOf('function extractMemoryProposalFromText'),appSource.indexOf('function extractLoaCommandsFromText'));
const parserJs=ts.transpileModule(parserSource,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const parseMemory=new Function('createMemoryProposal','normalizeMemoryCategory',parserJs+';return extractMemoryProposalFromText;')((category,title,text)=>({category,title,text}),x=>x);
for(const opening of ['[LOA_MEMORY_PROPOSAL]','LOA_MEMORY_PROPOSAL]']){
 const result=parseMemory('Okay. '+opening+JSON.stringify({category:'preference',title:'Casual Korean speech',text:'Use casual Korean.'})+'[/LOA_MEMORY_PROPOSAL]');
 assert.equal(result.visibleText,'Okay.');assert.equal(result.proposal.text,'Use casual Korean.');
}
const partial=parseMemory('Okay. LOA_MEMORY_PROPOSAL]{"text":');
assert.equal(partial.visibleText,'Okay.');assert.equal(partial.proposal,null);
console.log('PASS: exact and missing-bracket memory tags, hidden partial payload.');

store.saveNotebook({version:1,entries:[]});
const update={id:'',title:'Casual speech',event:'The user asked for casual Korean.',reason:'',feeling:'',followUp:'Use casual Korean.',sourceQuotes:['Please use casual Korean']};
assert.equal(store.applyMemoryUpdates([update],JSON.stringify(store.readNotebook()),'you: Please use casual Korean'),true);
let saved=store.readNotebook().entries[0];
assert.equal(saved.feeling,'');assert.equal(saved.followUp,'Use casual Korean.');
const id=saved.id;
store.applyMemoryUpdates([{...update,id,reason:'A stated preference.'}],JSON.stringify(store.readNotebook()),'Please use casual Korean');
assert.equal(store.readNotebook().entries.length,1);assert.equal(store.readNotebook().entries[0].id,id);
const stale=JSON.stringify(store.readNotebook());store.saveNotebook({version:1,entries:[]});
assert.equal(store.applyMemoryUpdates([update],stale,'Please use casual Korean'),false);
assert.throws(()=>store.applyMemoryUpdates([{...update,sourceQuotes:['invented evidence']}],JSON.stringify(store.readNotebook()),'Please use casual Korean'));
assert.equal(store.readNotebook().entries.length,0);
console.log('PASS: structured memory creation, update, empty feelings, stale deletion protection, source evidence validation.');

const lifecycle=[];
const resumableClient=new GeminiLiveClient({apiKey:'fixture',voiceName:'Leda',systemInstruction:'fixture',resumptionHandle:'test-resume',onMessage:m=>lifecycle.push(m)});
resumableClient.connect();const resumeSocket=resumableClient.websocket;
let setup;resumeSocket.send=raw=>{setup=JSON.parse(raw)};resumeSocket.onopen();
assert.equal(setup.setup.sessionResumption.handle,'test-resume');
assert.deepEqual(setup.setup.contextWindowCompression,{slidingWindow:{}});
await resumeSocket.onmessage({data:JSON.stringify({sessionResumptionUpdate:{resumable:true,newHandle:'next-handle'}})});
await resumeSocket.onmessage({data:JSON.stringify({goAway:{timeLeft:'30s'}})});
assert.equal(lifecycle[0].sessionResumptionUpdate.newHandle,'next-handle');
assert.equal(lifecycle[1].goAway.timeLeft,'30s');
resumableClient.disconnect();
console.log('PASS: session resumption setup, compression, resumption update and GoAway event delivery.');

window.atob=globalThis.atob; const {PcmAudioPlayer}=await load('../src/audioPlayback.ts');
let releaseResume;let starts=0,stops=0;
globalThis.AudioContext=class{
 state='suspended';currentTime=0;destination={};
 createAnalyser(){return {connect(){},fftSize:0};}
 resume(){return new Promise(resolve=>{releaseResume=()=>{this.state='running';resolve();};});}
 createBuffer(){return {copyToChannel(){},duration:.1};}
 createBufferSource(){return {connect(){},disconnect(){},start(){starts++;},stop(){stops++;}};}
};
const player=new PcmAudioPlayer();
const pending=player.playBase64Pcm24k('AAA=');player.stop();releaseResume();await pending;
assert.equal(starts,0,'stopped pending audio must not start after resume');
await player.playBase64Pcm24k('AAA=');assert.equal(starts,1);player.stop();assert.equal(stops,1);
console.log('PASS: stop cancels pending audio resume and active playback.');

