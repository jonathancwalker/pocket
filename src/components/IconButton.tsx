import type { ButtonHTMLAttributes, ReactNode } from 'react';
export default function IconButton({
  label,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      {...props}
      className={`icon-button ${props.className || ''}`}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}
