const assert=require('node:assert/strict');
const {nightActive}=require('../static/night-mode.js');
const config={nightEnabled:true,timezone:'Australia/Sydney',nightStart:'22:00',nightEnd:'06:30'};
for(const [time,expected] of [['21:59',false],['22:00',true],['23:59',true],['00:00',true],['06:29',true],['06:30',false],['12:00',false]]){
  assert.equal(nightActive(config,new Date(`2026-11-10T${time}:00+11:00`)),expected,time);
}
assert.equal(nightActive({...config,nightEnabled:false},new Date('2026-11-10T23:00:00+11:00')),false);
assert.equal(nightActive({...config,nightEnd:'18:30'},new Date('2026-11-10T18:29:00+11:00')),true);
assert.equal(nightActive({...config,nightEnd:'18:30'},new Date('2026-11-10T18:30:00+11:00')),false);
assert.equal(nightActive({...config,nightStart:'09:00',nightEnd:'17:00'},new Date('2026-11-10T12:00:00+11:00')),true);
assert.equal(nightActive(config,new Date('2026-07-10T22:00:00+10:00')),true,'Winter timezone');
assert.equal(nightActive({...config,timezone:'Australia/Perth'},new Date('2026-11-10T21:00:00+08:00')),false);
assert.equal(nightActive({...config,nightEnd:'22:00'},new Date('2026-11-10T22:00:00+11:00')),false);
console.log('PASS: overnight/daytime boundaries, explicit PM end, disabled mode, timezone and DST');
