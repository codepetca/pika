import Link from 'next/link'
import { Button } from '@/components/Button'

export default function HomePage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          Pika
        </h1>
        <p className="text-lg text-gray-600 mb-8">
          Student Daily Log & Attendance Tracking
        </p>
        <Link href="/login">
          <Button size="lg" className="w-full">
            Login
          </Button>
        </Link>
      </div>
    </div>
  )
}
