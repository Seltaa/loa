import { useEffect, useRef, useState } from "react";
import { GeminiLiveClient } from "./geminiLiveClient";

export function ConnectionTest({apiKey,voice}:{apiKey:string;voice:string}) {
  const [state,setState]=useState({busy:false,text:"",ok:false});
  const cancel=useRef<()=>void>(()=>{});
  const generation=useRef(0);
  useEffect(()=>{
    generation.current++;
    cancel.current();
    setState({busy:false,text:"",ok:false});
    return ()=>{generation.current++;cancel.current();};
  },[apiKey,voice]);

  function test() {
    cancel.current();
    const run=++generation.current;
    const key=apiKey.trim();
    if(!key) {setState({busy:false,text:"Enter your Gemini API key first.",ok:false});return;}
    setState({busy:true,text:"Checking Gemini Live…",ok:false});
    let done=false;
    let timer:ReturnType<typeof setTimeout>;
    const clean=(message:string)=>message.split(key).join("[redacted]").split(encodeURIComponent(key)).join("[redacted]").slice(0,400);
    const finish=(ok:boolean,text:string)=>{
      if(done)return;
      done=true;clearTimeout(timer);client.disconnect();
      if(generation.current===run)setState({busy:false,ok,text:clean(text)});
    };
    const client=new GeminiLiveClient({
      apiKey:key,voiceName:voice,systemInstruction:"Connection test only.",
      onSetupComplete:()=>finish(true,"Connected. Gemini Live accepted your key, model and selected voice."),
      onError:()=>finish(false,"Connection failed. Check your key, network, and Gemini API access, then retry."),
      onClose:(code,reason)=>finish(false,"Connection failed ("+code+"). "+(reason || "Check your key, network, and Gemini API access.")),
    });
    cancel.current=()=>{done=true;clearTimeout(timer);client.disconnect();};
    timer=setTimeout(()=>finish(false,"Connection timed out after 15 seconds. Check your network and retry."),15000);
    try {client.connect();} catch {finish(false,"Could not open Gemini Live. Check your network and retry.");}
  }
  return <div className="connectionTest">
    <div className="connectionTestRow">
      {!state.ok && <button type="button" className="connectionTestButton" disabled={state.busy || !apiKey.trim()} onClick={test} title="Check Live access without sending your microphone audio or conversations">{state.busy?"Testing…":"Test connection"}<span aria-hidden="true">↗</span></button>}
      <span role="status" className={"connectionBadge"+(state.ok?" isVerified":"")}>{state.busy?"Connecting…":state.ok?"✓ Connected":state.text?"Could not connect":""}</span>
    </div>
    {!!state.text && !state.ok && !state.busy && <p className="connectionError">{state.text}</p>}
  </div>;
}
