import {describe,it,expect} from 'vitest'
import {repoLightNativeRacePlans} from '../../../scripts/repolight-native-contracts'
const fixture = () => ({actorId:'f2930001-0000-4000-8000-000000000001',assignmentId:'f2930001-0000-4000-8000-000000000020',studentId:'f2930001-0000-4000-8000-000000000002',runId:'f2930001-0000-4000-8000-000000000040',source:{},connection:{},request:{},leaseToken:'166a4425-77f1-4269-a8a8-7fa1ce1786c7',leaseGeneration:1,subjectBindingId:'266a4425-77f1-4269-a8a8-7fa1ce1786c7',operationId:'f2930001-0000-4000-8000-000000000070'})
describe('owned native race plans',()=>{
 it('accepts a server-allocated binding ID while synthetic target IDs remain constrained',()=>{expect(repoLightNativeRacePlans(fixture()).erasureWins.holderSql).toContain(fixture().subjectBindingId)})
 it('rejects an outside actor or malformed server binding',()=>{expect(()=>repoLightNativeRacePlans({...fixture(),actorId:'166a4425-77f1-4269-a8a8-7fa1ce1786c7'})).toThrow('Synthetic');expect(()=>repoLightNativeRacePlans({...fixture(),subjectBindingId:'invalid'})).toThrow()})
})
