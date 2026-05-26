import { Layers } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import type { GeoLayer } from '../types/layer';
import { LayerItem } from './LayerItem';

type LayerTreeProps = {
  layers: GeoLayer[];
  selectedLayer: string | null;
  onSelectLayer(name: string): void;
  onToggleVisibility(name: string): void;
  onToggleExpand(name: string): void;
};

export function LayerTree({ layers, selectedLayer, onSelectLayer, onToggleVisibility, onToggleExpand }: LayerTreeProps) {
  const { t } = useI18n();

  if (layers.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-400">
        <Layers className="size-4 shrink-0" />
        {t('metadata.empty')}
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {layers.map((layer) => (
        <LayerItem
          key={layer.id}
          layer={layer}
          isSelected={selectedLayer === layer.name}
          onSelect={onSelectLayer}
          onToggleVisibility={onToggleVisibility}
          onToggleExpand={onToggleExpand}
        />
      ))}
    </div>
  );
}
