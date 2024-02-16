/******************************************************************************

Flatmap viewer and annotation tool

Copyright (c) 2019 - 2023 David Brooks

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

******************************************************************************/

// Make sure colour string is in `#rrggbb` form.
// Based on https://stackoverflow.com/a/47355187

function standardise_color(str){
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = str;
    const colour = ctx.fillStyle;
    canvas.remove()
    return colour;
}

//==============================================================================

export class Control
{
    constructor(flatmap, id, name)
    {
        this.__flatmap = flatmap;
        this.__id = id;
        this.__name = name;
        this.__map = undefined;
        this.__prefix = `${this.__id}-`
    }

    getDefaultPosition()
    //==================
    {
        return 'top-right';
    }

    _addControlDetails()
    //==================
    {
        return {
            enabled: 0,
            total: 0
        }
    }

    _enableAll(enable)
    //================
    {
    }

    __setAllCheckedState()
    //====================
    {
        if (this.__checkedCount === 0) {
            this.__allCheckbox.checked = false;
            this.__allCheckbox.indeterminate = false;
        } else if (this.__checkedCount === this.__totalCount) {
            this.__allCheckbox.checked = true;
            this.__allCheckbox.indeterminate = false;
        } else {
            this.__allCheckbox.indeterminate = true;
        }
    }

    _addControlLine(id, name, style=null)
    //===================================
    {
        const label = document.createElement('label');
        label.setAttribute('for', id);
        if (style !== null) {
            label.setAttribute('style', style);
        }
        label.textContent = name;
        this.__control.appendChild(label);
        const input = document.createElement('input');
        input.setAttribute('type', 'checkbox');
        input.id = id;
        this.__control.appendChild(input);
        return input;
    }

    onAdd(map)
    //========
    {
        this.__map = map;
        this.__container = document.createElement('div');
        this.__container.className = 'maplibregl-ctrl flatmap-control';
        this.__control = document.createElement('div');
        this.__control.className = 'flatmap-control-grid';

        this.__allCheckbox = this._addControlLine(`control-all-${this.__id}`, `ALL ${this.__name.toUpperCase()}:`);
        const controlDetails = this._addControlDetails();
        this.__totalCount = controlDetails.total;
        this.__halfCount = Math.trunc(this.__totalCount/2);
        this.__checkedCount = controlDetails.enabled;
        this.__setAllCheckedState();

        /*
        const innerDetails = this._innerLinesHTML();
        const innerHTML = innerDetails.html;
        innerHTML.splice(0, 0, `<label for="control-all-${this.__id}">ALL ${this.__name.toUpperCase()}:</label><input id="control-all-${this.__id}" type="checkbox"/>`);
        this.__control.innerHTML = innerHTML.join('\n');

        this.__totalCount = innerHTML.length;
        this.__halfCount = Math.trunc(this.__totalCount/2);
        this.__checkedCount = innerDetails.enabled;
        this.__allCheckbox = document.getElementById(`control-all-${this.__id}`);
        this.__setAllCheckedState();
        */

        this.__button = document.createElement('button');
        this.__button.id = `flatmap-${this.__id}-button`;
        this.__button.className = 'control-button text-button';
        this.__button.setAttribute('type', 'button');
        this.__button.setAttribute('aria-label', `Show/hide map's ${this.__name}`);
        this.__button.setAttribute('control-visible', 'false');
        this.__button.textContent = this.__name.toUpperCase().substring(0, 6);
        this.__button.title = `Show/hide map's ${this.__name}`;
        this.__container.appendChild(this.__button);

        this.__container.addEventListener('click', this.onClick_.bind(this));
        return this.__container;
    }

    onRemove()
    //========
    {
        this.__container.parentNode.removeChild(this.__container);
        this.__map = undefined;
    }

