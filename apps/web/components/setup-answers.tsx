'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {draftAnswers,chooseDraftAnswers,type DraftAnswer} from '../../../lib/contracts/setup-answers.ts';
import type {SetupState,SetupPatch} from '../../../lib/contracts/setup.ts';
import {Button} from './ui/button';
import {Checkbox} from './ui/checkbox';
import {Field,FieldDescription,FieldLabel,FieldLegend,FieldSet} from './ui/field';

export function SetupAnswers({state,disabled,onUse,onEdit}:{state:SetupState;disabled:boolean;onUse:(patch:SetupPatch)=>void;onEdit:(step:DraftAnswer['key'])=>void}){
 const id=useId(),answers=draftAnswers(state),[selected,setSelected]=useState<DraftAnswer['key'][]>([]);
 const heading=useRef<HTMLLegendElement>(null);useEffect(()=>{heading.current?.focus();},[]);
 const patch=chooseDraftAnswers(answers,selected);
 return <FieldSet disabled={disabled} aria-label="Review draft answers"><FieldLegend ref={heading} tabIndex={-1}>Review your draft answers</FieldLegend>
  <FieldDescription>The assistant has put these values in your draft. Choose the answers that reflect your preferences, or edit them. Nothing is selected for you, and your saved settings stay unchanged.</FieldDescription>
  {answers.map(answer=><div key={answer.key} className="flex min-w-0 flex-col gap-2"><Field orientation="horizontal"><Checkbox id={id+answer.key} checked={selected.includes(answer.key)} onCheckedChange={checked=>setSelected(previous=>checked?[...previous,answer.key]:previous.filter(key=>key!==answer.key))}/><FieldLabel className="break-words" htmlFor={id+answer.key}>I choose: {answer.label}</FieldLabel></Field><Button type="button" variant="ghost" className="self-start" onClick={()=>onEdit(answer.key)}>Edit {({mode:'meeting mode',location:'places',transport:'transportation',travel_buffer:'extra travel buffer'})[answer.key]}</Button></div>)}
  {answers.some(a=>a.key==='mode')?<FieldDescription>Choose the meeting mode before using any physical preferences.</FieldDescription>:null}
  <Button className="h-auto min-h-11 whitespace-normal" disabled={!patch||disabled} onClick={()=>{if(patch)onUse(patch);}}>Use my selected answers</Button>
  <FieldDescription>You will review all exact settings before saving. Physical scheduling still checks both travel legs; unavailable routes require clarification or a confirmed manual allowance.</FieldDescription>
 </FieldSet>;
}
