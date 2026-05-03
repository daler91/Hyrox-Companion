import { performance } from 'node:perf_hooks';

type Entry={date:string;id:string;type:'planned'|'logged'};

function randomDate(start:string, spanDays:number, seed:number){
  const base=new Date(start+'T00:00:00Z').getTime();
  const n=(seed*9301+49297)%233280;
  const day=Math.floor((n/233280)*spanDays);
  return new Date(base+day*86400000).toISOString().slice(0,10);
}

function buildDataset(plannedCount:number, loggedCount:number){
  const scheduled:Array<Entry>=[]; const standalone:Array<Entry>=[];
  for(let i=0;i<plannedCount;i++) scheduled.push({id:`p-${i}`,date:randomDate('2024-01-01',900,i+17),type:'planned'});
  for(let i=0;i<loggedCount;i++) standalone.push({id:`l-${i}`,date:randomDate('2024-01-01',900,i+71),type:'logged'});
  return {scheduled, standalone};
}

function materializeAndSliceLegacy(scheduled:Entry[], standalone:Entry[], limit:number, offset:number){
  const entries=[...scheduled,...standalone];
  entries.sort((a,b)=> b.date.localeCompare(a.date));
  return entries.slice(offset, offset+limit);
}

function materializeAndSliceCurrent(scheduled:Entry[], standalone:Entry[], limit:number, offset:number){
  const entries=[...scheduled,...standalone];
  entries.sort((a,b)=> b.date.localeCompare(a.date));
  if (limit === undefined as unknown as number) return entries;
  return entries.slice(offset, offset+limit);
}

function runCase(name:string, planned:number, logged:number, limit:number, offset:number){
  const mem0=process.memoryUsage().heapUsed;
  const t0=performance.now();
  const data=buildDataset(planned, logged);
  const legacy=materializeAndSliceLegacy(data.scheduled,data.standalone,limit,offset);
  const out=materializeAndSliceCurrent(data.scheduled,data.standalone,limit,offset);
  const parity=JSON.stringify(legacy)===JSON.stringify(out);
  const t1=performance.now();
  const mem1=process.memoryUsage().heapUsed;
  return {name, planned, logged, returned:out.length, parity, ms: +(t1-t0).toFixed(2), heapMb:+((mem1-mem0)/1024/1024).toFixed(2)};
}

const cases=[
  runCase('medium', 10000, 10000, 50, 0),
  runCase('high', 50000, 50000, 50, 0),
  runCase('high-offset', 50000, 50000, 50, 5000),
];

console.table(cases);
