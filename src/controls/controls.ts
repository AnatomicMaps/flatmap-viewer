/*==============================================================================

Flatmap viewer and annotation tool

Copyright (c) 2019 - 2025 David Brooks

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

==============================================================================*/

import type * as maplibregl from 'maplibre-gl'

//==============================================================================

import type { FlatMap } from '../flatmap'
import type { FlatMapLayer, FlatMapLayerOptions } from '../flatmap-types'
import type { LayerManager } from '../layers'

//==============================================================================
// Make sure colour string is in `#rrggbb` form.
// Based on https://stackoverflow.com/a/47355187

function standardise_color(str: string): string
{
    const canvas = document.createElement("canvas")
    const ctx = canvas.getContext("2d")
    ctx.fillStyle = str
    const colour = ctx.fillStyle
    canvas.remove()
    return colour
}

//==============================================================================

export class Control
{
    #allCheckbox: HTMLInputElement|null = null
    #button: HTMLButtonElement|null = null
    #checkedCount: number = 0
    #container: HTMLDivElement|null = null
    #control: HTMLDivElement|null = null
    #flatmap: FlatMap
    #halfCount: number = 0
    #id: string
    #name: string
    #prefix: string
    #totalCount: number = 0

    constructor(flatmap: FlatMap, id: string, name: string)
    {
        this.#flatmap = flatmap
        this.#id = id
        this.#name = name
        this.#prefix = `${this.#id}-`
    }

    get flatmap(): FlatMap
    //====================
    {
        return this.#flatmap
    }

    get prefix(): string
    //==================
    {
        return this.#prefix
    }

    getDefaultPosition(): maplibregl.ControlPosition
    //==============================================
    {
        return 'top-right'
    }

    addControlDetails()
    //=================
    {
        return {
            enabled: 0,
            total: 0
        }
    }

    enableAll(_enable: boolean)
    //=========================
    {
    }

    enableControl(_id: string, _enable: boolean)
    //==========================================
    {

    }

    addControlLine(id: string, name: string, style :string|null=null, cls: string|null=null): HTMLInputElement
    //=========================================================================================================
    {
        const label = document.createElement('label')
        if (cls) {
            label.setAttribute('class', cls)
        }
        label.setAttribute('for', id)
        if (style !== null) {
            label.setAttribute('style', style)
        }
        label.textContent = name
        this.#control.appendChild(label)
        const input = document.createElement('input')
        input.setAttribute('type', 'checkbox')
        input.id = id
        this.#control.appendChild(input)
        return input
    }

    getControlInput(id: string): HTMLInputElement|null
    //================================================
    {
        return <HTMLInputElement>document.getElementById(id)
    }

    onAdd(_map: maplibregl.Map)
    //=========================
    {
        this.#container = document.createElement('div')
        this.#container.className = 'maplibregl-ctrl flatmap-control'
        this.#control = document.createElement('div')
        this.#control.className = 'flatmap-control-grid'

        this.#allCheckbox = this.addControlLine(`control-all-${this.#id}`, `ALL ${this.#name.toUpperCase()}:`, null, 'heading')
        const controlDetails = this.addControlDetails()
        this.#totalCount = controlDetails.total
        this.#halfCount = Math.trunc(this.#totalCount/2)
        this.#checkedCount = controlDetails.enabled
        this.#setAllCheckedState()

        /*
        const innerDetails = this.#innerLinesHTML()
        const innerHTML = innerDetails.html
        innerHTML.splice(0, 0, `<label for="control-all-${this.#id}">ALL ${this.#name.toUpperCase()}:</label><input id="control-all-${this.#id}" type="checkbox"/>`)
        this.#control.innerHTML = innerHTML.join('\n')

        this.#totalCount = innerHTML.length
        this.#halfCount = Math.trunc(this.#totalCount/2)
        this.#checkedCount = innerDetails.enabled
        this.#allCheckbox = document.getElementById(`control-all-${this.#id}`)
        this.#setAllCheckedState()
        */

        this.#button = document.createElement('button')
        this.#button.id = `flatmap-${this.#id}-button`
        this.#button.className = 'control-button text-button'
        this.#button.setAttribute('type', 'button')
        this.#button.setAttribute('aria-label', `Show/hide map's ${this.#name}`)
        this.#button.setAttribute('control-visible', 'false')
        this.#button.textContent = this.#name.toUpperCase().substring(0, 6)
        this.#button.title = `Show/hide map's ${this.#name}`
        this.#container.appendChild(this.#button)

        this.#container.addEventListener('click', this.#onClick.bind(this))
        return this.#container
    }

