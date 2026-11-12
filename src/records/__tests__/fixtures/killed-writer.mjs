import {flowChart,FlowChartExecutor} from 'footprintjs';
import {createObjectRecordSink} from '../../../../dist/records/object-store.js';
import {openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
import {join} from 'node:path';
let acknowledge; const acknowledged=new Promise(resolve=>acknowledge=resolve);
const sink=createObjectRecordSink({storeId:'brand-one',runId:'application-run-1',storage:{
 put:async({key,body})=>{ const file=openSync(join(process.argv[2],key.split('/').pop()),'wx',0o600); try{writeFileSync(file,body);fsyncSync(file);}finally{closeSync(file);} const e=JSON.parse(body).entry;if(e.kind==='note'&&e.note==='attempt'&&e.data.record.target==='dependency.read'&&e.data.record.attempt===1)acknowledge(); },
 get:async()=>undefined,list:async()=>({keys:[]})}});
const quiet=Object.fromEntries(['log','info','warn','error','debug'].map(k=>[k,()=>{}]));
const chart=flowChart('Receive',s=>{s.order='synthetic-order'},'receive').addFunction('Read',async s=>{ await s.$call('dependency.read',async attempt=>{if(attempt.attempt===1)throw Object.assign(new Error('synthetic gateway busy'),{status:503});await acknowledged; process.kill(process.pid,'SIGKILL'); await new Promise(()=>{});},{attempts:3,backoffMs:0});},'read').setLogger(quiet).build();
new FlowChartExecutor(chart,{sink}).run({timeoutMs:5000}).catch(()=>{});
