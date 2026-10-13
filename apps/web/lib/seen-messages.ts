const prefix='fmat:seen-prose:';
// Only fingerprints are retained, never message text or Calendar evidence.
export function hasSeenMessage(storage:Pick<Storage,'getItem'>,scope:string,fingerprint:string){
 try{const values=JSON.parse(storage.getItem(prefix+scope)??'[]');return Array.isArray(values)&&values.includes(fingerprint);}catch{return false;}
}
export function rememberMessage(storage:Pick<Storage,'getItem'|'setItem'>,scope:string,fingerprint:string){
 try{const parsed=JSON.parse(storage.getItem(prefix+scope)??'[]'),values=Array.isArray(parsed)?parsed.filter(v=>typeof v==='string'):[];storage.setItem(prefix+scope,JSON.stringify([...values.filter(v=>v!==fingerprint),fingerprint].slice(-128)));}catch{/* Storage restrictions must not block onboarding. */}
}
