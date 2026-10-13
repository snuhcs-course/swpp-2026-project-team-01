import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire,builtinModules} from 'node:module';

// Reuse the TypeScript/JSX parser bundled with our pinned Next.js version.
const require=createRequire(import.meta.url);
const {parse}=require('next/dist/compiled/babel/bundle').parser();
const builtins=new Set(builtinModules.map(name=>name.replace(/^node:/u,'')));
const extensions=['.ts','.tsx','.js','.jsx','.mjs'];
const code=file=>extensions.some(ext=>file.endsWith(ext));
const source=file=>code(file)&&!/\.(?:test|d)\.[cm]?[jt]sx?$/u.test(file);
function files(dir){
 if(!fs.existsSync(dir))return [];
 return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
  if(entry.name.startsWith('.')||entry.name==='node_modules')return [];
  const file=path.join(dir,entry.name);return entry.isDirectory()?files(file):source(file)?[file]:[];
 });
}
export function checkClientBoundaries(directory){
 const root=fs.realpathSync(directory),cache=new Map(),violations=[],seen=new Set();
 const relative=file=>path.relative(root,file).split(path.sep).join('/');
 function ast(file){
  if(!cache.has(file))cache.set(file,parse(fs.readFileSync(file,'utf8'),{sourceType:'module',plugins:['typescript','jsx']}));
  return cache.get(file);
 }
 const candidates=[...files(path.join(root,'apps/web')),...files(path.join(root,'lib/contracts'))];
 const entries=candidates.filter(file=>relative(file).startsWith('lib/contracts/')||ast(file).program.directives.some(d=>d.value.value==='use client'));
 const fail=(chain,reason)=>violations.push({chain:chain.map(relative),reason});
 function visit(file,chain){
  if(seen.has(file))return;seen.add(file);
  const name=relative(file);
  if(name.startsWith('lib/server/')||name.startsWith('agent/')||/\.server\.[cm]?[jt]sx?$/u.test(name)){fail(chain,'server module is reachable from browser-safe code');return;}
  function edge(specifier){
   if(typeof specifier!=='string'){fail(chain,'dynamic module target cannot be checked');return;}
   if(specifier==='server-only'||specifier.startsWith('node:')||builtins.has(specifier)){fail(chain,'server-only dependency: '+specifier);return;}
   if(!specifier.startsWith('.')&&!specifier.startsWith('@web/'))return; // External package behavior remains a build/dependency concern.
   const base=specifier.startsWith('@web/')?path.join(root,'apps/web',specifier.slice(5)):path.resolve(path.dirname(file),specifier);
   const options=[base,...extensions.map(ext=>base+ext),...extensions.map(ext=>path.join(base,'index'+ext))];
   const resolved=options.find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());
   if(!resolved){fail(chain,'unresolved local import: '+specifier);return;}
   const real=fs.realpathSync(resolved);
   if(!real.startsWith(root+path.sep)){fail(chain,'local import escapes repository');return;}
   if(code(real))visit(real,[...chain,real]);
  }
  function walk(node,parent){
   if(!node||typeof node!=='object')return;
   if(node.type==='ImportDeclaration'){
    if(node.importKind!=='type'&&(!node.specifiers.length||node.specifiers.some(s=>s.importKind!=='type')))edge(node.source.value);
    return;
   }
   if((node.type==='ExportNamedDeclaration'||node.type==='ExportAllDeclaration')&&node.source){
    if(node.exportKind!=='type'&&(!node.specifiers?.length||node.specifiers.some(s=>s.exportKind!=='type')))edge(node.source.value);
    return;
   }
   if(node.type==='ImportExpression')edge(node.source.value);
   if(node.type==='CallExpression'&&(node.callee.type==='Import'||node.callee.type==='Identifier'&&node.callee.name==='require'))edge(node.arguments[0]?.value);
   const member=node.type==='MemberExpression'||node.type==='OptionalMemberExpression';
   const property=n=>n.computed?n.property.value:n.property.name;
   if(member&&node.object?.type==='Identifier'&&node.object.name==='process'&&property(node)==='env'){
    const outer=parent&&(parent.type==='MemberExpression'||parent.type==='OptionalMemberExpression')&&parent.object===node;
    const key=outer?property(parent):undefined;
    if(typeof key!=='string'||key!=='NODE_ENV'&&!key.startsWith('NEXT_PUBLIC_'))fail(chain,'private or computed process.env access');
   }
   for(const [key,value]of Object.entries(node)){
    if(['loc','start','end','comments','tokens'].includes(key))continue;
    if(Array.isArray(value))for(const child of value)walk(child,node);
    else if(value&&typeof value==='object')walk(value,node);
   }
  }
  walk(ast(file).program,null);
 }
 for(const entry of entries)visit(entry,[entry]);
 return {entries:entries.length,modules:seen.size,violations};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=checkClientBoundaries(process.cwd());
 for(const violation of result.violations)console.error(violation.chain.join(' -> ')+': '+violation.reason);
 if(result.violations.length)process.exitCode=1;
 else console.log(`Checked ${result.entries} browser/contract roots and ${result.modules} reachable source modules.`);
}
