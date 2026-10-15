import { cva, type VariantProps } from './variants';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variant: {
      primary: 'bg-accent text-accent-fg hover:brightness-95',
      secondary: 'border border-border bg-elevated text-fg hover:bg-hover',
      ghost: 'text-fg-muted hover:bg-hover hover:text-fg',
    },
    size: {
      sm: 'h-7 px-2.5 text-xs',
      md: 'h-8 px-3 text-[13px]',
      icon: 'size-7',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'md', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
});
