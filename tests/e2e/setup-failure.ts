import {writeFile} from 'node:fs/promises';
import type {Page} from '@playwright/test';

// Fixed selectors and computed state only: never collect field values, URLs,
// arbitrary attributes, page text, cookies or provider responses.
export async function setupFailureState(page:Page){
 return page.evaluate(()=>{
  const selectors={setup:'[aria-label="Your meeting setup"]',imessage:'[aria-label="Connect iMessage"]',phone:'[aria-label="Connect iMessage"] input[type="tel"]',code:'[aria-label="Connect iMessage"] [data-input-otp]',form:'[aria-label="Connect iMessage"] form',viewport:'[data-slot="message-scroller-viewport"]'};
  return Object.fromEntries(Object.entries(selectors).map(([name,selector])=>{
   const elements=Array.from(document.querySelectorAll(selector)).slice(0,4);
   return [name,elements.map(element=>{
    const ancestors=[];let current:Element|null=element;
    for(let depth=0;current&&depth<20;depth++,current=current.parentElement){
     const style=getComputedStyle(current),box=current.getBoundingClientRect();
     ancestors.push({depth,display:style.display,visibility:style.visibility,contentVisibility:style.contentVisibility,opacity:style.opacity,width:box.width,height:box.height,hidden:current.hasAttribute('hidden'),inert:current.hasAttribute('inert'),pendingScroll:current.hasAttribute('data-pending-scroll')});
    }
    return {focused:document.activeElement===element,disabled:element.matches(':disabled'),connected:element.isConnected,ancestors};
   })];
  }));
 });
}

export async function captureSetupFailure(page:Page,flow:string){
 const state=await setupFailureState(page);
 await writeFile('.local/rebuild/setup-failure.json',JSON.stringify({flow,state},null,2));
 await page.screenshot({path:'.local/rebuild/browser-screenshots/setup-failure.png',fullPage:true,mask:[page.locator('input,textarea')],timeout:3000});
}
