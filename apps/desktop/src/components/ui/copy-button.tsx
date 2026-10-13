import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { copyText } from '../../lib/clipboard';
import { Button } from './button';

interface Props {
  text: string | (() => string);
  label?: string;
  className?: string;
}

/** Icon button that copies text and briefly confirms with a check mark. */
export function CopyButton({ text, label = 'Copy', className }: Props) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onClick = async () => {
    if (await copyText(typeof text === 'function' ? text() : text)) {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      className={className}
      onClick={() => void onClick()}
    >
      {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
    </Button>
  );
}