    onClick_(event)
    //=============
    {
        if (event.target.id === `flatmap-${this.__id}-button`) {
            if (this.__button.getAttribute('control-visible') === 'false') {
                this.__container.appendChild(this.__control);
                this.__button.setAttribute('control-visible', 'true');
                this.__control.focus();
            } else {
                this.__control = this.__container.removeChild(this.__control);
                this.__button.setAttribute('control-visible', 'false');
            }
        } else if (event.target.tagName === 'INPUT') {
            if (event.target.id === `control-all-${this.__id}`) {
                if (event.target.indeterminate) {
                    event.target.checked = (this.__checkedCount >= this.__halfCount);
                    event.target.indeterminate = false;
                }
                this.__checkedCount = event.target.checked ? this.__totalCount : 0;
                this._enableAll(event.target.checked);
            } else if (event.target.id.startsWith(`${this.__id}-`)) {
                this.__enableControl(event.target.id.substring(this.__prefix.length),
                                     event.target.checked);
                this.__checkedCount += (event.target.checked ? 1 : -1);
                this.__setAllCheckedState();
            }
        }
        event.stopPropagation();
    }
}

//==============================================================================

export class NavigationControl
{
    constructor(flatmap)
    {
        this._flatmap = flatmap;
        this._map = undefined;
    }

    getDefaultPosition()
    //==================
    {
        return 'top-right';
    }

    onAdd(map)
    //========
    {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'maplibregl-ctrl navigation-group';
        this._container.innerHTML = `<button id="flatmap-zoom-in" class="navigation-zoom-in" type="button" title="Zoom in" aria-label="Zoom in"></button>
<button id="flatmap-zoom-out" class="navigation-zoom-out" type="button" title="Zoom out" aria-label="Zoom out"></button>
<button id="flatmap-reset" class="navigation-reset" type="button" title="Reset" aria-label="Reset"></button>`;
        this._container.onclick = this.onClick_.bind(this);
        return this._container;
    }

    onRemove()
    //========
    {
        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
    }

    onClick_(e)
    //=========
    {
        if        (e.target.id === 'flatmap-zoom-in') {
            this._flatmap.zoomIn();
        } else if (e.target.id === 'flatmap-zoom-out') {
            this._flatmap.zoomOut();
        } else if (e.target.id === 'flatmap-reset') {
            this._flatmap.resetMap();
        }
    }
}

//==============================================================================

export class LayerControl
{
    constructor(flatmap, layerManager)
    {
        this.__flatmap = flatmap;
        this.__layers = layerManager.layers;
        this.__map = undefined;
    }

    getDefaultPosition()
    //==================
    {
        return 'top-right';
    }

    onAdd(map)
    //========
    {
        this.__map = map;
        this.__container = document.createElement('div');
        this.__container.className = 'maplibregl-ctrl flatmap-control';
        this.__layersControl = document.createElement('div');
        this.__layersControl.className = 'flatmap-control-grid';

        const innerHTML = [];
        innerHTML.push(`<label for="layer-all-layers">ALL LAYERS:</label><input id="layer-all-layers" type="checkbox" checked/>`);
        for (const layer of this.__layers) {
            innerHTML.push(`<label for="layer-${layer.id}">${layer.description}</label><input id="layer-${layer.id}" type="checkbox" checked/>`);
        }
        this.__layersControl.innerHTML = innerHTML.join('\n');

        this.__layersCount = this.__layers;
        this.__checkedCount = this.__layersCount;
        this.__halfCount = Math.trunc(this.__checkedCount/2);

        this.__button = document.createElement('button');
        this.__button.id = 'map-layers-button';
        this.__button.className = 'control-button text-button';
        this.__button.setAttribute('type', 'button');
        this.__button.setAttribute('aria-label', 'Show/hide map layers');
        this.__button.setAttribute('control-visible', 'false');
        this.__button.textContent = 'LAYERS';
        this.__button.title = 'Show/hide map layers';
        this.__container.appendChild(this.__button);

        this.__container.addEventListener('click', this.onClick_.bind(this));
        return this.__container;
    }

