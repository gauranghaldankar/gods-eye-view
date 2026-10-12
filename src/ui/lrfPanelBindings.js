/**
 * LRF Target List Panel controller.
 * Renders a snapshot-driven list of LRF observation targets.
 * Clicking a row flies to the target, shows a `selected` overlay card,
 * and expands an inline accordion with full CoT details.
 * Clicking the active row again (or pressing Escape) clears the selection.
 */
export class LrfPanelBindings {
  /**
   * @param {{ elements: object, layer: object, viewer: object, actions: object }} opts
   */
  constructor({ elements, layer, actions = {} }) {
    this._elements = elements;
    this._layer = layer;
    this._actions = actions;
    this.destroyed = false;
    this._abortController = new AbortController();
    this._activeRow = null;
    this._activeAccordion = null;

    this._layer.setSnapshotListener(() => this._refresh());
    this._bindKeys();
    this._refresh();
  }

  _listen(target, type, handler, options = {}) {
    if (!target) return;
    target.addEventListener(type, handler, {
      ...options,
      signal: this._abortController.signal,
    });
  }

  _bindKeys() {
    this._listen(document, 'keydown', (event) => {
      if (event.key !== 'Escape') return;
      const tag = event.target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      if (this._layer.getSelectedTargetId()) {
        this._layer.clearSelection();
        this._refresh();
      }
    });
  }

  _refresh() {
    if (this.destroyed) return;
    const { _lrfTargetList, _lrfPanelStatus } = this._elements;
    if (!_lrfTargetList) return;

    const snapshot = this._layer.getSnapshot();
    const targets = snapshot?.targets || [];
    const selectedId = this._layer.getSelectedTargetId();

    // If the previously selected target is gone after a refresh, ensure UI
    // reflects the auto-clear the layer already performed.
    if (selectedId && !targets.some((t) => t.stableId === selectedId)) {
      this._activeRow = null;
      this._activeAccordion = null;
    }

    // Status line
    if (_lrfPanelStatus) {
      if (!this._layer.isEnabled()) {
        _lrfPanelStatus.textContent = 'Enable LRF Observations';
      } else if (targets.length) {
        _lrfPanelStatus.textContent = `${targets.length} target${targets.length !== 1 ? 's' : ''}`;
      } else {
        _lrfPanelStatus.textContent = 'No targets';
      }
    }

    // Rebuild list
    _lrfTargetList.textContent = '';

    if (targets.length === 0) return;

    for (const target of targets) {
      const isActive = target.stableId === selectedId;
      const li = this._buildRow(target, isActive);
      _lrfTargetList.appendChild(li);
    }
  }

  _buildRow(target, isActive) {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(isActive));
    li.className = 'lrf-target-row' + (isActive ? ' is-active' : '');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lrf-target-btn';
    btn.dataset.targetId = target.stableId;
    btn.setAttribute(
      'aria-expanded',
      String(isActive),
    );

    // Left-border color by affiliation
    const affColor = _affiliationBorderColor(target.affiliation);
    btn.style.setProperty('--lrf-aff-color', affColor);

    // Row text: tag + range + azimuth
    const tag = _affiliationTag(target.affiliation);
    const parts = [tag];
    if (target.rangeM != null) parts.push(`${Math.round(target.rangeM)}m`);
    if (target.azimuthTrueDeg != null)
      parts.push(`${target.azimuthTrueDeg.toFixed(1)}\u00b0T`);
    btn.textContent = parts.join(' \u00b7 ');

    btn.addEventListener(
      'click',
      () => this._handleRowClick(target.stableId),
      { signal: this._abortController.signal },
    );

    li.appendChild(btn);

    if (isActive) {
      const accordion = this._buildAccordion(target);
      li.appendChild(accordion);
    }

    return li;
  }

  _buildAccordion(target) {
    const div = document.createElement('div');
    div.className = 'lrf-accordion';

    const lines = _buildDetailLines(target);
    for (const line of lines) {
      const p = document.createElement('p');
      p.className = 'lrf-accordion-line';
      p.textContent = line;
      div.appendChild(p);
    }

    return div;
  }

  _handleRowClick(stableId) {
    if (this.destroyed) return;
    const currentSelected = this._layer.getSelectedTargetId();
    if (currentSelected === stableId) {
      // Toggle off
      this._layer.clearSelection();
    } else {
      this._layer.selectTarget(stableId);
    }
    this._refresh();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this._abortController.abort();
    this._layer.setSnapshotListener(null);
  }
}

// --- helpers (module-private) ---

function _affiliationTag(aff) {
  return (
    { HOSTILE: 'HOS', FRIEND: 'FRD', NEUTRAL: 'NEU', UNKNOWN: 'UNK' }[aff] ||
    'UNK'
  );
}

function _affiliationBorderColor(aff) {
  return (
    {
      HOSTILE: '#FF4444',
      FRIEND: '#4488FF',
      NEUTRAL: '#44BB44',
      UNKNOWN: '#FFCC00',
    }[aff] || '#FFCC00'
  );
}

function _buildDetailLines(target) {
  const lines = [];
  if (target.mgrs) lines.push(`MGRS ${target.mgrs}`);
  const range = target.rangeM != null ? `${Math.round(target.rangeM)}m` : '';
  const az =
    target.azimuthTrueDeg != null
      ? `${target.azimuthTrueDeg.toFixed(1)}\u00b0T`
      : '';
  if (range || az) lines.push([range, az].filter(Boolean).join(' \u00b7 '));
  if (target.inclinationDeg != null)
    lines.push(`INCL ${target.inclinationDeg.toFixed(1)}\u00b0`);
  if (target.cep50M != null)
    lines.push(
      `CEP ${Math.round(target.cep50M)}m \u00b7 ${Math.round(target.semiMajor95M || 0)}\u00d7${Math.round(target.semiMinor95M || 0)}m 95%`,
    );
  if (target.observerCallsign) lines.push(`OBS ${target.observerCallsign}`);
  if (target.category) lines.push(`CAT ${target.category}`);
  if (target.remarks) lines.push(target.remarks);
  if (target.timeUtc)
    lines.push(target.timeUtc.replace('T', ' ').replace('Z', ' Z'));
  return lines;
}
