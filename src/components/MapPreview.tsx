import { useCallback, useEffect, useRef, useState } from 'react';
import { Layers, Table2 } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import WebGLVectorLayer from 'ol/layer/WebGLVector';
import OSM from 'ol/source/OSM';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style';
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
  const selectRef = useRef<Select | null>(null);
  const overlayRef = useRef<Overlay | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const originalLayerRef = useRef<VectorLayer<VectorSource> | WebGLVectorLayer | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [originalOpacity, setOriginalOpacity] = useState(0.6);
  const [useWebGL, setUseWebGL] = useState(true);
  const [selectedProps, setSelectedProps] = useState<Record<string, unknown> | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    if (!targetRef.current || !popupRef.current) return;

    const map = new Map({
      target: targetRef.current,
      layers: [new TileLayer({ source: new OSM() })],
      view: new View({ center: [0, 0], zoom: 2 }),
    });
    mapRef.current = map;

    const overlay = new Overlay({
      element: popupRef.current,
      autoPan: { animation: { duration: 200 } },
    });
    map.addOverlay(overlay);
    overlayRef.current = overlay;

    const select = new Select({
      condition: click,
      layers: (layer) => layer === resultLayerRef.current,
    });
    map.addInteraction(select);
    selectRef.current = select;

    select.on('select', (e) => {
      const feature = e.selected[0];
      if (feature) {
        const props = { ...feature.getProperties() };
        delete props.geometry;
        setSelectedProps(props);
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
      map.setTarget(undefined);
      mapRef.current = null;
      selectRef.current = null;
      overlayRef.current = null;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    setSelectedProps(null);
    overlayRef.current?.setPosition(undefined);

    // Revoke previous blobUrl if any
    const prevBlobUrl = blobUrlRef.current;
    if (prevBlobUrl) {
      URL.revokeObjectURL(prevBlobUrl);
      blobUrlRef.current = null;
    }

    if (resultLayerRef.current) {
      map.removeLayer(resultLayerRef.current);
      resultLayerRef.current = null;
    }

    if (result?.kind !== 'geojson' && result?.kind !== 'shapefile') return;

    if (result.previewContent) {
      const previewSource = new VectorSource({
        features: new GeoJSON().readFeatures(result.previewContent, {
          dataProjection: 'EPSG:4326',
          featureProjection: 'EPSG:3857',
        }),
      });
      const previewLayer = new VectorLayer({
        source: previewSource,
        style: new Style({
          image: new CircleStyle({
            radius: 4,
            fill: new Fill({ color: 'rgba(51, 153, 204, 0.75)' }),
            stroke: new Stroke({ color: '#ffffff', width: 1 }),
          }),
          stroke: new Stroke({ color: '#3399cc', width: 2, lineDash: [4, 4] }),
          fill: new Fill({ color: 'rgba(51, 153, 204, 0.1)' }),
        }),
      });
      map.addLayer(previewLayer);
      resultLayerRef.current = previewLayer;

      const extent = previewSource.getExtent();
      if (extent && extent.every(Number.isFinite)) {
        map.getView().fit(extent, { padding: [40, 40, 40, 40], maxZoom: 14 });
      }
      return;
    }

    let source: VectorSource;

    if (result.blobUrl && !result.content) {
      source = new VectorSource({
        url: result.blobUrl,
        format: new GeoJSON({
          dataProjection: 'EPSG:4326',
          featureProjection: 'EPSG:3857',
        }),
      });
      blobUrlRef.current = result.blobUrl;
    } else if (result.content) {
      source = new VectorSource({
        features: new GeoJSON().readFeatures(result.content, {
          dataProjection: 'EPSG:4326',
          featureProjection: 'EPSG:3857',
        }),
      });
    } else {
      return;
    }

    let layer: VectorLayer<VectorSource> | WebGLVectorLayer;

    if (useWebGL) {
      layer = new WebGLVectorLayer({
        source,
        style: {
          'circle-radius': 4,
          'circle-fill-color': 'rgba(37, 99, 235, 0.8)',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1,
          'stroke-color': '#2563eb',
          'stroke-width': 2,
          'fill-color': 'rgba(37, 99, 235, 0.15)',
        },
      });
    } else {
      layer = new VectorLayer({
        source,
        style: new Style({
          image: new CircleStyle({
            radius: 4,
            fill: new Fill({ color: 'rgba(37, 99, 235, 0.8)' }),
            stroke: new Stroke({ color: '#ffffff', width: 1 }),
          }),
          stroke: new Stroke({ color: '#2563eb', width: 2 }),
          fill: new Fill({ color: 'rgba(37, 99, 235, 0.15)' }),
        }),
      });
    }

    map.addLayer(layer);
    resultLayerRef.current = layer;

    const fitExtent = () => {
      const extent = source.getExtent();
      if (extent && extent.every(Number.isFinite)) {
        map.getView().fit(extent, { padding: [40, 40, 40, 40], maxZoom: 14 });
      }
    };

    if (result?.blobUrl && !result.content) {
      source.once('featuresloadend', fitExtent);
    } else {
      fitExtent();
    }
  }, [result, useWebGL]);

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

    let layer: VectorLayer<VectorSource> | WebGLVectorLayer;
    if (useWebGL) {
      layer = new WebGLVectorLayer({
        source,
        style: {
          'circle-radius': 4,
          'circle-fill-color': 'rgba(249, 115, 22, 0.8)',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1,
          'stroke-color': '#f97316',
          'stroke-width': 2,
          'fill-color': 'rgba(249, 115, 22, 0.15)',
        },
        opacity: originalOpacity,
      });
    } else {
      layer = new VectorLayer({
        source,
        style: new Style({
          image: new CircleStyle({
            radius: 4,
            fill: new Fill({ color: 'rgba(249, 115, 22, 0.8)' }),
            stroke: new Stroke({ color: '#ffffff', width: 1 }),
          }),
          stroke: new Stroke({ color: '#f97316', width: 2 }),
          fill: new Fill({ color: 'rgba(249, 115, 22, 0.15)' }),
        }),
        opacity: originalOpacity,
      });
    }

    map.addLayer(layer);
    originalLayerRef.current = layer;
  }, [showOriginal, originalGeoJson, useWebGL, originalOpacity]);

  const geoJsonContent = result?.kind === 'geojson' ? result.content : null;
  const featureCount = (result?.kind === 'geojson' || result?.kind === 'shapefile')
    ? ((result.blobUrl || result.previewContent)
      ? (result.summary.outputFeatureCount ?? 0)
      : (geoJsonContent as GeoJSON.FeatureCollection)?.features?.length ?? 0)
    : 0;

  const closePopup = useCallback(() => {
    setSelectedProps(null);
    overlayRef.current?.setPosition(undefined);
  }, []);

  return (
    <section className="h-full flex flex-col overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50">
      <div className="shrink-0 flex items-center justify-between border-b border-zinc-200 px-3 py-2">
        <div>
          <h2 className="text-xs font-medium text-zinc-600">{t('map.title')}</h2>
          {(result?.kind === 'geojson' || result?.kind === 'shapefile') && featureCount > 0 && (
            <p className="text-[10px] text-zinc-400">
              {featureCount.toLocaleString()} features
              {featureCount > 10000 && ' (WebGL)'}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {geoJsonContent && featureCount > 0 && (
            <button
              aria-label={t('map.showTable')}
              aria-pressed={showTable}
              className={`rounded-md px-2 py-0.5 text-[10px] transition ${
                showTable
                  ? 'bg-zinc-200 text-zinc-800 border border-zinc-300'
                  : 'bg-zinc-100 text-zinc-500 border border-zinc-200 hover:text-zinc-700'
              }`}
              type="button"
              onClick={() => setShowTable(!showTable)}
            >
              <Table2 className="mr-1 inline-block size-2.5" />
              {t('map.showTable')}
            </button>
          )}
          {originalGeoJson && (
            <>
              <button
                aria-label={showOriginal ? t('map.hideOriginal') : t('map.showOriginal')}
                aria-pressed={showOriginal}
                className={`rounded-md px-2 py-0.5 text-[10px] transition ${
                  showOriginal
                    ? 'bg-orange-50 text-orange-700 border border-orange-300'
                    : 'bg-zinc-100 text-zinc-500 border border-zinc-200 hover:text-zinc-700'
                }`}
                type="button"
                onClick={() => setShowOriginal(!showOriginal)}
              >
                {showOriginal ? t('map.hideOriginal') : t('map.showOriginal')}
              </button>
              {showOriginal && (
                <div className="flex items-center gap-1">
                  <Layers className="size-2.5 text-zinc-400" />
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={originalOpacity}
                    aria-label={t('map.originalOpacity')}
                    onChange={(e) => setOriginalOpacity(parseFloat(e.target.value))}
                    className="w-14 accent-orange-400"
                    title={t('map.opacity')}
                  />
                  <span className="text-[9px] text-zinc-400 w-6">{Math.round(originalOpacity * 100)}%</span>
                </div>
              )}
            </>
          )}
          <button
            className={`rounded-md px-2 py-0.5 text-[10px] transition ${
              useWebGL
                ? 'bg-zinc-200 text-zinc-800 border border-zinc-300'
                : 'bg-zinc-100 text-zinc-500 border border-zinc-200 hover:text-zinc-700'
            }`}
            type="button"
            onClick={() => setUseWebGL(!useWebGL)}
          >
            {useWebGL ? 'WebGL' : 'Canvas'}
          </button>
        </div>
      </div>
      {result?.kind === 'summary' ? <p className="shrink-0 border-b border-zinc-200 px-3 py-2 text-[11px] text-amber-600">{t(`warning.${result.warnings[0]}`) === `warning.${result.warnings[0]}` ? result.warnings[0] : t(`warning.${result.warnings[0]}`)}</p> : null}
      <div className="relative flex-1 min-h-0">
        <div ref={targetRef} className="absolute inset-0" />
        <div
          ref={popupRef}
          className="absolute pointer-events-none"
          style={{ display: selectedProps ? 'block' : 'none' }}
        >
          {selectedProps && (
            <div className="pointer-events-auto mb-2 w-56 rounded-lg border border-zinc-200 bg-white p-2.5 text-[10px] shadow-lg shadow-zinc-200/50">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="font-medium text-zinc-700">{t('map.featurePopup')}</span>
                <button
                  aria-label="Close feature popup"
                  className="rounded p-0.5 text-zinc-400 hover:text-zinc-700"
                  type="button"
                  onClick={closePopup}
                >
                  &times;
                </button>
              </div>
              <div className="max-h-40 space-y-0.5 overflow-y-auto">
                {Object.entries(selectedProps).map(([key, value]) => (
                  <div key={key} className="flex gap-2">
                    <span className="shrink-0 text-zinc-400">{key}</span>
                    <span className="truncate text-zinc-700">{value == null ? 'null' : String(value)}</span>
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
