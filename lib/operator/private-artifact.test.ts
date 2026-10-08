import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,chmod,readFile,stat,symlink,mkdir,access,rm,rename,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {privateArtifact} from './private-artifact.ts';
async function fixture(){const root=await mkdtemp(join(await realpath(tmpdir()),'fmat-artifact-'));await chmod(root,0o700);return root;}
test('private artifacts are exclusive 0600 files under a 0700 directory, with incomplete files removed',async()=>{
 const root=await fixture();try{
  const file=join(root,'delivery','invitation.json'),writer=await privateArtifact(file);await writer.write({code:'FIXTURE-CODE'});await writer.close();
  assert.equal((await stat(file)).mode&0o777,0o600);assert.equal((await stat(join(root,'delivery'))).mode&0o777,0o700);assert.equal(JSON.parse(await readFile(file,'utf8')).code,'FIXTURE-CODE');
  await assert.rejects(privateArtifact(file));assert.equal(JSON.parse(await readFile(file,'utf8')).code,'FIXTURE-CODE');
  const incomplete=join(root,'aborted.json'),aborted=await privateArtifact(incomplete);await aborted.close();await assert.rejects(access(incomplete));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('private artifacts reject symlinks, shared directories, relative paths and changed output identity',async()=>{
 const root=await fixture();try{
  await mkdir(join(root,'shared'),{mode:0o755});await mkdir(join(root,'private'),{mode:0o700});await symlink(join(root,'private'),join(root,'alias'));await symlink(join(root,'missing'),join(root,'file-link'));
  for(const file of ['relative.json',join(root,'shared','file.json'),join(root,'alias','file.json'),join(root,'file-link'),join(root,'private','..','shared','file.json'),join(root,'.hidden')])await assert.rejects(privateArtifact(file));
  const replaced=join(root,'replaced.json'),original=await privateArtifact(replaced);await rename(replaced,replaced+'.old');await writeFile(replaced,'unrelated',{mode:0o600});await assert.rejects(original.write({code:'never-written'}));await original.close();assert.equal(await readFile(replaced,'utf8'),'unrelated');
  const file=join(root,'swapped.json'),writer=await privateArtifact(file);await chmod(file,0o644);await assert.rejects(writer.write({code:'never-written'}));await writer.close();await assert.rejects(access(file));
 }finally{await rm(root,{recursive:true,force:true});}
});
