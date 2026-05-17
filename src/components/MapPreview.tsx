import { useCallback, useEffect, useRef, useState } from 'react';
import { Table2 } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import WebGLVectorLayer from 'ol/layer/WebGLVector';
import OSM from 'ol/source/OSM';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { Fill, Stroke, Style } from 'ol/style';
import Select from 'ol/interaction/Select';
import Overlay from 'ol/Overlay';
import { click } from 'ol/events/condition';
import 'ol/ol.css';
import type { SurgeryResult } from '../types/protocol';
import { AttributeTable } from './AttributeTable';

type MapPreviewProps = {
  result: SurgeryResult | null;
  originalGeoJson?: GeoJSON.FeatureCollection | null;
};

export function MapPreview({ result, originalGeoJson }: MapPreviewProps) {
  const { t } = useI18n();
  const targetRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const resultLayerRef = useRef<VectorLayer<VectorSource> | WebGLVectorLayer | null>(null);
  const originalLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [useWebGL, setUseWebGL] = useState(true);
  const [selectedProps, setSelectedProps] = useState<Record<string, unknown> | null>(null);
  const [showTable, setShowTable] = useState(false);

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

  // Setup select interaction + overlay popup
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !popupRef.current) return;

    const overlay = new Overlay({
      element: popupRef.current,
      autoPan: { animation: { duration: 200 } },
    });
    map.addOverlay(overlay);

    const select = new Select({ condition: click, layers: [] });
    map.addInteraction(select);

    select.on('select', (e) => {
      const feature = e.selected[0];
      if (feature) {
        const props = feature.getProperties();
        // Remove geometry from popup display
        const { geometry: _geom, ...rest } = props;
        setSelectedProps(rest);
        const geometry = feature.getGeometry();
        if (geometry) {
          const extent = geometry.getExtent();
          overlay.setPosition([(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2]);
        }
      } else {
        setSelectedProps(null);
        overlay.setPosition(undefined);
      }
    });

    return () => {
      map.removeInteraction(select);
      map.removeOverlay(overlay);
    };
  }, []);

  // Update result layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (resultLayerRef.current) {
      map.removeLayer(resultLayerRef.current);
      resultLayerRef.current = null;
    }

    if (result?.kind !== 'geojson' || !result.content) return;

    const source = new VectorSource({
      features: new GeoJSON().readFeatures(result.content, {
        dataProjection: 'EPSG:4326',
        featureProjection: 'EPSG:3857',
      }),
    });

    let layer: VectorLayer<VectorSource> | WebGLVectorLayer;

    if (useWebGL) {
      layer = new WebGLVectorLayer({
        source,
        style: {
          'stroke-color': '#22d3ee',
          'stroke-width': 2,
          'fill-color': 'rgba(34, 211, 238, 0.2)',
        },
      });
    } else {
      layer = new VectorLayer({
        source,
        style: new Style({
          stroke: new Stroke({ color: '#22d3ee', width: 2 }),
          fill: new Fill({ color: 'rgba(34, 211, 238, 0.2)' }),
        }),
      });
    }

    map.addLayer(layer);
    resultLayerRef.current = layer;

    // Re-create select interaction targeting the new layer
    map.getInteractions().getArray().forEach((interaction) => {
      if (interaction instanceof Select) {
        map.removeInteraction(interaction);
      }
    });

    const popupOverlay = map.getOverlays().getArray()[0];
    const newSelect = new Select({ condition: click, layers: [layer] });
    newSelect.on('select', (e) => {
      const feature = e.selected[0];
      if (feature) {
        const props = feature.getProperties();
        const { geometry: _geom, ...rest } = props;
        setSelectedProps(rest);
        const geometry = feature.getGeometry();
        if (geometry && popupOverlay) {
          const extent = geometry.getExtent();
          popupOverlay.setPosition([(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2]);
        }
      } else {
        setSelectedProps(null);
        popupOverlay?.setPosition(undefined);
      }
    });
    map.addInteraction(newSelect);

    const extent = source.getExtent();
    if (extent && extent.every(Number.isFinite)) {
      map.getView().fit(extent, { padding: [40, 40, 40, 40], maxZoom: 14 });
    }
  }, [result, useWebGL]);

  // Update original layer (for comparison)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (originalLayerRef.current) {
      map.removeLayer(originalLayerRef.current);
      originalLayerRef.current = null;
    }

    if (!showOriginal || !originalGeoJson) return;

    const source = new VectorSource({
      features: new GeoJSON().readFeatures(originalGeoJson, {
        dataProjection: 'EPSG:4326',
        featureProjection: 'EPSG:3857',
      }),
    });

    const layer = new VectorLayer({
      source,
      style: new Style({
        stroke: new Stroke({ color: '#f97316', width: 2 }),
        fill: new Fill({ color: 'rgba(249, 115, 22, 0.15)' }),
      }),
    });

    map.addLayer(layer);
    originalLayerRef.current = layer;
  }, [showOriginal, originalGeoJson]);

  const geoJsonContent = result?.kind === 'geojson' ? result.content : null;
  const featureCount = geoJsonContent
    ? (geoJsonContent as GeoJSON.FeatureCollection).features?.length ?? 0
    : 0;

  const closePopup = useCallback(() => {
    setSelectedProps(null);
    const map = mapRef.current;
    if (!map) return;
    const overlays = map.getOverlays().getArray();
    for (const overlay of overlays) {
      overlay.setPosition(undefined);
    }
  }, []);

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/70">
      <div className="flex items-center justify-between border-b border-slate-800 p-5">
        <div>
          <h2 className="text-lg font-semibold text-white">{t('map.title')}</h2>
          {result?.kind === 'geojson' && featureCount > 0 && (
            <p className="mt-1 text-xs text-slate-400">
              {featureCount.toLocaleString()} features
              {featureCount > 10000 && ' (WebGL rendering)'}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {geoJsonContent && featureCount > 0 && (
            <button
              className={`rounded-full px-3 py-1 text-xs transition ${
                showTable
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'bg-slate-800 text-slate-400 border border-slate-700 hover:text-slate-200'
              }`}
              type="button"
              onClick={() => setShowTable(!showTable)}
            >
              <Table2 className="mr-1 inline-block size-3" />
              {t('map.showTable')}
            </button>
          )}
          {originalGeoJson && (
            <button
              className={`rounded-full px-3 py-1 text-xs transition ${
                showOriginal
                  ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40'
                  : 'bg-slate-800 text-slate-400 border border-slate-700 hover:text-slate-200'
              }`}
              type="button"
              onClick={() => setShowOriginal(!showOriginal)}
            >
              {showOriginal ? t('map.hideOriginal') : t('map.showOriginal')}
            </button>
          )}
          <button
            className={`rounded-full px-3 py-1 text-xs transition ${
              useWebGL
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'bg-slate-800 text-slate-400 border border-slate-700 hover:text-slate-200'
            }`}
            type="button"
            onClick={() => setUseWebGL(!useWebGL)}
          >
            {useWebGL ? 'WebGL' : 'Canvas'}
          </button>
        </div>
      </div>
      {result?.kind === 'summary' ? <p className="border-b border-slate-800 p-5 text-sm text-amber-200">{t(`warning.${result.warnings[0]}`) === `warning.${result.warnings[0]}` ? result.warnings[0] : t(`warning.${result.warnings[0]}`)}</p> : null}
      <div className="relative">
        <div ref={targetRef} className="h-[420px] bg-slate-950" />
        {/* Feature popup overlay */}
        <div
          ref={popupRef}
          className="absolute pointer-events-none"
          style={{ display: selectedProps ? 'block' : 'none' }}
        >
          {selectedProps && (
            <div className="pointer-events-auto mb-2 w-64 rounded-xl border border-slate-700 bg-slate-900/95 p-3 text-xs shadow-xl shadow-black/50 backdrop-blur">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-medium text-cyan-300">{t('map.featurePopup')}</span>
                <button
                  className="rounded p-0.5 text-slate-500 hover:text-white"
                  type="button"
                  onClick={closePopup}
                >
                  &times;
                </button>
              </div>
              <div className="max-h-48 space-y-1 overflow-auto">
                {Object.entries(selectedProps).map(([key, value]) => (
                  <div key={key} className="flex gap-2">
                    <span className="shrink-0 text-slate-500">{key}</span>
                    <span className="truncate text-slate-200">{value == null ? 'null' : String(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      {showTable && geoJsonContent && (
        <AttributeTable
          geoJson={geoJsonContent as GeoJSON.FeatureCollection}
          onClose={() => setShowTable(false)}
        />
      )}
    </section>
  );
}
