import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

// Modal stack manager.
//
// Each <Modal> registers itself when opened, picking up an index based on
// its position in the stack. Only the top modal listens for Escape, so
// closing a stacked modal doesn't close its parent. Z-index is computed
// from the stack index, so modals naturally layer correctly without each
// callsite hard-coding values.

interface ModalStackContextValue {
  push: (id: string) => number;
  pop: (id: string) => void;
  isTop: (id: string) => boolean;
  count: () => number;
}

const ModalStackContext = createContext<ModalStackContextValue | null>(null);

export const ModalStackProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Live array of stacked modal IDs. Mutated in place to avoid re-renders
  // on every push/pop — components re-read via isTop() / count() callbacks.
  const stackRef = useRef<string[]>([]);
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);

  const value = useMemo<ModalStackContextValue>(
    () => ({
      push: (id) => {
        stackRef.current.push(id);
        rerender();
        return stackRef.current.length - 1;
      },
      pop: (id) => {
        const idx = stackRef.current.lastIndexOf(id);
        if (idx >= 0) stackRef.current.splice(idx, 1);
        rerender();
      },
      isTop: (id) => stackRef.current[stackRef.current.length - 1] === id,
      count: () => stackRef.current.length,
    }),
    []
  );

  return <ModalStackContext.Provider value={value}>{children}</ModalStackContext.Provider>;
};

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  // Disable backdrop-click dismissal (use for destructive-action modals
  // where an accidental click would lose work).
  closeOnBackdrop?: boolean;
  // Disable escape-key dismissal for the same reason.
  closeOnEscape?: boolean;
  // ARIA label for screen readers when the modal has no visible heading.
  ariaLabel?: string;
  // ID of the element that labels the dialog (overrides ariaLabel).
  ariaLabelledBy?: string;
  // Optional className for the backdrop wrapper. Default centers content
  // with the existing app styling.
  backdropClassName?: string;
  // Optional className applied to the inner content wrapper. Use this to
  // size and shape the modal panel.
  contentClassName?: string;
}

const BASE_Z_INDEX = 50;

let modalIdCounter = 0;

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  children,
  closeOnBackdrop = true,
  closeOnEscape = true,
  ariaLabel,
  ariaLabelledBy,
  backdropClassName,
  contentClassName,
}) => {
  const stack = useContext(ModalStackContext);
  if (!stack) {
    throw new Error('Modal must be rendered inside <ModalStackProvider>');
  }

  // Stable ID per Modal instance.
  const idRef = useRef<string>(`modal-${++modalIdCounter}`);
  const id = idRef.current;
  const [stackIndex, setStackIndex] = useState<number>(-1);

  // Register/unregister with the stack synchronously on open/close.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const idx = stack.push(id);
    setStackIndex(idx);
    return () => {
      stack.pop(id);
    };
  }, [isOpen, id, stack]);

  // Lock body scroll while any modal is open. Using count() means stacked
  // modals don't double-toggle the lock.
  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      // Only restore if no other modal is still open.
      if (stack.count() === 0) {
        document.body.style.overflow = prevOverflow;
      }
    };
  }, [isOpen, stack]);

  // Escape closes only the top modal.
  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (!stack.isTop(id)) return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, closeOnEscape, onClose, id, stack]);

  if (!isOpen) return null;

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!closeOnBackdrop) return;
    // Only fire when the click is on the backdrop itself, not bubbled
    // from a child element inside the modal panel.
    if (e.target !== e.currentTarget) return;
    onClose();
  };

  const z = BASE_Z_INDEX + Math.max(0, stackIndex) * 10;

  // Default backdrop uses the `.modal-backdrop` utility from index.css,
  // which already pulls in animation, blur, and base z-index. We override
  // z-index inline so stacked modals layer correctly.
  const node = (
    <div
      className={backdropClassName ?? 'modal-backdrop'}
      style={{ zIndex: z }}
      onMouseDown={handleBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabelledBy ? undefined : ariaLabel}
      aria-labelledby={ariaLabelledBy}
    >
      <div className={contentClassName} onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );

  return createPortal(node, document.body);
};
