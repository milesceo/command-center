/**
 * A ~15 line stand-in for class-variance-authority. We only need
 * "pick one class string per variant axis", so we avoid the dependency.
 */
type Axes = Record<string, Record<string, string>>;

export type VariantProps<F> = F extends (props?: infer P) => string ? NonNullable<P> : never;

export function cva<A extends Axes>(base: string, axes: A) {
  return (props: { [K in keyof A]?: keyof A[K] } = {}): string => {
    const picked = (Object.keys(axes) as (keyof A)[]).map((axis) => {
      const choice = props[axis];
      return choice === undefined ? '' : axes[axis]?.[choice as string];
    });
    return [base, ...picked].filter(Boolean).join(' ');
  };
}
