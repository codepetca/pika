import { memo } from "react"

type SvgProps = React.ComponentPropsWithoutRef<"svg">

export const RemoveFormattingIcon = memo(({ className, ...props }: SvgProps) => {
  return (
    <svg
      width="24"
      height="24"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="M4 7V4h16v3" />
      <path d="M10.5 4v6" />
      <path d="m3 21 18-18" />
      <path d="M13 4v8" />
      <path d="M13 19h7" />
    </svg>
  )
})

RemoveFormattingIcon.displayName = "RemoveFormattingIcon"
