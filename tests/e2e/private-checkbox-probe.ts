// Fixed selectors and computed geometry only; no values, text, URLs or arbitrary attributes.
// Plain JavaScript avoids transpiler helpers becoming browser closure dependencies.
export const privateCheckboxProbe = `(()=>{
   const element=document.querySelector('[aria-label="Additional preferences decision"] [role="checkbox"]');
   if(!element)throw new Error('Missing diagnostic checkbox');
   const trace=[];
   const box=(node)=>{if(!node)return null;const rect=node.getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,height:rect.height};};
   const state=()=>{
    const form=element.closest('form'),textarea=form?.querySelector('textarea'),viewport=element.closest('[data-slot="message-scroller-viewport"]');
    const ancestors=[];let node=element.parentElement;
    for(let depth=0;node&&depth<12;depth++,node=node.parentElement){const style=getComputedStyle(node);ancestors.push({depth,rect:box(node),scrollTop:node.scrollTop,scrollHeight:node.scrollHeight,clientHeight:node.clientHeight,containerType:style.containerType,contentVisibility:style.contentVisibility});}
    return {checked:element.getAttribute('aria-checked'),disabled:element.matches(':disabled'),connected:element.isConnected,rect:box(element),textarea:box(textarea),fieldSizing:textarea?getComputedStyle(textarea).getPropertyValue('field-sizing'):null,viewport:box(viewport),viewportScrollTop:viewport?.scrollTop??null,pageScrollY:scrollY,ancestors,at:performance.now()};
   };
   const listen=(event)=>{if(trace.length>=100)return;const target=event.target;trace.push({event:event.type,target:target.tagName,role:target.getAttribute?.('role')??null,same:target===element,...(event instanceof MouseEvent?{x:event.clientX,y:event.clientY}:{}),...state()});};
   const names=['pointerdown','pointerup','click','focus','blur'];for(const name of names)document.addEventListener(name,listen,true);
   const observer=new MutationObserver(()=>{if(trace.length<100)trace.push({event:'mutation',...state()});});observer.observe(element,{attributes:true});
   window.privateCheckboxDiagnostic={trace,state,stop:()=>{observer.disconnect();for(const name of names)document.removeEventListener(name,listen,true);}};
  })()`;
