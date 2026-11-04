import assert from 'node:assert/strict'
import { localPsqlArgs, validateTarget } from './test-contention-load'
const owner='a'.repeat(32)
const db={Id:'b'.repeat(64),Name:'/load-db',Config:{Image:'postgres:15',Labels:{'pika.test-load.owner':owner,'pika.test-load.role':'db'},Env:[]},State:{Running:true},NetworkSettings:{Networks:{load:{Aliases:['load-db']}},Ports:{}}}
const api={Id:'c'.repeat(64),Name:'/load-api',Config:{Image:'postgrest/postgrest:v12',Labels:{'pika.test-load.owner':owner,'pika.test-load.role':'api'},Env:['PGRST_DB_URI=postgres://auth:secret@load-db:5432/postgres']},State:{Running:true},NetworkSettings:{Networks:{load:{Aliases:['load-api']}},Ports:{'3000/tcp':[{HostIp:'127.0.0.1',HostPort:'54331'}]}}}
validateTarget(db,api,owner)
for(const mutation of [
  { ...db,Name:'/supabase_db_pika' },
  { ...db,Config:{...db.Config,Labels:{...db.Config.Labels,'pika.test-load.owner':'wrong'}} },
]) assert.throws(()=>validateTarget(mutation,api,owner))
for(const mutation of [
  {...api,Config:{...api.Config,Env:['PGRST_DB_URI=postgres://auth:secret@other:5432/postgres']}},
  ...['host=other','hostaddr=127.0.0.1','dbname=other','service=other','port=5433'].map(option=>({...api,Config:{...api.Config,Env:[`PGRST_DB_URI=postgres://auth:secret@load-db:5432/postgres?${option}`]}})),
  {...api,Config:{...api.Config,Env:['PGRST_DB_URI=postgres://auth:secret@load-db:5433/postgres']}},
  ...['PGHOST','PGHOSTADDR','PGPORT','PGSERVICE','PGSERVICEFILE','PGDATABASE'].map(name=>({...api,Config:{...api.Config,Env:[...api.Config.Env,`${name}=other`]}})),
  {...api,NetworkSettings:{...api.NetworkSettings,Ports:{'3000/tcp':[{HostIp:'0.0.0.0',HostPort:'54331'}]}}},
  {...api,Config:{...api.Config,Image:'untrusted/postgrest:v12'}},
]) assert.throws(()=>validateTarget(db,mutation,owner))
assert.deepEqual(localPsqlArgs(db.Id),['exec','-i',db.Id,'env','-i','PATH=/usr/local/bin:/usr/bin:/bin','psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-h','/var/run/postgresql','-p','5432','-U','postgres','-d','postgres'])
assert.throws(()=>localPsqlArgs('untrusted'))
console.log('PASS disposable target guard')
