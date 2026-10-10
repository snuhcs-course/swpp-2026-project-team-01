import {applicationOrigin} from '../config.ts';
// Limit private transport payloads without splitting a Unicode code point.
// The complete response remains in the authorized web conversation.
export function formatPhotonReply(text:string,origin=applicationOrigin()){
 const points=Array.from(text.trim());
 return points.length<=4000?points.join(''):points.slice(0,3800).join('')+`\n\nRead the full reply: ${origin}/app`;
}