    onRemove()
    //========
    {
        this.__container.parentNode.removeChild(this.__container);
        this.__map = undefined;
    }

    onClick_(event)
    //=============
    {
        if (event.target.id === 'map-layers-button') {
            if (this.__button.getAttribute('control-visible') === 'false') {
                this.__container.appendChild(this.__layersControl);
                this.__button.setAttribute('control-visible', 'true');
                this.__layersControl.focus();
            } else {
                this.__layersControl = this.__container.removeChild(this.__layersControl);
                this.__button.setAttribute('control-visible', 'false');
            }
        } else if (event.target.tagName === 'INPUT') {
            if (event.target.id === 'layer-all-layers') {
                if (event.target.indeterminate) {
                    event.target.checked = (this.__checkedCount >= this.__halfCount);
                    event.target.indeterminate = false;
                }
                if (event.target.checked) {
                    this.__checkedCount = this.__layersCount;
                } else {
                    this.__checkedCount = 0;
                }
                for (const layer of this.__layers) {
                    const layerCheckbox = document.getElementById(`layer-${layer.id}`);
                    if (layerCheckbox) {
                        layerCheckbox.checked = event.target.checked;
                        this.__flatmap.enableLayer(layer.id, event.target.checked);
                    }
                }
            } else if (event.target.id.startsWith('layer-')) {
                const layerId = event.target.id.substring(6);
                this.__flatmap.enableLayer(layerId, event.target.checked);
                if (event.target.checked) {
                    this.__checkedCount += 1;
                } else {
                    this.__checkedCount -= 1;
                }
                const allLayersCheckbox = document.getElementById('layer-all-layers');
                if (this.__checkedCount === 0) {
                    allLayersCheckbox.checked = false;
                    allLayersCheckbox.indeterminate = false;
                } else if (this.__checkedCount === this.__layersCount) {
                    allLayersCheckbox.checked = true;
                    allLayersCheckbox.indeterminate = false;
                } else {
                    allLayersCheckbox.indeterminate = true;
                }
            }
        }
        event.stopPropagation();
    }
}

//==============================================================================

const SCKAN_STATES = [
    {
        'id': 'VALID',
        'description': 'Path consistent with SCKAN'
    },
    {
        'id': 'INVALID',
        'description': 'Path inconsistent with SCKAN'
    }
];


export class SCKANControl
{
    constructor(flatmap, options={sckan: 'valid'})
    {
        this.__flatmap = flatmap;
        this.__map = undefined;
        this.__initialState = options.sckan || 'valid';
    }

    getDefaultPosition()
    //==================
    {
        return 'top-right';
    }

    onAdd(map)
    //========
    {
        this.__map = map;
        this.__container = document.createElement('div');
        this.__container.className = 'maplibregl-ctrl flatmap-control';
        this.__sckan = document.createElement('div');
        this.__sckan.className = 'flatmap-control-grid';

        const innerHTML = [];
        let checked = (this.__initialState === 'all') ? 'checked' : '';
        innerHTML.push(`<label for="sckan-all-paths">ALL PATHS:</label><input id="sckan-all-paths" type="checkbox" ${checked}/>`);
        for (const state of SCKAN_STATES) {
            checked = (this.__initialState.toUpperCase() === state.id) ? 'checked' : '';
            innerHTML.push(`<label for="sckan-${state.id}">${state.description}</label><input id="sckan-${state.id}" type="checkbox" ${checked}/>`);
        }
        this.__sckan.innerHTML = innerHTML.join('\n');

        this.__sckanCount = SCKAN_STATES.length;
        this.__checkedCount = (this.__initialState === 'all') ? this.__sckanCount
                            : (this.__initialState === 'none') ? 0
                            : 1;
        this.__halfCount = Math.trunc(this.__sckanCount/2);

        this.__button = document.createElement('button');
        this.__button.id = 'map-sckan-button';
        this.__button.className = 'control-button text-button';
        this.__button.setAttribute('type', 'button');
        this.__button.setAttribute('aria-label', 'Show/hide valid SCKAN paths');
        this.__button.setAttribute('control-visible', 'false');
        this.__button.textContent = 'SCKAN';
        this.__button.title = 'Show/hide valid SCKAN paths';
        this.__container.appendChild(this.__button);

        this.__container.addEventListener('click', this.onClick_.bind(this));
        return this.__container;
    }

