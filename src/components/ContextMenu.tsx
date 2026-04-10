import { useEffect, useRef, useCallback, useState } from "react";

export type ContextMenuItem =
  | { type: "item"; label: string; icon?: React.ReactNode; danger?: boolean; disabled?: boolean; onClick: () => void }
  | { type: "separator" };

type ContextMenuState = { x: number; y: number; items: ContextMenuItem[] } | null;

/* ───── Hook: useContextMenu ───── */

export function useContextMenu() {
  const [menu, setMenu] = useState<ContextMenuState>(null);

  const show = useCallback((e: React.MouseEvent, items: ContextMenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  }, []);

  const hide = useCallback(() => setMenu(null), []);

  return { menu, show, hide };
}

/* ───── Component: ContextMenuPortal ───── */

export function ContextMenuPortal({
  menu,
  onClose,
}: {
  menu: { x: number; y: number; items: ContextMenuItem[] } | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Adjust position so menu stays within viewport
  useEffect(() => {
    if (!menu || !ref.current) return;
    const el = ref.current;
    const rect = el.getBoundingClientRect();
    const maxX = window.innerWidth - 8;
    const maxY = window.innerHeight - 8;

    if (rect.right > maxX) el.style.left = `${maxX - rect.width}px`;
    if (rect.bottom > maxY) el.style.top = `${maxY - rect.height}px`;
  }, [menu]);

  // Close on outside click or Escape
  useEffect(() => {
    if (!menu) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleClick = () => onClose();
    window.addEventListener("keydown", handleKey);
    window.addEventListener("click", handleClick, true);
    window.addEventListener("contextmenu", handleClick, true);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("click", handleClick, true);
      window.removeEventListener("contextmenu", handleClick, true);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  return (
    <div
      ref={ref}
      className="fixed z-[9999] min-w-[180px] rounded-xl border border-white/10 bg-[#1c2030] py-1 shadow-xl shadow-black/50"
      style={{ left: menu.x, top: menu.y }}
      onClick={(e) => e.stopPropagation()}
    >
      {menu.items.map((item, i) => {
        if (item.type === "separator") {
          return <div key={i} className="my-1 border-t border-white/8" />;
        }
        return (
          <button
            key={i}
            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors ${
              item.disabled
                ? "cursor-not-allowed text-slate-500"
                : item.danger
                  ? "text-rose-400 hover:bg-rose-500/15"
                  : "text-slate-200 hover:bg-white/10"
            }`}
            disabled={item.disabled}
            onClick={() => {
              if (!item.disabled) {
                item.onClick();
                onClose();
              }
            }}
          >
            {item.icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center">{item.icon}</span>}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
