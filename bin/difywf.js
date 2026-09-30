#!/usr/bin/env node
// Modified for Dify Workbench 1.11.1 on 2026-09-30; see NOTICE and MODIFICATIONS.md.
// Fixed-upstream dual profile. Legacy 1.11.1 is the safe default.
const args=process.argv.slice(2);
const eq=args.find(x=>x.startsWith('--profile='));
const i=args.indexOf('--profile');
const profile=eq?.slice('--profile='.length)??(i>=0?args[i+1]:process.env.DIFYWF_PROFILE)??'dify-1.11.1';
if(profile==='upstream'){
  const filtered=args.filter((a,n)=>!a.startsWith('--profile=')&&(i<0||(n!==i&&n!==i+1)));
  process.argv=[...process.argv.slice(0,2),...filtered];
  const {main}=await import('../src/cli.ts');await main();
}else if(profile==='dify-1.11.1'){
  const {main111}=await import('../src/legacy/cli.ts');await main111(args);
}else{process.stdout.write(JSON.stringify({ok:false,error:{code:'UNKNOWN_PROFILE',message:'Use dify-1.11.1 or explicit upstream'}})+'\n');process.exitCode=1;}