    onRemove()
    //========
    {
        this.__container.parentNode.removeChild(this.__container);
        this.__map = undefined;
    }

    onClick_(event)
    //=============
    {
        if (event.target.id === 'map-sckan-button') {
            if (this.__button.getAttribute('control-visible') === 'false') {
                this.__container.appendChild(this.__sckan);
                this.__button.setAttribute('control-visible', 'true');
                const allLayersCheckbox = document.getElementById('sckan-all-paths');
                allLayersCheckbox.indeterminate = (this.__checkedCount > 0)
                                               && (this.__checkedCount < this.__sckanCount);
                this.__sckan.focus();
            } else {
                this.__sckan = this.__container.removeChild(this.__sckan);
                this.__button.setAttribute('control-visible', 'false');
            }
        } else if (event.target.tagName === 'INPUT') {
            if (event.target.id === 'sckan-all-paths') {
                if (event.target.indeterminate) {
                    event.target.checked = (this.__checkedCount >= this.__halfCount);
                    event.target.indeterminate = false;
                }
                if (event.target.checked) {
                    this.__state = 'all';
                    this.__checkedCount = this.__sckanCount;
                } else {
                    this.__state = 'none';
                    this.__checkedCount = 0;
                }
                for (const state of SCKAN_STATES) {
                    const sckanCheckbox = document.getElementById(`sckan-${state.id}`);
                    if (sckanCheckbox) {
                        sckanCheckbox.checked = event.target.checked;
                        this.__flatmap.enableSckanPath(state.id, event.target.checked);
                    }
                }
            } else if (event.target.id.startsWith('sckan-')) {
                const sckanId = event.target.id.substring(6);
                this.__flatmap.enableSckanPath(sckanId, event.target.checked);
                if (event.target.checked) {
                    this.__checkedCount += 1;
                } else {
                    this.__checkedCount -= 1;
                }
                const allLayersCheckbox = document.getElementById('sckan-all-paths');
                if (this.__checkedCount === 0) {
                    allLayersCheckbox.checked = false;
                    allLayersCheckbox.indeterminate = false;
                } else if (this.__checkedCount === this.__sckanCount) {
                    allLayersCheckbox.checked = true;
                    allLayersCheckbox.indeterminate = false;
                } else {
                    allLayersCheckbox.indeterminate = true;
                }
            }
        }
        event.stopPropagation();
    }
}

//==============================================================================

export class NerveControl
{
    constructor(flatmap, options={showCentrelines: false})
    {
        this.__flatmap = flatmap;
        this.__map = undefined;
        this.__visible = options.showCentrelines || false;
    }

    getDefaultPosition()
    //==================
    {
        return 'top-right';
    }

    onAdd(map)
    //========
    {
        this.__map = map;
        this.__container = document.createElement('div');
        this.__container.className = 'maplibregl-ctrl';

        this.__button = document.createElement('button');
        this.__button.id = 'map-nerve-button';
        this.__button.className = 'control-button text-button';
        this.__button.setAttribute('type', 'button');
        this.__button.setAttribute('aria-label', 'Show/hide nerve centrelines');
        this.__button.textContent = 'NERVES';
        this.__button.title = 'Show/hide nerve centrelines';
        this.__container.appendChild(this.__button);

        this.__container.addEventListener('click', this.onClick_.bind(this));
        return this.__container;
    }

    onRemove()
    //========
    {
        this.__container.parentNode.removeChild(this.__container);
        this.__map = undefined;
    }

