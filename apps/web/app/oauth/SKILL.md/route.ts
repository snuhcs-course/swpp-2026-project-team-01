import {publicSkill} from '../../../lib/public-skill.ts';
export const dynamic='force-dynamic';
export function GET(){return publicSkill('oauth');}
