interface PikaLogoProps {
  className?: string
}

/**
 * Pika logo icon - simple, playful brand mark
 */
export function PikaLogo({ className = 'w-8 h-8' }: PikaLogoProps) {
  return (
    <div className={`${className} flex items-center justify-center text-blue-500`}>
      <span className="text-2xl" role="img" aria-label="Pika">
        🐰
      </span>
    </div>
  )
}
