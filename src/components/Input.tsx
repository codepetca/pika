import { InputHTMLAttributes, forwardRef } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', ...props }, ref) => {
    return (
      <div className="w-full">
        {label ? (
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            <span className="block mb-1">{label}</span>
            <input
              ref={ref}
              className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 dark:disabled:bg-gray-700 disabled:cursor-not-allowed ${
                error ? 'border-red-500 dark:border-red-400' : 'border-gray-300 dark:border-gray-600'
              } ${className}`}
              {...props}
            />
          </label>
        ) : (
          <input
            ref={ref}
            className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 dark:disabled:bg-gray-700 disabled:cursor-not-allowed ${
              error ? 'border-red-500 dark:border-red-400' : 'border-gray-300 dark:border-gray-600'
            } ${className}`}
            {...props}
          />
        )}
        {error && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>
    )
  }
)

Input.displayName = 'Input'
