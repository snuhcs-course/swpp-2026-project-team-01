'use client';
import {useEffect,useState} from 'react';
import {Alert,AlertTitle,AlertDescription} from './ui/alert.tsx';
export function IdentityReturnNotice(){
 const [failed,setFailed]=useState(false);
 useEffect(()=>{if(new URLSearchParams(location.search).has('identity')){setFailed(true);history.replaceState(null,'','/');}},[]);
 return failed?<Alert variant="destructive"><AlertTitle>Google could not restore your request</AlertTitle><AlertDescription>Return to the host’s booking link or your private request link in the browser where you started. You can continue without Google.</AlertDescription></Alert>:null;
}
