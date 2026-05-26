import { ChevronRight, Eye, EyeOff } from 'lucide-react';
import type { GeoLayer } from '../types/layer';

type LayerItemProps = {
  layer: GeoLayer;
  isSelected: boolean;
  onSelect(name: string): void;
  onToggleVisibility(name: string): void;
  onToggleExpand(name: string): void;
};

export function LayerItem({ layer, isSelected, onSelect, onToggleVisibility, onToggleExpand }: LayerItemProps) {
  return (
    <div>
      <div
        className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm cursor-pointer transition ${
          isSelected
            ? 'bg-zinc-200 border border-zinc-300'
            : 'hover:bg-zinc-100'
        }`}
      >
        <button
          aria-expanded={layer.isExpanded}
          aria-label={`${layer.isExpanded ? 'Collapse' : 'Expand'} ${layer.name}`}
          className="shrink-0 p-0.5 text-zinc-400 hover:text-zinc-700 transition"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand(layer.name);
          }}
        >
          <ChevronRight className={`size-3 transition-transform ${layer.isExpanded ? 'rotate-90' : ''}`} />
        </button>

        <button
          aria-label={`${layer.isVisible ? 'Hide' : 'Show'} ${layer.name}`}
          aria-pressed={layer.isVisible}
          className="shrink-0 p-0.5 text-zinc-400 hover:text-zinc-700 transition"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisibility(layer.name);
          }}
        >
          {layer.isVisible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5 text-zinc-300" />}
        </button>

        <button
          aria-current={isSelected ? 'true' : undefined}
          className="flex-1 min-w-0 text-left truncate"
          type="button"
          onClick={() => onSelect(layer.name)}
        >
          <span className={`font-mono text-xs ${isSelected ? 'text-zinc-900' : 'text-zinc-600'}`}>
            {layer.name}
          </span>
        </button>

        <span className="shrink-0 text-[10px] text-zinc-400 tabular-nums">
          {layer.featureCount ?? '?'}
        </span>
      </div>

      {layer.isExpanded && layer.schema.length > 0 && (
        <div className="ml-5 pl-3 border-l border-zinc-200 mt-1 space-y-0.5">
          {layer.schema.map((field) => (
            <div key={field.field} className="flex items-center gap-2 px-2 py-1 text-[11px]">
              <span className="font-mono text-zinc-500 truncate">{field.field}</span>
              <span className="shrink-0 text-zinc-400">{field.type}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
