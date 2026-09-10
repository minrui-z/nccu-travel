import { createContext, useContext, useId, type ReactNode, type HTMLAttributes } from 'react';
import { fieldInputMode, fieldRequirement } from '@/lib/field-metadata';
import type { Issue } from '@/lib/claim/types';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
export const FieldIssues = createContext<Issue[]>([]);
function useFieldError(path?: string) {
  return useContext(FieldIssues).find((issue) => issue.path === path && issue.severity === 'error')?.message;
}
export interface FieldProps {
  path?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  hint?: string;
  full?: boolean;
  onFocus?: () => void;
  error?: string;
  min?: string;
  max?: string;
  readOnly?: boolean;
  inputMode?: HTMLAttributes<HTMLInputElement>['inputMode'];
  required?: boolean;
}
export function Field({
  path,
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  hint,
  full,
  onFocus,
  error: explicitError,
  min,
  max,
  readOnly,
  inputMode,
  required,
}: FieldProps) {
  const id = useId();
  const contextError = useFieldError(path);
  const error = explicitError || contextError;
  return (
    <div data-field-path={path} className={'field' + (full ? ' full' : '')}>
      <label htmlFor={id}>{label}<FieldMark path={path} required={required} /></label>
      <Input
        id={id}
        value={value}
        type={type}
        inputMode={inputMode ?? fieldInputMode(path)}
        aria-required={required ?? fieldRequirement(path) === 'required'}
        onChange={(e) => onChange(e.target.value)}
        onInput={
          type === 'date' ? (e) => onChange(e.currentTarget.value) : undefined
        }
        onBlur={
          type === 'date'
            ? (e) => {
                if (e.currentTarget.value !== value)
                  onChange(e.currentTarget.value);
              }
            : undefined
        }
        placeholder={placeholder}
        onFocus={onFocus}
        aria-invalid={!!error}
        aria-describedby={hint || error ? id + '-help' : undefined}
        min={min}
        max={max}
        readOnly={readOnly}
      />
      {(hint || error) && (
        <p id={id + '-help'} className={error ? 'field-error' : 'field-hint'}>
          {error || hint}
        </p>
      )}
    </div>
  );
}
export function Area({
  path,
  label,
  value,
  onChange,
  placeholder,
  hint,
  full = true,
  onFocus,
  error: explicitError,
  required,
  readOnly,
}: FieldProps) {
  const id = useId();
  const contextError = useFieldError(path);
  const error = explicitError || contextError;
  return (
    <div data-field-path={path} className={'field' + (full ? ' full' : '')}>
      <label htmlFor={id}>{label}<FieldMark path={path} required={required} /></label>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onFocus={onFocus}
        aria-invalid={!!error}
        aria-describedby={hint || error ? id + '-help' : undefined}
        rows={3}
        readOnly={readOnly}
        aria-required={required ?? fieldRequirement(path) === 'required'}
      />
      {(error || hint) && (
        <p id={id + '-help'} className={error ? 'field-error' : 'field-hint'}>
          {error || hint}
        </p>
      )}
    </div>
  );
}
export function Choice({
  path,
  label,
  value,
  onChange,
  options,
  hint,
  full,
  onFocus,
}: {
  path?: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
  hint?: string;
  full?: boolean;
  onFocus?: () => void;
}) {
  const id = useId();
  const error = useFieldError(path);
  return (
    <div data-field-path={path} className={'field' + (full ? ' full' : '')}>
      <label id={id}>{label}<FieldMark path={path} /></label>
      <Select
        value={value}
        onValueChange={(v) => v !== null && onChange(v)}
        items={Object.fromEntries(options)}
      >
        <SelectTrigger
          aria-labelledby={id}
          aria-required={fieldRequirement(path) === 'required'}
          aria-invalid={!!error}
          aria-describedby={hint || error ? id + '-help' : undefined}
          className="form-select"
          onFocus={onFocus}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {(hint || error) && <p id={id + '-help'} className={error ? 'field-error' : 'field-hint'}>{error || hint}</p>}
    </div>
  );
}
export function CheckField({
  path,
  label,
  checked,
  onChange,
  hint,
}: {
  path?: string;
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  const id = useId();
  const error = useFieldError(path);
  return (
    <div className="check-field" data-field-path={path}>
      <input
        id={id}
        type="checkbox"
        data-slot="checkbox"
        checked={checked}
        aria-invalid={!!error}
        aria-describedby={error ? id + '-error' : undefined}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <label htmlFor={id}>
        {label}
        {hint && <small>{hint}</small>}
        {error && <small className="field-error" id={id + '-error'}>{error}</small>}
      </label>
    </div>
  );
}

function FieldMark({ path, required }: { path?: string; required?: boolean }) {
  const kind = required === undefined ? fieldRequirement(path) : required ? 'required' : 'optional';
  return kind ? <span className={'field-mark ' + kind}>{kind === 'required' ? '必填' : '選填'}</span> : null;
}
