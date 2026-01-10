import Image from 'next/image'

interface PikaLogoProps {
  className?: string
}

/**
 * Pika logo icon - simple, playful brand mark
 */
export function PikaLogo({ className = 'w-8 h-8' }: PikaLogoProps) {
  return (
    <Image
      src="/pika.png"
      alt="Pika"
      width={32}
      height={32}
      priority
      className={`${className} object-contain`}
    />
  )
}
