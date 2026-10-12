import * as Cesium from 'cesium';
import {
  LRF_OVERLAY_SOURCE_ID,
  LRF_OVERLAY_COHORT_LIMIT,
  LRF_OVERLAY_COLLISION_CAPACITY,
  affiliationColor,
  createLrfOverlayEntry,
  createLrfHoverCard,
  selectLrfOverlayCohort,
  mapAnalystRecord,
} from './model.js';
import {
  LRF_SELECTED_OVERLAY_SOURCE_ID,
  createLrfSelectedOverlayEntry,
} from './selection.js';
export * from './model.js';
export { createLrfObservationsSource } from './source.js';

/**
 * LRF Observations layer — renders geolocated, error-bounded laser
 * rangefinder target observations on the CesiumJS globe.
 *
 * Each observation renders as:
 * - A ground-clamped 95% error ellipse (semi-major/minor from the error model)
 * - A center point marker colored by NATO affiliation
 * - An observer position marker (blue diamond)
 * - A bearing line from observer to target
 */
export function createLrfObservationsLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('LRF observations require a snapshot source');
  if (!overlayHost)
    throw new TypeError('LRF observations require an overlay host');

  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let _lastSnapshot = null;
  let _lineWidth = 2;
  let _ellipseOpacity = 15;
  let _markerSize = 12;
  let _rowControlsListener = null;
  let _pendingFlyTo = false;
  let _hoverHandler = null;
  let _hoveredTargetId = null;
  let _snapshotListener = null;
  let _selectedTargetId = null;

  function _refreshOverlays() {
    if (!_enabled || !_lastSnapshot?.targets?.length) return;
    const entries = [];
    for (const target of _lastSnapshot.targets) {
      const position = Cesium.Cartesian3.fromDegrees(
        target.lon, target.lat, target.hEllM,
      );
      if (_hoveredTargetId === target.stableId && _selectedTargetId !== target.stableId) {
        entries.push(createLrfHoverCard({ id: target.stableId, position, target }));
      } else {
        entries.push(createLrfOverlayEntry({ id: target.stableId, position, target }));
      }
    }
    overlayHost.setEntries(
      LRF_OVERLAY_SOURCE_ID,
      selectLrfOverlayCohort(entries),
      {
        cohortLimit: LRF_OVERLAY_COHORT_LIMIT,
        collisionCapacity: LRF_OVERLAY_COLLISION_CAPACITY,
        moving: false,
      },
    );
  }

  const layer = {
    id: 'lrf-observations',
    name: 'LRF Observations',
    icon: '\u{1F3AF}', // target emoji
    source: 'LRF Companion',
    updateInterval: 5000,

    init(viewer) {
      if (_viewer)
        throw new Error('LRF observations layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('lrf-observations');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      _lastSnapshot = null;
      overlayHost.setVisible(LRF_OVERLAY_SOURCE_ID, false);
      overlayHost.setVisible(LRF_SELECTED_OVERLAY_SOURCE_ID, false);
      _hoverHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      _hoverHandler.setInputAction((movement) => {
        if (!_enabled || !_lastSnapshot) return;
        const picked = viewer.scene.pick(movement.endPosition);
        const entityId = picked?.id?.id || '';
        const targetPrefix = 'lrf-target:';
        if (entityId.startsWith(targetPrefix)) {
          const stableId = entityId.slice(targetPrefix.length);
          if (_hoveredTargetId === stableId) return;
          _hoveredTargetId = stableId;
          _refreshOverlays();
          viewer.scene.canvas.style.cursor = 'pointer';
        } else if (_hoveredTargetId) {
          _hoveredTargetId = null;
          _refreshOverlays();
          viewer.scene.canvas.style.cursor = '';
        }
      }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
      console.log('[Data:LRF] Initialized');
    },

    enable() {
      _enabled = true;
      _pendingFlyTo = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(LRF_OVERLAY_SOURCE_ID, true);
      overlayHost.setVisible(LRF_SELECTED_OVERLAY_SOURCE_ID, true);
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      _lastSnapshot = null;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(LRF_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(LRF_OVERLAY_SOURCE_ID, false);
      layer.clearSelection();
      overlayHost.setVisible(LRF_SELECTED_OVERLAY_SOURCE_ID, false);
      _snapshotListener?.();
    },

    setParams(params = {}) {
      let changed = false;
      if (params.lineWidth != null) {
        const v = Math.max(1, Math.min(8, Math.round(Number(params.lineWidth))));
        if (Number.isFinite(v) && v !== _lineWidth) { _lineWidth = v; changed = true; }
      }
      if (params.ellipseOpacity != null) {
        const v = Math.max(5, Math.min(80, Math.round(Number(params.ellipseOpacity) / 5) * 5));
        if (Number.isFinite(v) && v !== _ellipseOpacity) { _ellipseOpacity = v; changed = true; }
      }
      if (params.markerSize != null) {
        const v = Math.max(6, Math.min(24, Math.round(Number(params.markerSize) / 2) * 2));
        if (Number.isFinite(v) && v !== _markerSize) { _markerSize = v; changed = true; }
      }
      if (changed) {
        _rowControlsListener?.();
        // Re-render with new visual params
        layer.update();
      }
      return changed;
    },

    setRowControlsListener(listener) {
      _rowControlsListener = listener || null;
    },

    getRowControls() {
      return {
        sliders: [
          { id: 'lineWidth', label: 'Line', min: 1, max: 8, step: 1, value: _lineWidth, param: 'lineWidth' },
          { id: 'ellipseOpacity', label: 'Ellipse', min: 5, max: 80, step: 5, value: _ellipseOpacity, unit: '%', param: 'ellipseOpacity' },
          { id: 'markerSize', label: 'Marker', min: 6, max: 24, step: 2, value: _markerSize, unit: 'px', param: 'markerSize' },
        ],
      };
    },

    isEnabled() {
      return _enabled;
    },

    getSnapshot() {
      return _lastSnapshot;
    },

    setSnapshotListener(listener) {
      _snapshotListener = listener || null;
    },

    selectTarget(stableId) {
      const target = (_lastSnapshot?.targets || []).find(
        (t) => t.stableId === stableId,
      );
      if (!target || !_viewer) return;
      _selectedTargetId = stableId;
      const position = Cesium.Cartesian3.fromDegrees(
        target.lon,
        target.lat,
        target.hEllM,
      );
      overlayHost.setEntries(
        LRF_SELECTED_OVERLAY_SOURCE_ID,
        [createLrfSelectedOverlayEntry({ id: stableId, position, target })],
        { cohortLimit: 1, collisionCapacity: 0, moving: false },
      );
      const sphere = new Cesium.BoundingSphere(position, 50);
      _viewer.camera.flyToBoundingSphere(sphere, {
        offset: new Cesium.HeadingPitchRange(
          0,
          Cesium.Math.toRadians(-45),
          600,
        ),
        duration: 1.5,
      });
    },

    clearSelection() {
      if (!_selectedTargetId) return;
      _selectedTargetId = null;
      overlayHost.clearSource(LRF_SELECTED_OVERLAY_SOURCE_ID);
    },

    getSelectedTargetId() {
      return _selectedTargetId;
    },

    getDetectableObjects() {
      if (!_enabled || !_selectedTargetId || !_lastSnapshot) return [];
      const target = (_lastSnapshot.targets || []).find(
        (t) => t.stableId === _selectedTargetId,
      );
      if (!target) return [];
      return [
        {
          position: Cesium.Cartesian3.fromDegrees(
            target.lon,
            target.lat,
            target.hEllM,
          ),
          id: `LRF ${target.stableId}`,
          type: 'LRF',
          skipLabel: true,
        },
      ];
    },

    async update() {
      if (!_enabled || !_dataSource) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const snapshot = await source.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;

        _lastSnapshot = snapshot;
        const nextEntities = [];
        const overlayEntries = [];
        let count = 0;

        // Render observer positions
        for (const obs of snapshot.observers || []) {
          nextEntities.push(
            new Cesium.Entity({
              id: `lrf-observer:${obs.id}`,
              position: Cesium.Cartesian3.fromDegrees(
                obs.lon,
                obs.lat,
                obs.hEllM,
              ),
              point: {
                pixelSize: Math.max(6, _markerSize - 2),
                color: Cesium.Color.fromCssColorString('#4488FF'),
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 2,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
              properties: {
                featureType: 'observer',
                callsign: obs.callsign,
              },
            }),
          );
        }

        // Build a lookup from targetEstimateId to ellipse polygon ring
        const ellipseRings = new Map();
        for (const ell of snapshot.ellipses || []) {
          if (ell.targetEstimateId && ell.ring?.length >= 4) {
            ellipseRings.set(ell.targetEstimateId, ell);
          }
        }

        // Render target observations
        for (const target of snapshot.targets || []) {
          count++;
          const color = affiliationColor(target.affiliation);
          const position = Cesium.Cartesian3.fromDegrees(
            target.lon,
            target.lat,
            target.hEllM,
          );

          // 95% error ellipse — prefer the polygon ring from the export,
          // fall back to Cesium's built-in ellipse primitive
          const ellipseData = ellipseRings.get(target.targetEstimateId);
          if (ellipseData?.ring?.length >= 4) {
            // Use the geodesic polygon from LRF's exporter
            const positions = ellipseData.ring.map(([lon, lat]) =>
              Cesium.Cartesian3.fromDegrees(lon, lat),
            );
            nextEntities.push(
              new Cesium.Entity({
                id: `lrf-ellipse:${target.stableId}`,
                polygon: {
                  hierarchy: new Cesium.PolygonHierarchy(positions),
                  material: new Cesium.ColorMaterialProperty(
                    color.withAlpha(_ellipseOpacity / 100),
                  ),
                  outline: true,
                  outlineColor: color.withAlpha(0.7),
                  outlineWidth: 2,
                  heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                },
              }),
            );
          } else if (target.semiMajor95M && target.semiMinor95M) {
            // Fallback: use Cesium ellipse primitive
            const orientRad = target.ellipseOrientDeg
              ? Cesium.Math.toRadians(target.ellipseOrientDeg)
              : 0;
            nextEntities.push(
              new Cesium.Entity({
                id: `lrf-ellipse:${target.stableId}`,
                position,
                ellipse: {
                  semiMajorAxis: target.semiMajor95M,
                  semiMinorAxis: target.semiMinor95M,
                  rotation: -orientRad, // Cesium: CW from north; LRF: CW from north
                  material: new Cesium.ColorMaterialProperty(
                    color.withAlpha(_ellipseOpacity / 100),
                  ),
                  outline: true,
                  outlineColor: color.withAlpha(0.7),
                  outlineWidth: 2,
                  heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                },
              }),
            );
          }

          // Target center point
          nextEntities.push(
            new Cesium.Entity({
              id: `lrf-target:${target.stableId}`,
              position,
              point: {
                pixelSize: _markerSize,
                color,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 2,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
              properties: {
                featureType: 'target',
                observationId: target.observationId,
                targetEstimateId: target.targetEstimateId,
                mgrs: target.mgrs,
                rangeM: target.rangeM,
                azimuthTrueDeg: target.azimuthTrueDeg,
                inclinationDeg: target.inclinationDeg,
                cep50M: target.cep50M,
                semiMajor95M: target.semiMajor95M,
                semiMinor95M: target.semiMinor95M,
                affiliation: target.affiliation,
                category: target.category,
                remarks: target.remarks,
                observerCallsign: target.observerCallsign,
                timeUtc: target.timeUtc,
              },
            }),
          );

          // Bearing line from observer to target
          const observer = (snapshot.observers || []).find(
            (o) => o.callsign === target.observerCallsign,
          );
          if (observer) {
            const obsPos = Cesium.Cartesian3.fromDegrees(
              observer.lon,
              observer.lat,
              observer.hEllM,
            );
            nextEntities.push(
              new Cesium.Entity({
                id: `lrf-bearing:${target.stableId}`,
                polyline: {
                  positions: [obsPos, position],
                  width: _lineWidth,
                  material: new Cesium.ColorMaterialProperty(
                    color.withAlpha(0.5),
                  ),
                  clampToGround: true,
                },
              }),
            );
          }

          overlayEntries.push(
            createLrfOverlayEntry({
              id: target.stableId,
              position,
              target,
            }),
          );
        }

        _dataSource.entities.removeAll();
        for (const entity of nextEntities) _dataSource.entities.add(entity);
        if (_enabled) {
          overlayHost.setEntries(
            LRF_OVERLAY_SOURCE_ID,
            selectLrfOverlayCohort(overlayEntries),
            {
              cohortLimit: LRF_OVERLAY_COHORT_LIMIT,
              collisionCapacity: LRF_OVERLAY_COLLISION_CAPACITY,
              moving: false,
            },
          );
        }

        _count = count;
        _lastUpdate = Date.now();
        _lastError = null;
        // Auto-clear selection if the selected target dropped from the snapshot.
        if (
          _selectedTargetId &&
          !(snapshot.targets || []).some((t) => t.stableId === _selectedTargetId)
        ) {
          layer.clearSelection();
        }
        _snapshotListener?.();
        if (count > 0) {
          console.log(
            `[Data:LRF] Updated: ${count} observation(s), ${(snapshot.observers || []).length} observer(s)`,
          );
          if (_pendingFlyTo && _viewer) {
            _pendingFlyTo = false;
            const coords = [
              ...(snapshot.observers || []).map((o) => [o.lon, o.lat]),
              ...(snapshot.targets || []).map((t) => [t.lon, t.lat]),
            ].filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
            if (coords.length > 0) {
              const cartesians = coords.map(([lon, lat]) =>
                Cesium.Cartesian3.fromDegrees(lon, lat),
              );
              const sphere = Cesium.BoundingSphere.fromPoints(cartesians);
              _viewer.camera.flyToBoundingSphere(sphere, {
                offset: new Cesium.HeadingPitchRange(
                  0,
                  Cesium.Math.toRadians(-60),
                  Math.max(sphere.radius * 3, 2000),
                ),
                duration: 2,
              });
            }
          }
        }
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        // 404 is normal when no data is loaded yet — don't warn
        if (!e.message?.includes('404')) {
          console.warn('[Data:LRF] Fetch error:', e);
        }
        _lastError = e?.message || 'LRF source unavailable';
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    destroy(viewer = _viewer) {
      _request?.abort();
      _request = null;
      _enabled = false;
      _lastSnapshot = null;
      _hoveredTargetId = null;
      _snapshotListener = null;
      layer.clearSelection();
      if (_hoverHandler) {
        _hoverHandler.destroy();
        _hoverHandler = null;
      }
      overlayHost.clearSource(LRF_OVERLAY_SOURCE_ID);
      overlayHost.clearSource(LRF_SELECTED_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(LRF_OVERLAY_SOURCE_ID, false);
      overlayHost.setVisible(LRF_SELECTED_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _viewer = null;
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
    },

    getAnalystRecords(maxCount = 2000) {
      if (!_lastSnapshot?.targets?.length) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      return _lastSnapshot.targets
        .slice(0, limit)
        .map((t, i) => mapAnalystRecord(t, i));
    },

    getStats() {
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        error: _lastError,
      };
    },
  };
  return layer;
}
