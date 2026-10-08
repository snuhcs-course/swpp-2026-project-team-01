import {publicSkill} from '../../../lib/public-skill.ts';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(_request:Request,{params}:{params:Promise<{handle:string}>}){return publicSkill((await params).handle);}
