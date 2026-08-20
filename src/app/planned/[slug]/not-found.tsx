import Link from 'next/link'

export default function PlannedCourseNotFound() {
  return (
    <main className="min-h-screen bg-page">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-4 py-16 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-text-muted">Planned Course</p>
        <h1 className="mt-3 text-3xl font-semibold text-text-default">Course site not found</h1>
        <p className="mt-3 max-w-xl text-base text-text-muted">
          This planned course is unavailable or has not been published.
        </p>
        <div className="mt-6">
          <Link
            href="/"
            className="rounded-sm text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Return to Pika
          </Link>
        </div>
      </div>
    </main>
  )
}