    onClick_(event)
    //=============
    {
        if (event.target.id === 'map-nerve-button') {
            this.__visible = !this.__visible;
            this.__flatmap.enableCentrelines(this.__visible);
        }
        event.stopPropagation();
    }
}

//==============================================================================

export class AnnotatorControl
{
    #enabled = false

    constructor(flatmap)
    {
        this.__flatmap = flatmap
        this.__map = null
    }

    getDefaultPosition()
    //==================
    {
        return 'top-right'
    }

    onAdd(map)
    //========
    {
        this.__map = map;
        this.__container = document.createElement('div');
        this.__container.className = 'maplibregl-ctrl';

        this.__button = document.createElement('button');
        this.__button.id = 'map-annotated-button';
        this.__button.className = 'control-button text-button';
        this.__button.setAttribute('type', 'button');
        this.__button.setAttribute('aria-label', 'Draw on map for annotation');
        this.__button.textContent = 'DRAW';
        this.__button.title = 'Draw on map for annotation';
        this.__container.appendChild(this.__button);

        this.__container.addEventListener('click', this.onClick_.bind(this));
        this.__setBackground();
        return this.__container;
    }

    __setBackground()
    //===============
    {
        if (this.#enabled) {
            this.__button.setAttribute('style', 'background: red');
        } else {
            this.__button.removeAttribute('style');
        }
    }

    onRemove()
    //========
    {
        this.__container.parentNode.removeChild(this.__container)
        this.__map = null
    }

    onClick_(event)
    //=============
    {
        if (event.target.id === 'map-annotated-button') {
            this.#enabled = !this.#enabled
            this.__setBackground()
            this.__flatmap.showAnnotator(this.#enabled)
        }
        event.stopPropagation();
    }
}

//==============================================================================

export class BackgroundControl
{
    constructor(flatmap)
    {
        this.__flatmap = flatmap;
        this.__map = undefined;
    }

    getDefaultPosition()
    //==================
    {
        return 'bottom-right';
    }

    onAdd(map)
    //========
    {
        this.__map = map;
        this.__container = document.createElement('div');
        this.__container.className = 'maplibregl-ctrl';
        this.__colourDiv = document.createElement('div');
        this.__colourDiv.setAttribute('aria-label', 'Change background colour');
        this.__colourDiv.title = 'Change background colour';
        const background = standardise_color(this.__flatmap.getBackgroundColour());
        this.__colourDiv.innerHTML = `<input type="color" id="colourPicker" value="${background}">`;
        this.__container.appendChild(this.__colourDiv);
        this.__colourDiv.addEventListener('input', this.__updateColour.bind(this), false);
        this.__colourDiv.addEventListener('change', this.__updateColour.bind(this), false);
        return this.__container;
    }

    onRemove()
    //========
    {
        this.__container.parentNode.removeChild(this.__container);
        this.__map = undefined;
    }

    __updateColour(event)
    //===================
    {
        const colour = event.target.value;
        this.__flatmap.setBackgroundColour(colour);
        this.__flatmap.controlEvent('change', 'background', colour)
        event.stopPropagation();
    }
}

//==============================================================================

const COMPLETENESS_STATES = [
    {
        'id': 'VALID',
        'description': 'Path with complete nodes'
    },
    {
        'id': 'INVALID',
        'description': 'Path with missing node/s'
    }
];


export class CompletenessControl
{
    constructor(flatmap, options={completeness: 'all'})
    {
        this.__flatmap = flatmap;
        this.__map = undefined;
        this.__initialState = options.completeness || 'valid';
    }

    getDefaultPosition()
    //==================
    {
        return 'top-right';
    }

