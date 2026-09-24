import { useEffect, useState } from "react";
export type SavedImage = { id: string; name: string };
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("loa-chat-images", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("images");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function saveChatImages(images: {id:string;name:string;mimeType:string;base64Data?:string}[]): Promise<SavedImage[]> {
  if (!images.length) return [];
  const blobs = images.map(image => {
    const bytes = Uint8Array.from(atob(image.base64Data || ""), c => c.charCodeAt(0));
    return new Blob([bytes], {type:image.mimeType});
  });
  const db = await database();
  try {
    await new Promise<void>((resolve,reject) => {
      const tx=db.transaction("images","readwrite");
      images.forEach((image,i)=>tx.objectStore("images").put(blobs[i],image.id));
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error || Error("Image storage was interrupted."));
    });
    return images.map(({id,name})=>({id,name}));
  } finally { db.close(); }
}
async function readImage(id:string):Promise<Blob|undefined> {
  const db=await database();
  try { return await new Promise((resolve,reject)=>{
    const request=db.transaction("images").objectStore("images").get(id);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  }); } finally { db.close(); }
}
export function SavedChatImage({image,index}:{image:SavedImage;index:number}) {
  const [url,setUrl]=useState("");

  const [failed,setFailed]=useState(false);
  useEffect(()=>{
    let active=true; let objectUrl="";
    readImage(image.id).then(value=>{
      if (!active) return;
      if (!value) {setFailed(true);return;}
      objectUrl=URL.createObjectURL(value);setUrl(objectUrl);
    }).catch(()=>{if(active)setFailed(true);});
    return ()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[image.id]);
  return <figure className="savedChatImage">
    {url && <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={"Image "+(index+1)+": "+image.name}/></a>}
    <figcaption>Image {index+1}{failed ? " · Stored image unavailable" : ""}</figcaption>

  </figure>;
}
