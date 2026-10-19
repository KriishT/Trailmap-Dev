"use client";
import * as RadixDialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useState } from "react";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

/** Cmd+K / Ctrl+K command palette: type to filter, arrows to move, Enter to run. */
export function CommandPalette({ commands, open, onOpenChange }: { commands: Command[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? commands.filter((c) => c.label.toLowerCase().includes(q) || (c.hint ?? "").toLowerCase().includes(q)) : commands;
  }, [commands, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
    }
  }, [open]);
  useEffect(() => {
    setIndex(0);
  }, [query]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onOpenChange(false);
    c.run();
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="overlay" />
        <RadixDialog.Content className="dialog">
          <RadixDialog.Title className="sr-only">Command palette</RadixDialog.Title>
          <RadixDialog.Description className="sr-only">Type to filter commands. Use the arrow keys and Enter.</RadixDialog.Description>
          <input
            className="input"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={shown[index] ? `palette-${shown[index]!.id}` : undefined}
            aria-label="Search commands and nodes"
            placeholder="Go to a sheet, node or action"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, shown.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(shown[index]);
              }
            }}
          />
          <ul className="palette-list" id="palette-list" role="listbox" aria-label="Commands">
            {shown.length === 0 ? <li className="palette-item faint" role="option" aria-selected="false">Nothing matches &ldquo;{query}&rdquo;</li> : null}
            {shown.slice(0, 50).map((c, i) => (
              <li key={c.id} id={`palette-${c.id}`} className="palette-item" role="option" aria-selected={i === index} onMouseEnter={() => setIndex(i)} onClick={() => run(c)}>
                <span>{c.label}</span>
                {c.hint ? <span className="faint mono">{c.hint}</span> : null}
              </li>
            ))}
          </ul>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
