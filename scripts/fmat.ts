import {runCli} from '../lib/cli/command.ts';
const controller=new AbortController();
const stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
try{process.exitCode=await runCli(process.argv.slice(2),{stdin:process.stdin,stdout:text=>process.stdout.write(text),stderr:text=>process.stderr.write(text),signal:controller.signal});}
finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);process.stdin.destroy();}
