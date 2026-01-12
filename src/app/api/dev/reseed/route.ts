/**
 * Dev-only endpoint to reseed the database
 * POST /api/dev/reseed
 */
import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export async function POST() {
  // Double-gate: require both development mode AND explicit opt-in
  // This prevents accidental exposure if NODE_ENV is misconfigured
  if (process.env.NODE_ENV !== 'development' || process.env.ALLOW_DEV_ENDPOINTS !== 'true') {
    return NextResponse.json(
      { error: 'This endpoint is only available in development mode with ALLOW_DEV_ENDPOINTS=true' },
      { status: 403 }
    )
  }

  try {
    const { stdout, stderr } = await execAsync('pnpm run seed:fresh', {
      cwd: process.cwd(),
      env: { ...process.env, ALLOW_DB_WIPE: 'true' },
      timeout: 60000, // 60 second timeout
    })

    console.log('Reseed stdout:', stdout)
    if (stderr) console.log('Reseed stderr:', stderr)

    return NextResponse.json({
      success: true,
      message: 'Database reseeded successfully',
    })
  } catch (error: any) {
    console.error('Reseed error:', error)
    return NextResponse.json(
      {
        error: 'Failed to reseed database',
        details: error.message,
      },
      { status: 500 }
    )
  }
}
