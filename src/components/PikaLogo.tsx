import Image from 'next/image'

interface PikaLogoProps {
  className?: string
}

/**
 * Pika logo icon - simple, playful brand mark
 *
 * Note: Uses dark: CSS filter classes to transform the image for dark mode.
 * This is an intentional exception to the semantic token pattern since
 * CSS filters require explicit values rather than CSS variables.
 */
export function PikaLogo({ className = 'w-8 h-8' }: PikaLogoProps) {
  return (
    <Image
      src="/pika.png"
      alt="Pika"
      width={32}
      height={32}
      priority
      className={`${className} object-contain dark:brightness-0 dark:invert dark:sepia dark:saturate-[0.3] dark:hue-rotate-[15deg]`}
    />
  )
}
