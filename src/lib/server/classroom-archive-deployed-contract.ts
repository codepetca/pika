import { resolveClassroomArchiveV2Resources } from '@/lib/contracts/classroom-archive-resources'
import { getServiceRoleClient } from '@/lib/supabase'
import { z } from 'zod'

export async function readDeployedClassroomArchiveResources(supabase: ReturnType<typeof getServiceRoleClient>) {
  const { data, error, count } = await supabase
    .from('classroom_archive_resource_contract_versions')
    .select('table_name', { count: 'exact' })
    .eq('format_version', 2)
    .order('export_position', { ascending: true })
    .range(0, 999)
  if (error) throw new Error('Could not read deployed classroom archive contract')
  const rows = z.array(z.object({ table_name: z.string() }).strict()).parse(data)
  if (count !== rows.length) throw new Error('Incomplete deployed classroom archive contract')
  return resolveClassroomArchiveV2Resources(rows.map((row) => row.table_name))
}
