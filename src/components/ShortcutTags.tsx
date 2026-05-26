import type { ShortcutTag } from '../services/shortcutTags';

type ShortcutTagsProps = {
  tags: ShortcutTag[];
  onPick(command: string): void;
};

export function ShortcutTags({ tags, onPick }: ShortcutTagsProps) {
  if (!tags.length) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <button
          key={tag.id}
          className="rounded-md border border-zinc-300 bg-zinc-100 px-2 py-1 text-left text-[11px] text-zinc-500 transition hover:border-zinc-400 hover:text-zinc-700"
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
