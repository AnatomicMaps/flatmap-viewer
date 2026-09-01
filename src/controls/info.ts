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
import { indexedProperties } from '../search'

//==============================================================================

export const displayedProperties = [
//    'id',
    'class',
    'name',
    ...indexedProperties,
    'featureId',

// Maybe have an developer mode/option to include these??
    'shape-type',
    'geom-type',
    'area',
    'aspect',
    'coverage',
    'bbox-coverage',

    'left',
    'right',
    'baseline',
    'metric-bounds'
]

//==============================================================================

export class InfoDisplay
{
    #container: HTMLDivElement|null = null

    getDefaultPosition(): maplibregl.ControlPosition
    //==============================================
    {
        return 'top-left'
    }

    onAdd(_map: maplibregl.Map)
    //=========================
    {
        this.#container = document.createElement('div')
        this.#container.className = 'maplibregl-ctrl info-display'
        return this.#container
    }

    onRemove()
    //========
    {
        if (this.#container) {
            this.#container.parentNode.removeChild(this.#container)
        }
        this.#container = null
    }

    show(html: string)
    //================
    {
        if (this.#container) {
            this.#container.innerHTML = html
        }

    }
}

//==============================================================================

export class InfoControl
{
    #active: boolean = false
    #container: HTMLDivElement|null = null
    #flatmap: FlatMap
    #infoDisplay: InfoDisplay = new InfoDisplay()
    #map: maplibregl.Map|null = null

    constructor(flatmap: FlatMap)
    {
        this.#flatmap = flatmap
    }

    get active()
    //==========
    {
        return this.#active
    }

    getDefaultPosition(): maplibregl.ControlPosition
    //===============================================
    {
        return 'top-right'
    }

    onAdd(map: maplibregl.Map)
    //========================
    {
        this.#map = map
        this.#container = document.createElement('div')
        this.#container.className = 'maplibregl-ctrl info-control'
        // https://iconmonstr.com/info-6-svg/
        this.#container.innerHTML = `<button class="control-button" id="info-control-button"
                                      type="button" title="Show annotation" aria-label="Show annotation">
     <svg xmlns="http://www.w3.org/2000/svg" id="info-control-icon" viewBox="0 0 24 24">
       <path d="M12 2c5.514 0 10 4.486 10 10s-4.486 10-10 10-10-4.486-10-10 4.486-10 10-10zm0-2c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12-5.373-12-12-12zm-.001 5.75c.69 0 1.251.56 1.251 1.25s-.561 1.25-1.251 1.25-1.249-.56-1.249-1.25.559-1.25 1.249-1.25zm2.001 12.25h-4v-1c.484-.179 1-.201 1-.735v-4.467c0-.534-.516-.618-1-.797v-1h3v6.265c0 .535.517.558 1 .735v.999z"/>
     </svg>
    </button>`
        this.#container.onclick = this.onClick_.bind(this)
        this.#map.addControl(this.#infoDisplay)
        return this.#container
    }

    onRemove()
    //========
    {
        if (this.#map) {
            this.#map.removeControl(this.#infoDisplay)
        }
        this.#container.parentNode.removeChild(this.#container)
        this.#map = null
    }

    onClick_(e)
    //=========
    {
        const targetId = ('rangeTarget' in e) ? e.rangeTarget.id : e.target.id // FF has rangeTarget
        if (['info-control-button', 'info-control-icon'].includes(targetId)) {
            const button = document.getElementById('info-control-button')
            if (!this.#active) {
                this.#active = true
                button.classList.add('control-button-active')
            } else {
                this.reset()
                this.#active = false
                button.classList.remove('control-button-active')
            }
        }
    }

    featureInformation(features, _location)
    //=====================================
    {
        // Get all features if the control is active otherwise just the selected ones

        const featureList = (this.#active || this.#flatmap.options.debug) ? features
                            : features.filter(feature => this.#map.getFeatureState(feature).selected)

        if (featureList.length === 0) {
            return ''
        }

        let html = ''
        if (this.#flatmap.options.debug) {
            // See example at https://maplibre.org/maplibre-gl-js-docs/example/queryrenderedfeatures/

            // Limit the number of properties we're displaying for
            // legibility and performance
            const displayProperties = [
                'id',
                'type',
                'properties',
//                'layer' //,
                //'source',
                //'sourceLayer',
                //'state'
            ]

            const propertiesProperties = [
                'id',
                'class',
                'label',
                'models',
//                'area',
//                'length',
//                'group',
                'neuron',
                'type'
            ]

            const layerProperties = [
                'id',
                'type',
                'filter'
            ]

            // Do we filter for smallest properties.area (except lines have area == 0)
            // with lines having precedence... ??
            const featureIds = []
            const displayFeatures = []
            for (const feat of featureList) {
                if (!featureIds.includes(feat.id)) {
                    featureIds.push(feat.id)
                    const displayFeat = {}
                    displayProperties.forEach(prop => {
                        if (prop === 'properties') {
                            const properties = feat[prop]
                            const propertiesProps = {}
                            propertiesProperties.forEach(prop => {
                                propertiesProps[prop] = properties[prop]
                            })
                            displayFeat[prop] = propertiesProps
                        } else if (prop === 'layer') {
                            const layer = feat[prop]
                            const layerProps = {}
                            layerProperties.forEach(prop => {
                                layerProps[prop] = layer[prop]
                            })
                            displayFeat[prop] = layerProps
                        } else {
                            displayFeat[prop] = feat[prop]
                        }
                    })
                    displayFeatures.push(displayFeat)
                }
            }
            const content = JSON.stringify(
                displayFeatures,
                null,
                2
            )
            // Only if this.#flatmap.options.showPosition ??
            // html = `<pre class="info-control-features">${JSON.stringify(location)}\n${content}</pre>`
            html = `<pre class="info-control-features">${content}</pre>`
        } else {
            const displayValues = new Map()
            for (const feature of featureList) {
                if (!displayValues.has(feature.id)) {
                    const values = {}
                    displayedProperties.forEach(prop => {
                        if (prop in feature.properties) {
                            const value = feature.properties[prop]
                            if (value) {
                                if (prop === 'label') {
                                    values[prop] = value.replaceAll("\n", "<br/>")
                                } else {
                                    values[prop] = value
                                }
                            }
                        }
                    })
                    if (Object.keys(values).length > 0) {
                        displayValues.set(feature.id, values)
                    }
                break    // Properties of only the innermost feature (when an `allProperties` option??)
                }
            }

            const htmlList = []
            let lastId = null
            for (const [id, values] of displayValues.entries()) {
                if (lastId !== null && lastId !== id) {
                    htmlList.push(`<span><hr/></span><span></span>`)
                }
                for (const prop of displayedProperties) {
                    if (prop in values) {
                        htmlList.push(`<span class="info-name">${prop}:</span>`)
                        htmlList.push(`<span class="info-value">${values[prop]}</span>`)
                    }
                }
                lastId = id
            }
            if (htmlList.length > 0) {
                html = `<div id="info-control-info">${htmlList.join('\n')}</div>`
            }
        }
        return html
    }

    reset()
    //=====
    {
        this.#infoDisplay.show('')
    }

    show(html: string)
    //================
    {
        this.#infoDisplay.show(html)
    }
}

//==============================================================================
