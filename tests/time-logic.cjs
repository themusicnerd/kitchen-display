const assert=require('node:assert/strict');
const T=require('../static/time-logic.js');
assert.equal(T.remaining({status:'running',endAt:5000},2000),3000);
assert.equal(T.remaining({status:'running',endAt:5000},6000),0);
assert.equal(T.remaining({status:'paused',remainingMs:4000},6000),4000);
assert.equal(T.elapsed({elapsedMs:2000,startedAt:1000},4000),5000);
assert.equal(T.elapsed({elapsedMs:2000,startedAt:null},4000),2000);
assert.equal(T.durationText(3661000),'01:01:01');
assert.equal(T.durationText(1234,true),'00:00:01.23');
const config={timezone:'Australia/Sydney',visualTimers:[
  {id:'a',name:'First',group:'Weekday',enabled:true,days:[1,2,3,4,5],time:'09:00',variant:'any'},
  {id:'b',name:'Second',group:'Weekend',enabled:true,days:[6],time:'10:00',variant:'lunch-out'},
  {id:'c',name:'Third',group:'Weekend',enabled:true,days:[6],time:'10:30',variant:'lunch-in'},
  {id:'d',name:'Fourth',group:'Weekend',enabled:true,days:[6],time:'11:00',variant:'any'}]};
let targets=T.activityTargets(config,'Weekday','lunch-in',new Date('2026-11-09T08:00:00+11:00'));
assert.equal(targets[0].at,new Date('2026-11-09T09:00:00+11:00').getTime());
targets=T.activityTargets(config,'Weekday','lunch-in',new Date('2026-11-09T10:00:00+11:00'));
assert.equal(targets[0].day,'2026-11-10','Completed activity day advances to next occurrence');
targets=T.activityTargets(config,'Weekday','lunch-in',new Date('2026-11-14T08:00:00+11:00'));
assert.equal(targets[0].day,'2026-11-16','Weekend rolls weekday targets to Monday');
assert.deepEqual(T.activityTargets(config,'Weekend','lunch-out',new Date('2026-11-14T08:00:00+11:00')).map(t=>t.id),['b','d']);
assert.deepEqual(T.activityTargets(config,'Weekend','lunch-in',new Date('2026-11-14T08:00:00+11:00')).map(t=>t.id),['c','d']);
targets=T.activityTargets(config,'Weekday','lunch-in',new Date('2026-07-10T08:00:00+10:00'));
assert.equal(targets[0].at,new Date('2026-07-10T09:00:00+10:00').getTime());
targets=T.activityTargets({...config,timezone:'Australia/Perth'},'Weekday','lunch-in',new Date('2026-11-09T08:00:00+08:00'));
assert.equal(targets[0].at,new Date('2026-11-09T09:00:00+08:00').getTime());
console.log('PASS: timer/stopwatch arithmetic, formatting, weekdays, variants and timezone/DST handling');
