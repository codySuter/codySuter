import { useToasts } from "../../lib/store";

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div className="lf-toasts">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="lf-toast"
          data-tone={toast.tone ?? "default"}
          onClick={() => dismiss(toast.id)}
          role="status"
        >
          <span className="toast-title">{toast.title}</span>
          {toast.body && <span className="toast-body">{toast.body}</span>}
        </div>
      ))}
    </div>
  );
}
