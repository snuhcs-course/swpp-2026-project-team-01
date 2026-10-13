import type {ReactNode} from 'react';
import {Card,CardHeader,CardTitle,CardContent} from './ui/card';

// Interactive conversation parts remain outside assistant prose bubbles.
export function ChatAction({title,children}:{title:string;children:ReactNode}){
 return <Card size="sm" data-slot="chat-action" className="min-w-0 w-full"><CardHeader className="sr-only"><CardTitle>{title}</CardTitle></CardHeader><CardContent className="flex min-w-0 flex-col gap-3">{children}</CardContent></Card>;
}
