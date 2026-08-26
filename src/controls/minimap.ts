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

/* Based on https://github.com/aesqe/maplibre-minimap
 *
 * MIT License
 *
 * Copyright (c) 2019 Bruno Babic
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

//==============================================================================

import maplibregl from 'maplibre-gl'

//==============================================================================

import {FlatMap} from '../flatmap'
import type { MinimapOptions } from '../flatmap-types'

//==============================================================================

type OPTIONS_TYPE = {
    fillColor: string
    fillOpacity: number
    lineColor: string
    lineOpacity: number
    lineWidth: number
    position: maplibregl.ControlPosition
    width: string|number
}

const DEFAULT_OPTIONS: OPTIONS_TYPE = {
    fillColor: '#DDD',
    fillOpacity: 0.3,
    lineColor: "#08F",
    lineOpacity: 1,
    lineWidth: 1,
    position: 'bottom-left',
    width: 320
}

//==============================================================================

// if parent map zoom >= 18 and minimap zoom >= 14, set minimap zoom to 16

const ZOOMLEVELS = [
    [18, 14, 16],
    [16, 12, 14],
    [14, 10, 12],
    [12,  8, 10],
    [10,  6,  8]
]

//==============================================================================

export class MinimapControl
{
    #container: HTMLElement|null = null
    #flatmap: FlatMap
    #map: maplibregl.Map|null = null
    #miniMap: maplibregl.Map|null = null
    #miniMapCanvas: HTMLElement
    #options: OPTIONS_TYPE
    #styleSpecification: maplibregl.StyleSpecification

    #background: string|null = null
    #opacity: number = 1
    #loaded: boolean = false

    #isDragging: boolean = false
    #isCursorOverFeature: boolean = false
    #previousPoint: [number, number] = [0, 0]
    #currentPoint: [number, number] = [0, 0]
    #trackingRect: maplibregl.GeoJSONSource
    #trackingRectCoordinates: [[[number, number], [number, number], [number, number], [number, number], [number, number]]]
        = [[[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]]]
    #updateHandler = null

    constructor(flatmap: FlatMap, options: MinimapOptions, styleSpecification: maplibregl.StyleSpecification)
    {
        this.#flatmap = flatmap
        this.#styleSpecification = styleSpecification

        // Should check user configurable settings
        this.#options = Object.assign({}, DEFAULT_OPTIONS, options)
    }

    getDefaultPosition(): maplibregl.ControlPosition
    //==============================================
    {
        return this.#options.position
    }

    onAdd(map: maplibregl.Map)
    //========================
    {
        this.#map = map

        // Create the container element

        const container = document.createElement('div')
        container.className = 'maplibregl-ctrl-minimap maplibregl-ctrl'
        container.id = 'maplibre-minimap'
        this.#container = container

        // Set the size of the container

        const mapCanvasElement = map.getCanvas()
        let width: number
        if (typeof this.#options.width === 'string') {
            width = parseInt(this.#options.width)
            if (this.#options.width.includes('%')) {
                width = width*mapCanvasElement.width/100
            }
        } else if (typeof this.#options.width === 'number') {
            width = this.#options.width
        }
        container.setAttribute('style', `width: ${width}px; height: ${width*mapCanvasElement.height/mapCanvasElement.width}px;`)

        // Ignore context menu events

        container.addEventListener('contextmenu', this.#preventDefault)

        // Create the actual minimap

        this.#miniMap = new maplibregl.Map({
            attributionControl: false,
            container: container,
            style: this.#styleSpecification,
            bounds: map.getBounds()
        })
        this.#container.hidden = true
        return this.#container
    }

    onRemove()
    //========
    {
        this.#container.parentNode.removeChild(this.#container)
        this.#loaded = false
        this.#map.off('move', this.#updateHandler)
        this.#map = null
        this.#miniMap.remove()
        this.#miniMap = null
        this.#container = null
    }


    initialise()
    //==========
    {
        // Wait until styles etc have loaded before completing initialisation
        const loadSubscription = this.#miniMap.on('load', async() => {
            this.#initialise()
            loadSubscription.unsubscribe()
        })
    }

    #initialise()
    //===========
    {
        const opts = this.#options
        const parentMap = this.#map
        const miniMap = this.#miniMap
        this.#container.hidden = false

        // Disable most user interactions with the minimap

        const interactions = [
            'dragPan', 'scrollZoom', 'boxZoom', 'dragRotate',
            'keyboard', 'doubleClickZoom', 'touchZoomRotate'
        ]
        interactions.forEach(i => miniMap[i].disable())

        // Set background if specified (default is the parent map's)

        if (this.#background !== null) {
            miniMap.setPaintProperty('background', 'background-color', this.#background)
        }
        if (this.#opacity !== null) {
            miniMap.setPaintProperty('background', 'background-opacity', this.#opacity)
        }

        // Fit minimap to its container

        miniMap.resize()
        miniMap.fitBounds(this.#flatmap.bounds)

        const bounds = miniMap.getBounds()
        this.#convertBoundsToPoints(bounds)

        miniMap.addSource('trackingRect', {
            'type': 'geojson',
            'data': {
                'type': 'Feature',
                'properties': {
                    'name': 'trackingRect'
                },
                'geometry': {
                    'type': 'Polygon',
                    'coordinates': this.#trackingRectCoordinates
                }
            }
        })

        miniMap.addLayer({
            'id': 'trackingRectOutline',
            'type': 'line',
            'source': 'trackingRect',
            'layout': {},
            'paint': {
                'line-color': opts.lineColor,
                'line-width': opts.lineWidth,
                'line-opacity': opts.lineOpacity
            }
        })

        // needed for dragging
        miniMap.addLayer({
            'id': 'trackingRectFill',
            'type': 'fill',
            'source': 'trackingRect',
            'layout': {},
            'paint': {
                'fill-color': opts.fillColor,
                'fill-opacity': opts.fillOpacity
            }
        })

        this.#trackingRect = this.#miniMap.getSource('trackingRect')

        this.#update()
        this.#updateHandler = this.#update.bind(this)
        parentMap.on('move', this.#updateHandler)

        miniMap.on('mousemove', this.#mouseMove.bind(this))
        miniMap.on('mousedown', this.#mouseDown.bind(this))
        miniMap.on('mouseup', this.#mouseUp.bind(this))

        miniMap.on('touchmove', this.#mouseMove.bind(this))
        miniMap.on('touchstart', this.#mouseDown.bind(this))
        miniMap.on('touchend', this.#mouseUp.bind(this))

        this.#miniMapCanvas = miniMap.getCanvasContainer()
        this.#miniMapCanvas.addEventListener('wheel', this.#preventDefault)
        this.#miniMapCanvas.addEventListener('mousewheel', this.#preventDefault)

        this.#loaded = true
    }

    #mouseDown(e: maplibregl.MapMouseEvent)
    //=====================================
    {
        if (this.#isCursorOverFeature) {
            this.#isDragging = true
            this.#previousPoint = this.#currentPoint
            this.#currentPoint = [e.lngLat.lng, e.lngLat.lat]
        }
    }

    #mouseMove(e: maplibregl.MapMouseEvent)
    //=====================================
    {
        const miniMap = this.#miniMap
        const features = miniMap.queryRenderedFeatures(e.point, {
            layers: ['trackingRectFill']
        })

        // don't update if we're still hovering the area
        if (!(this.#isCursorOverFeature && features.length > 0)) {
            this.#isCursorOverFeature = features.length > 0
            this.#miniMapCanvas.style.cursor = this.#isCursorOverFeature ? 'move' : ''
        }

        if (this.#isDragging) {
            this.#previousPoint = this.#currentPoint
            this.#currentPoint = [e.lngLat.lng, e.lngLat.lat]

            const offset:[number, number] = [
                this.#previousPoint[0] - this.#currentPoint[0],
                this.#previousPoint[1] - this.#currentPoint[1]
            ]

            const newBounds = this.#moveTrackingRect(offset)

            this.#map.fitBounds(newBounds, {
                duration: 80
            })
        }
    }

    #mouseUp()
    //========
    {
        this.#isDragging = false
    }

    #moveTrackingRect(offset: [number, number])
    //=========================================
    {
        const source = this.#trackingRect
        const data = source._data as GeoJSON.Feature
        const bounds = data.properties.bounds

        bounds._ne.lat -= offset[1]
        bounds._ne.lng -= offset[0]
        bounds._sw.lat -= offset[1]
        bounds._sw.lng -= offset[0]

        this.#convertBoundsToPoints(bounds)
        source.setData(data)

        return bounds
    }

    #setTrackingRectBounds(bounds: maplibregl.LngLatBounds)
    //=====================================================
    {
        const source = this.#trackingRect
        const data = source._data as GeoJSON.Feature

        data.properties.bounds = bounds
        this.#convertBoundsToPoints(bounds)
        source.setData(data)
    }

    #convertBoundsToPoints(bounds: maplibregl.LngLatBounds)
    //=====================================================
    {
        const ne = bounds._ne
        const sw = bounds._sw
        const trc = this.#trackingRectCoordinates

        trc[0][0][0] = ne.lng
        trc[0][0][1] = ne.lat
        trc[0][1][0] = sw.lng
        trc[0][1][1] = ne.lat
        trc[0][2][0] = sw.lng
        trc[0][2][1] = sw.lat
        trc[0][3][0] = ne.lng
        trc[0][3][1] = sw.lat
        trc[0][4][0] = ne.lng
        trc[0][4][1] = ne.lat
    }

    #update()
    //=======
    {
        if (this.#isDragging) {
            return
        }

        const parentBounds = this.#map.getBounds()
        this.#setTrackingRectBounds(parentBounds)

        this.#zoomAdjust()
    }

    #zoomAdjust()
    //===========
    {
        const miniMap = this.#miniMap
        const parentMap = this.#map
        const miniZoom = miniMap.getZoom()
        const parentZoom = parentMap.getZoom()
        let found = false

        ZOOMLEVELS.forEach(function(zoom) {
            if (!found && parentZoom >= zoom[0]) {
                if (miniZoom >= zoom[1]) {
                    miniMap.setZoom(zoom[2])
                }

                miniMap.setCenter(parentMap.getCenter())
                found = true
            }
        })
    }

    #preventDefault(e)
    //================
    {
        e.preventDefault()
    }

    /**
     * Sets the minimap's background colour.
     *
     * @param      {string}  colour  The colour
     */
    setBackgroundColour(colour: string)
    //=================================
    {
        if (this.#loaded) {
            this.#miniMap.setPaintProperty('background', 'background-color', colour)
        } else {
            this.#background = colour
        }
    }

    /**
     * Sets the minimap's background opacity.
     *
     * @param      {number}  opacity  The opacity
     */
    setBackgroundOpacity(opacity: number)
    //===================================
    {
        if (this.#loaded) {
            this.#miniMap.setPaintProperty('background', 'background-opacity', opacity)
        } else {
            this.#opacity = opacity
        }
    }

    /**
     * Show and hide the minimap.
     *
     * @param {boolean}  showMinimap  Set false to hide minimap
     */
    show(showMinimap: boolean)
    //========================
    {
        if (this.#container) {
            if (showMinimap) {
                this.#container.style.display = "block"
                this.#update()
            } else {
                this.#container.style.display = "none"
            }
        }
    }
}
