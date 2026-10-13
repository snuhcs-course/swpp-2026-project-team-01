'use client';
import {useId,useRef} from 'react';
import {Alert,AlertTitle,AlertDescription} from './ui/alert';
import {Field,FieldGroup,FieldLabel} from './ui/field';
import {Textarea} from './ui/textarea';
import {Button} from './ui/button';

/** Locally typed text can outlive access loss; protected server history cannot.
 * This is never persisted or automatically submitted under another credential. */
export function RetainedConversationDraft({text,onDiscard}:{text:string;onDiscard:()=>void}){
 const id=useId(),input=useRef<HTMLTextAreaElement>(null);
 if(!text)return null;
 return <Alert aria-label="Retained draft"><AlertTitle>Your draft text</AlertTitle>
  <AlertDescription>Access ended. Copy this text before leaving; it is kept only on this page. Check saved messages after regaining access before sending it again.</AlertDescription>
  <FieldGroup><Field><FieldLabel htmlFor={id}>Draft retained on this page</FieldLabel><Textarea id={id} ref={input} value={text} readOnly/></Field></FieldGroup>
  <div className="flex flex-wrap gap-2"><Button variant="outline" className="min-h-11" onClick={()=>{input.current?.focus();input.current?.select();}}>Select draft text</Button><Button variant="ghost" className="min-h-11" onClick={onDiscard}>Discard draft</Button></div>
 </Alert>;
}