    onAdd(map)
    //========
    {
        this.__map = map;
        this.__container = document.createElement('div');
        this.__container.className = 'maplibregl-ctrl flatmap-control';
        this.__completeness = document.createElement('div');
        this.__completeness.className = 'flatmap-control-grid';

        const innerHTML = [];
        let checked = (this.__initialState === 'all') ? 'checked' : '';
        innerHTML.push(`<label for="completeness-all-paths">ALL PATHS:</label><input id="completeness-all-paths" type="checkbox" ${checked}/>`);
        for (const state of COMPLETENESS_STATES) {
            checked = (this.__initialState.toUpperCase() === state.id || this.__initialState === 'all') ? 'checked' : '';
            innerHTML.push(`<label for="completeness-${state.id}">${state.description}</label><input id="completeness-${state.id}" type="checkbox" ${checked}/>`);
        }
        this.__completeness.innerHTML = innerHTML.join('\n');

        this.__completenessCount = COMPLETENESS_STATES.length;
        this.__checkedCount = (this.__initialState === 'all') ? this.__completenessCount
                            : (this.__initialState === 'none') ? 0
                            : 1;
        this.__halfCount = Math.trunc(this.__completenessCount/2);

        this.__button = document.createElement('button');
        this.__button.id = 'map-completeness-button';
        this.__button.className = 'control-button text-button';
        this.__button.setAttribute('type', 'button');
        this.__button.setAttribute('aria-label', 'Show/hide complete SCKAN paths');
        this.__button.setAttribute('control-visible', 'false');
        this.__button.textContent = 'MISSING';
        this.__button.title = 'Show/hide incomplete SCKAN paths';
        this.__container.appendChild(this.__button);

        this.__container.addEventListener('click', this.onClick_.bind(this));
        return this.__container;
    }

    onRemove()
    //========
    {
        this.__container.parentNode.removeChild(this.__container);
        this.__map = undefined;
    }

    onClick_(event)
    //=============
    {
        if (event.target.id === 'map-completeness-button') {
            if (this.__button.getAttribute('control-visible') === 'false') {
                this.__container.appendChild(this.__completeness);
                this.__button.setAttribute('control-visible', 'true');
                const allLayersCheckbox = document.getElementById('completeness-all-paths');
                allLayersCheckbox.indeterminate = (this.__checkedCount > 0)
                                               && (this.__checkedCount < this.__completenessCount);
                this.__completeness.focus();
            } else {
                this.__completeness = this.__container.removeChild(this.__completeness);
                this.__button.setAttribute('control-visible', 'false');
            }
        } else if (event.target.tagName === 'INPUT') {
            if (event.target.id === 'completeness-all-paths') {
                if (event.target.indeterminate) {
                    event.target.checked = (this.__checkedCount >= this.__halfCount);
                    event.target.indeterminate = false;
                }
                if (event.target.checked) {
                    this.__state = 'all';
                    this.__checkedCount = this.__completenessCount;
                } else {
                    this.__state = 'none';
                    this.__checkedCount = 0;
                }
                for (const state of COMPLETENESS_STATES) {
                    const completenessCheckbox = document.getElementById(`completeness-${state.id}`);
                    if (completenessCheckbox) {
                        completenessCheckbox.checked = event.target.checked;
                        this.__flatmap.enableCompletenessPath(state.id, event.target.checked);
                    }
                }
            } else if (event.target.id.startsWith('completeness-')) {
                const completenessId = event.target.id.substring(13);
                this.__flatmap.enableCompletenessPath(completenessId, event.target.checked);
                if (event.target.checked) {
                    this.__checkedCount += 1;
                } else {
                    this.__checkedCount -= 1;
                }
                const allLayersCheckbox = document.getElementById('completeness-all-paths');
                if (this.__checkedCount === 0) {
                    allLayersCheckbox.checked = false;
                    allLayersCheckbox.indeterminate = false;
                } else if (this.__checkedCount === this.__completenessCount) {
                    allLayersCheckbox.checked = true;
                    allLayersCheckbox.indeterminate = false;
                } else {
                    allLayersCheckbox.indeterminate = true;
                }
            }
        }
        event.stopPropagation();
    }
}

//==============================================================================
