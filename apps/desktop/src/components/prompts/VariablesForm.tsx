import { useState } from 'react';
import { renderPrompt } from '../../lib/prompt-vars';
import { Button } from '../ui/button';
import { Modal } from '../ui/dialog';

interface Props {
  title: string;
  body: string;
  variables: string[];
  initial?: Record<string, string>;
  confirmLabel: string;
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
}

/** Asks for the value of each `{{variable}}` in a prompt, with a live preview of the result. */
export function VariablesForm({
  title,
  body,
  variables,
  initial = {},
  confirmLabel,
  onSubmit,
  onCancel,
}: Props) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(variables.map((v) => [v, initial[v] ?? ''])),
  );
  const submit = () => onSubmit(values);

  return (
    <Modal title={title} onClose={onCancel}>
      <form
        className="flex min-h-0 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 py-3">
          {variables.map((name, i) => (
            <label key={name} className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-fg-muted">{name}</span>
              <textarea
                autoFocus={i === 0}
                rows={2}
                value={values[name] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
                // Enter adds a line (values can be code); Ctrl/Cmd+Enter confirms.
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    submit();
                  }
                }}
                className="selectable resize-y rounded-control border border-border bg-surface p-2 font-mono text-[13px] outline-none focus:border-border-strong"
              />
            </label>
          ))}
          <div>
            <p className="mb-1 text-[11px] font-medium text-fg-subtle">Preview</p>
            <pre
              className="selectable max-h-32 overflow-auto rounded-control border border-border bg-surface p-2 font-mono text-[11px] whitespace-pre-wrap text-fg-muted"
              data-testid="variables-preview"
            >
              {renderPrompt(body, values)}
            </pre>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-3">
          <span className="text-[11px] text-fg-subtle">
            Ctrl+Enter to confirm. Blank fields stay empty.
          </span>
          <span className="flex gap-2">
            <Button type="button" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              {confirmLabel}
            </Button>
          </span>
        </div>
      </form>
    </Modal>
  );
}