    onRemove()
    //========
    {
        this.#container.parentNode.removeChild(this.#container)
    }

    #onClick(event)
    //=============
    {
        if (event.target.id === `flatmap-${this.#id}-button`) {
            if (this.#button.getAttribute('control-visible') === 'false') {
                this.#container.appendChild(this.#control)
                this.#button.setAttribute('control-visible', 'true')
                this.#control.focus()
            } else {
                this.#control = this.#container.removeChild(this.#control)
                this.#button.setAttribute('control-visible', 'false')
            }
        } else if (event.target.tagName === 'INPUT') {
            if (event.target.id === `control-all-${this.#id}`) {
                if (event.target.indeterminate) {
                    event.target.checked = (this.#checkedCount >= this.#halfCount)
                    event.target.indeterminate = false
                }
                this.#checkedCount = event.target.checked ? this.#totalCount : 0
                this.enableAll(event.target.checked)
            } else if (event.target.id.startsWith(`${this.#id}-`)) {
                this.enableControl(event.target.id.substring(this.#prefix.length),
                                     event.target.checked)
                this.#checkedCount += (event.target.checked ? 1 : -1)
                this.#setAllCheckedState()
            }
        }
        event.stopPropagation()
    }

    #setAllCheckedState()
    //===================
    {
        if (this.#checkedCount === 0) {
            this.#allCheckbox.checked = false
            this.#allCheckbox.indeterminate = false
        } else if (this.#checkedCount === this.#totalCount) {
            this.#allCheckbox.checked = true
            this.#allCheckbox.indeterminate = false
        } else {
            this.#allCheckbox.indeterminate = true
        }
    }
}

//==============================================================================

export class NavigationControl
{
    #container: HTMLDivElement|null = null
    #flatmap: FlatMap

    constructor(flatmap: FlatMap)
    {
        this.#flatmap = flatmap
    }

    getDefaultPosition(): maplibregl.ControlPosition
    //==============================================
    {
        return 'top-right'
    }

    onAdd(_map: maplibregl.Map)
    //=========================
    {
        this.#container = document.createElement('div')
        this.#container.className = 'maplibregl-ctrl navigation-group'
        this.#container.innerHTML = `<button id="flatmap-zoom-in" class="navigation-zoom-in" type="button" title="Zoom in" aria-label="Zoom in"></button>
<button id="flatmap-zoom-out" class="navigation-zoom-out" type="button" title="Zoom out" aria-label="Zoom out"></button>
<button id="flatmap-reset" class="navigation-reset" type="button" title="Reset" aria-label="Reset"></button>`
        this.#container.onclick = this.#onClick.bind(this)
        return this.#container
    }

    onRemove()
    //========
    {
        this.#container.parentNode.removeChild(this.#container)
    }

    #onClick(e)
    //=========
    {
        if        (e.target.id === 'flatmap-zoom-in') {
            this.#flatmap.zoomIn()
        } else if (e.target.id === 'flatmap-zoom-out') {
            this.#flatmap.zoomOut()
        } else if (e.target.id === 'flatmap-reset') {
            this.#flatmap.resetMap()
        }
    }
}

//==============================================================================

export class LayerControl
{
    #button: HTMLButtonElement
    #checkedCount: number
    #container: HTMLDivElement|null = null
    #flatmap: FlatMap
    #halfCount: number
    #layers: FlatMapLayer[]
    #layersControl: HTMLDivElement
    #layersCount: number

    constructor(flatmap: FlatMap, layerManager: LayerManager)
    {
        this.#flatmap = flatmap
        this.#layers = layerManager.layers
    }

    getDefaultPosition(): maplibregl.ControlPosition
    //==============================================
    {
        return 'top-right'
    }

    onAdd(_map: maplibregl.Map)
    //=========================
    {
        this.#container = document.createElement('div')
        this.#container.className = 'maplibregl-ctrl flatmap-control'
        this.#layersControl = document.createElement('div')
        this.#layersControl.className = 'flatmap-control-grid'

        const innerHTML = []
        innerHTML.push(`<label for="layer-all-layers">ALL LAYERS:</label><input id="layer-all-layers" type="checkbox" checked/>`)
        for (const layer of this.#layers) {
            innerHTML.push(`<label for="layer-${layer.id}">${layer.description}</label><input id="layer-${layer.id}" type="checkbox" checked/>`)
        }
        this.#layersControl.innerHTML = innerHTML.join('\n')

        this.#layersCount = this.#layers.length
        this.#checkedCount = this.#layersCount
        this.#halfCount = Math.trunc(this.#checkedCount/2)

        this.#button = document.createElement('button')
        this.#button.id = 'map-layers-button'
        this.#button.className = 'control-button text-button'
        this.#button.setAttribute('type', 'button')
        this.#button.setAttribute('aria-label', 'Show/hide map layers')
        this.#button.setAttribute('control-visible', 'false')
        this.#button.textContent = 'LAYERS'
        this.#button.title = 'Show/hide map layers'
        this.#container.appendChild(this.#button)

        this.#container.addEventListener('click', this.#onClick.bind(this))
        return this.#container
    }

    onRemove()
    //========
    {
        this.#container.parentNode.removeChild(this.#container)
    }

    #onClick(event)
    //=============
    {
        if (event.target.id === 'map-layers-button') {
            if (this.#button.getAttribute('control-visible') === 'false') {
                this.#container.appendChild(this.#layersControl)
                this.#button.setAttribute('control-visible', 'true')
                this.#layersControl.focus()
            } else {
                this.#layersControl = this.#container.removeChild(this.#layersControl)
                this.#button.setAttribute('control-visible', 'false')
            }
        } else if (event.target.tagName === 'INPUT') {
            if (event.target.id === 'layer-all-layers') {
                if (event.target.indeterminate) {
                    event.target.checked = (this.#checkedCount >= this.#halfCount)
                    event.target.indeterminate = false
                }
                if (event.target.checked) {
                    this.#checkedCount = this.#layersCount
                } else {
                    this.#checkedCount = 0
                }
                for (const layer of this.#layers) {
                    const layerCheckbox = <HTMLInputElement>document.getElementById(`layer-${layer.id}`)
                    if (layerCheckbox) {
                        layerCheckbox.checked = event.target.checked
                        this.#flatmap.enableLayer(layer.id, event.target.checked)
                    }
                }
            } else if (event.target.id.startsWith('layer-')) {
                const layerId = event.target.id.substring(6)
                this.#flatmap.enableLayer(layerId, event.target.checked)
                if (event.target.checked) {
                    this.#checkedCount += 1
                } else {
                    this.#checkedCount -= 1
                }
                const allLayersCheckbox = <HTMLInputElement>document.getElementById('layer-all-layers')
                if (this.#checkedCount === 0) {
                    allLayersCheckbox.checked = false
                    allLayersCheckbox.indeterminate = false
                } else if (this.#checkedCount === this.#layersCount) {
                    allLayersCheckbox.checked = true
                    allLayersCheckbox.indeterminate = false
                } else {
                    allLayersCheckbox.indeterminate = true
                }
            }
        }
        event.stopPropagation()
    }
}

//==============================================================================
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
]

//==============================================================================

export class SCKANControl
{
    #button: HTMLButtonElement
    #checkedCount: number
    #container: HTMLDivElement|null = null
    #flatmap: FlatMap
    #halfCount: number
    #initialState: string
    #sckan: HTMLDivElement
    #sckanCount: number

    constructor(flatmap: FlatMap, options: FlatMapLayerOptions={sckan: 'valid'})
    {
        this.#flatmap = flatmap
        this.#initialState = <string>options.sckan || 'valid'
    }

    getDefaultPosition(): maplibregl.ControlPosition
    //==============================================
    {
        return 'top-right'
    }

    onAdd(_map: maplibregl.Map)
    //=========================
    {
        this.#container = document.createElement('div')
        this.#container.className = 'maplibregl-ctrl flatmap-control'
        this.#sckan = document.createElement('div')
        this.#sckan.className = 'flatmap-control-grid'

        const innerHTML = []
        let checked = (this.#initialState === 'all') ? 'checked' : ''
        innerHTML.push(`<label for="sckan-all-paths">ALL PATHS:</label><input id="sckan-all-paths" type="checkbox" ${checked}/>`)
        for (const state of SCKAN_STATES) {
            checked = (this.#initialState.toUpperCase() === state.id) ? 'checked' : ''
            innerHTML.push(`<label for="sckan-${state.id}">${state.description}</label><input id="sckan-${state.id}" type="checkbox" ${checked}/>`)
        }
        this.#sckan.innerHTML = innerHTML.join('\n')

        this.#sckanCount = SCKAN_STATES.length
        this.#checkedCount = (this.#initialState === 'all') ? this.#sckanCount
                            : (this.#initialState === 'none') ? 0
                            : 1
        this.#halfCount = Math.trunc(this.#sckanCount/2)

        this.#button = document.createElement('button')
        this.#button.id = 'map-sckan-button'
        this.#button.className = 'control-button text-button'
        this.#button.setAttribute('type', 'button')
        this.#button.setAttribute('aria-label', 'Show/hide valid SCKAN paths')
        this.#button.setAttribute('control-visible', 'false')
        this.#button.textContent = 'SCKAN'
        this.#button.title = 'Show/hide valid SCKAN paths'
        this.#container.appendChild(this.#button)

        this.#container.addEventListener('click', this.onClick_.bind(this))
        return this.#container
    }

    onRemove()
    //========
    {
        this.#container.parentNode.removeChild(this.#container)
    }

    onClick_(event)
    //=============
    {
        if (event.target.id === 'map-sckan-button') {
            if (this.#button.getAttribute('control-visible') === 'false') {
                this.#container.appendChild(this.#sckan)
                this.#button.setAttribute('control-visible', 'true')
                const allLayersCheckbox = <HTMLInputElement>document.getElementById('sckan-all-paths')
                allLayersCheckbox.indeterminate = (this.#checkedCount > 0)
                                               && (this.#checkedCount < this.#sckanCount)
                this.#sckan.focus()
            } else {
                this.#sckan = this.#container.removeChild(this.#sckan)
                this.#button.setAttribute('control-visible', 'false')
            }
        } else if (event.target.tagName === 'INPUT') {
            if (event.target.id === 'sckan-all-paths') {
                if (event.target.indeterminate) {
                    event.target.checked = (this.#checkedCount >= this.#halfCount)
                    event.target.indeterminate = false
                }
                if (event.target.checked) {
                    this.#checkedCount = this.#sckanCount
                } else {
                    this.#checkedCount = 0
                }
                for (const state of SCKAN_STATES) {
                    const sckanCheckbox = <HTMLInputElement>document.getElementById(`sckan-${state.id}`)
                    if (sckanCheckbox) {
                        sckanCheckbox.checked = event.target.checked
                        this.#flatmap.enableSckanPath(state.id, event.target.checked)
                    }
                }
            } else if (event.target.id.startsWith('sckan-')) {
                const sckanId = event.target.id.substring(6)
                this.#flatmap.enableSckanPath(sckanId, event.target.checked)
                if (event.target.checked) {
                    this.#checkedCount += 1
                } else {
                    this.#checkedCount -= 1
                }
                const allLayersCheckbox = <HTMLInputElement>document.getElementById('sckan-all-paths')
                if (this.#checkedCount === 0) {
                    allLayersCheckbox.checked = false
                    allLayersCheckbox.indeterminate = false
                } else if (this.#checkedCount === this.#sckanCount) {
                    allLayersCheckbox.checked = true
                    allLayersCheckbox.indeterminate = false
                } else {
                    allLayersCheckbox.indeterminate = true
                }
            }
        }
        event.stopPropagation()
    }
}

//==============================================================================

export class AnnotatorControl
{
    #button: HTMLButtonElement
    #container: HTMLDivElement|null = null
    #enabled = false
    #flatmap: FlatMap

    constructor(flatmap: FlatMap)
    {
        this.#flatmap = flatmap
    }

    getDefaultPosition(): maplibregl.ControlPosition
    //==============================================
    {
        return 'top-right'
    }

    onAdd(_map: maplibregl.Map)
    //=========================
    {
        this.#container = document.createElement('div')
        this.#container.className = 'maplibregl-ctrl'

        this.#button = document.createElement('button')
        this.#button.id = 'map-annotated-button'
        this.#button.className = 'control-button text-button'
        this.#button.setAttribute('type', 'button')
        this.#button.setAttribute('aria-label', 'Draw on map for annotation')
        this.#button.textContent = 'DRAW'
        this.#button.title = 'Draw on map for annotation'
        this.#container.appendChild(this.#button)

        this.#container.addEventListener('click', this.onClick_.bind(this))
        this.#setBackground()
        return this.#container
    }

    #setBackground()
    //==============
    {
        if (this.#enabled) {
            this.#button.setAttribute('style', 'background: red')
        } else {
            this.#button.removeAttribute('style')
        }
    }

    onRemove()
    //========
    {
        this.#container.parentNode.removeChild(this.#container)
    }

    onClick_(event)
    //=============
    {
        if (event.target.id === 'map-annotated-button') {
            this.#enabled = !this.#enabled
            this.#setBackground()
            this.#flatmap.showAnnotator(this.#enabled)
        }
        event.stopPropagation()
    }
}

//==============================================================================

export class BackgroundControl
{
    #colourDiv: HTMLDivElement|null = null
    #container: HTMLDivElement|null = null
    #flatmap: FlatMap

    constructor(flatmap: FlatMap)
    {
        this.#flatmap = flatmap
    }

    getDefaultPosition(): maplibregl.ControlPosition
    //==============================================
    {
        return 'bottom-right'
    }

    onAdd(_map: maplibregl.Map)
    //=========================
    {
        this.#container = document.createElement('div')
        this.#container.className = 'maplibregl-ctrl'
        this.#colourDiv = document.createElement('div')
        this.#colourDiv.setAttribute('aria-label', 'Change background colour')
        this.#colourDiv.title = 'Change background colour'
        const background = standardise_color(this.#flatmap.getBackgroundColour())
        this.#colourDiv.innerHTML = `<input type="color" id="colourPicker" value="${background}">`
        this.#container.appendChild(this.#colourDiv)
        this.#colourDiv.addEventListener('input', this.#updateColour.bind(this), false)
        this.#colourDiv.addEventListener('change', this.#updateColour.bind(this), false)
        return this.#container
    }

    onRemove()
    //========
    {
        this.#container.parentNode.removeChild(this.#container)
    }

    #updateColour(event)
    //==================
    {
        const colour = event.target.value
        this.#flatmap.setBackgroundColour(colour)
        this.#flatmap.controlEvent('change', 'background', colour)
        event.stopPropagation()
    }
}


export class ClosePaneControl
{
    #container: HTMLDivElement|null = null
    #flatmap: FlatMap

    constructor(flatmap: FlatMap)
    {
        this.#flatmap = flatmap
    }

    getDefaultPosition(): maplibregl.ControlPosition
    //==============================================
    {
        return 'top-left'
    }

    onAdd(_map: maplibregl.Map)
    //=========================
    {
        this.#container = document.createElement('div')
        this.#container.className = 'maplibregl-ctrl'

        const button = document.createElement('button')
        button.className = 'close-button'
        button.title = 'Close pane'
        button.setAttribute('aria-label', 'Close pane')
        // https://iconmonstr.com/x-mark-square-filled-svg/
        button.innerHTML = `<svg clip-rule="evenodd" fill-rule="evenodd" stroke-linejoin="round" stroke-miterlimit="2"
    viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="m21 3.998c0-.478-.379-1-1-1h-16c-.62 0-1 .519-1 1v16c0 .621.52 1 1 1h16c.478 0 1-.379 1-1zm-8.991 6.932
     2.717-2.718c.146-.146.338-.219.53-.219.405 0 .751.325.751.75 0 .193-.073.384-.219.531l-2.718 2.717 2.728
     2.728c.147.147.22.339.22.531 0 .427-.349.75-.75.75-.192 0-.384-.073-.531-.219l-2.728-2.728-2.728
     2.728c-.146.146-.339.219-.531.219-.401 0-.75-.323-.75-.75 0-.192.073-.384.22-.531l2.728-2.728-2.722-2.722c-.146-.147-.219-.338-.219-.531
     0-.425.346-.749.75-.749.192 0 .384.073.53.219z" fill-rule="nonzero"/></svg>`
        this.#container.appendChild(button)

        button.addEventListener('click', (event) => {
            event.stopPropagation()
            this.#flatmap.closePane()
        })
        return this.#container
    }

    onRemove()
    //========
    {
        this.#container.parentNode.removeChild(this.#container)
    }
}

//==============================================================================
