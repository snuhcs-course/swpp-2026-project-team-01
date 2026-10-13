'use client';
import type {ComponentProps,ReactNode} from 'react';
import {Message,MessageContent,MessageResponse} from './ai-elements/message';

// Scheduling prose supports Markdown, but never loads model-supplied remote images.
const responseComponents={img:({alt}:{alt?:string})=><span>{alt||'Image'}</span>};
export function ChatMessage({from='assistant',label,children,text,continuation=false,streaming=false,...props}:Omit<ComponentProps<typeof Message>,'from'>&{from?:'user'|'assistant';label?:string;continuation?:boolean;streaming?:boolean;children?:ReactNode;text?:string}){
 return <Message from={from} {...props}>
  {!continuation?<div className="chat-speaker"><span>{label??(from==='user'?'You':'Thyme')}</span></div>:null}
  <MessageContent>{text!==undefined?(from==='assistant'?<MessageResponse isAnimating={streaming} className="chat-response" components={responseComponents}>{text}</MessageResponse>:<span className="chat-text">{text}</span>):children}</MessageContent>
 </Message>;
}
