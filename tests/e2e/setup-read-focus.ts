import type {Locator} from '@playwright/test';

export async function setupReadFocusState(reload:Locator){
 return reload.evaluate(element=>{
  // Keep this browser callback self-contained: tsx's named-function helper is
  // not available when Playwright serializes a nested function into the page.
  const button=element.getBoundingClientRect();
  const viewport=element.closest('[data-slot=message-scroller-viewport]');
  const bounds=viewport?.getBoundingClientRect();
  return {
   focused:document.activeElement===element,
   button:{x:button.x,y:button.y,width:button.width,height:button.height},
   viewport:bounds?{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height}:null,
   scrollTop:viewport?.scrollTop,scrollHeight:viewport?.scrollHeight,
   window:{width:innerWidth,height:innerHeight,scrollY},
   pending:viewport?.hasAttribute('data-pending-scroll'),
  };
 });
}
