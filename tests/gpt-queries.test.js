import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readRecords, readSummary, validateRange } from '../supabase/functions/workout-mcp/queries.js'
function clientFor(rows, fail = false) {
  return { from(table) { assert.equal(table, 'workout_records'); return { select() { return this }, in() { return this }, is() { return this }, gte() { return this }, lte() { return this }, order() { return this }, async range(start, end) { return { data: rows.slice(start, end+1), error: fail ? { message: 'secret diagnostic' } : null } } } } }
}
test('date validation rejects invalid dates, unbounded ranges and invalid pagination', () => {
  for (const input of [{from:'2030-02-30',to:'2030-03-01'}, {from:'2029-01-01',to:'2030-12-31'}, {from:'2030-03-01',to:'2030-01-01'}, {from:'2030-01-01',to:'2030-01-02',offset:-1}]) assert.throws(() => validateRange(input))
})
test('history pages without silently losing rows; read errors do not look like empty history', async () => {
  const rows = Array.from({length:5}, (_,i) => ({kind:'sessions',id:`synthetic-${i}`,payload:{}}))
  const first = await readRecords(clientFor(rows), {from:'2030-01-01',to:'2030-01-02',limit:2})
  assert.equal(first.records.length,2); assert.equal(first.nextOffset,2)
  const last = await readRecords(clientFor(rows), {from:'2030-01-01',to:'2030-01-02',limit:2,offset:4})
  assert.equal(last.records.length,1); assert.equal(last.nextOffset,null)
  await assert.rejects(readRecords(clientFor([],true), {from:'2030-01-01',to:'2030-01-02'}), /조회하지 못/)
})
test('summary ignores unfinished sets and preserves missing reps and numeric zero RIR', async () => {
  const rows = [{kind:'sessions',payload:{status:'completed'}}, ...[
    {completed:true,exerciseId:'synthetic',setType:'work',weight:10,reps:5,rir:0},
    {completed:true,exerciseId:'synthetic',setType:'warmup',weight:10,reps:null,rir:''},
    {completed:false,exerciseId:'synthetic',weight:100,reps:100},
  ].map(payload => ({kind:'sets',payload}))]
  const result = await readSummary(clientFor(rows),{from:'2030-01-01',to:'2030-01-02'})
  assert.equal(result.completedSets,2); assert.equal(result.byExercise.synthetic.knownVolumeKg,50)
  assert.equal(result.byExercise.synthetic.volumeKnownSets,1); assert.equal(result.byExercise.synthetic.rirRecorded,1)
  assert.equal(result.incomplete,false)
})
