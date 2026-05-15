import { useEffect, useRef } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import OSM from 'ol/source/OSM';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { Fill, Stroke, Style } from 'ol/style';
import 'ol/ol.css';
import type { SurgeryResult } from '../types/protocol';

type MapPreviewProps = {
  result: SurgeryResult | null;
};

export function MapPreview({ result }: MapPreviewProps) {
  const targetRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const vectorLayerRef = useRef<VectorLayer<VectorSource> | null>(null);

  useEffect(() => {
    if (!targetRef.current) return;

    const map = new Map({
      target: targetRef.current,
      layers: [new TileLayer({ source: new OSM() })],
      view: new View({ center: [0, 0], zoom: 2 }),
    });
    mapRef.current = map;

    return () => {
      map.setTarget(undefined);
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (vectorLayerRef.current) {
      map.removeLayer(vectorLayerRef.current);
      vectorLayerRef.current = null;
    }

    if (result?.kind !== 'geojson' || !result.content) return;

    const source = new VectorSource({
      features: new GeoJSON().readFeatures(result.content, {
        dataProjection: 'EPSG:4326',
        featureProjection: 'EPSG:3857',
      }),
    });
    const layer = new VectorLayer({
      source,
      style: new Style({
        stroke: new Stroke({ color: '#22d3ee', width: 2 }),
        fill: new Fill({ color: 'rgba(34, 211, 238, 0.2)' }),
      }),
    });

    map.addLayer(layer);
    vectorLayerRef.current = layer;

    const extent = source.getExtent();
    if (extent && extent.every(Number.isFinite)) {
      map.getView().fit(extent, { padding: [40, 40, 40, 40], maxZoom: 14 });
    }
  }, [result]);

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/70">
      <div className="border-b border-slate-800 p-5">
        <p className="text-xs uppercase tracking-[0.24em] text-cyan-300">OpenLayers Preview</p>
        <h2 className="mt-1 text-lg font-semibold text-white">结果审阅</h2>
        {result?.kind === 'summary' ? <p className="mt-2 text-sm text-amber-200">{result.warnings[0]}</p> : null}
      </div>
      <div ref={targetRef} className="h-[420px] bg-slate-950" />
    </section>
  );
}
