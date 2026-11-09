import { useEffect, useRef, type ReactNode } from "react";
import { Cube, X, WarningCircle } from "@phosphor-icons/react";
import type { Fields } from "../core/model";
export function Brand() {
  return (
    <a className="brand" href="#/" aria-label="SAG 首页">
      <Cube size={29} weight="duotone" />
      <strong>SAG</strong>
    </a>
  );
}
export function Modal({
  title,
  children,
  onClose,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="modal-heading">
        <h2>{title}</h2>
        <button aria-label="关闭" onClick={onClose}>
          <X size={22} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function ErrorMessage({ message }: { message: string }) {
  return message ? (
    <div className="error-message" role="alert">
      <WarningCircle size={20} />
      <span>{message}</span>
    </div>
  ) : null;
}
const types = {
  text: "文本",
  number: "数字",
  boolean: "布尔",
  object: "对象",
};
export function FieldList({
  fields,
  values,
}: {
  fields: Fields;
  values?: Record<string, string>;
}) {
  return (
    <dl className="fields">
      {Object.entries(fields).map(([key, field]) => (
        <div key={key}>
          <dt>
            {key}
            {field.description && <span>{field.description}</span>}
            {values && key in values && (
              <span className="field-value">{values[key]}</span>
            )}
          </dt>
          <dd>
            {types[field.type]}
            {field.optional ? " · 可选" : ""}
            {Object.hasOwn(field, 'default') && (!values || !Object.hasOwn(values, key)) ? ` · 默认 ${JSON.stringify(field.default)}` : ''}
          </dd>
        </div>
      ))}
    </dl>
  );
}
