import { Spinner } from '@/components/Spinner'

export default function ClassroomLoading() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-[50vh]">
      <Spinner size="lg" />
    </div>
  )
}
