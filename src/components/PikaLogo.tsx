interface PikaLogoProps {
  className?: string
}

/**
 * Pika logo icon - simple, playful brand mark
 */
export function PikaLogo({ className = 'w-8 h-8' }: PikaLogoProps) {
  return (
    <span
      role="img"
      aria-label="Pika"
      className={`${className} pika-logo block`}
    />
  )
}
