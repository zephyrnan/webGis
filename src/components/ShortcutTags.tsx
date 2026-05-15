import type { ShortcutTag } from '../services/shortcutTags';

type ShortcutTagsProps = {
  tags: ShortcutTag[];
  onPick(command: string): void;
};

export function ShortcutTags({ tags, onPick }: ShortcutTagsProps) {
  if (!tags.length) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <button
          key={tag.id}
          className="rounded-full border border-cyan-400/30 bg-cyan-950/40 px-3 py-2 text-left text-xs text-cyan-100 transition hover:border-cyan-300 hover:bg-cyan-900/60"
          title={tag.reason}
          type="button"
          onClick={() => onPick(tag.command)}
        >
          {tag.label}
        </button>
      ))}
    </div>
  );
}
