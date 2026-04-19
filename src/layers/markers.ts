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

import type {GeoJSONSource, Map as MapLibreMap} from 'maplibre-gl'

//==============================================================================

import type {FlatMap} from '../flatmap'
import type {FlatMapFeatureAnnotation, FlatMapMarkerOptions, GeoJSONId} from '../flatmap-types'
import type {UserInteractions} from '../interactions'
import {DATASET_CLUSTERED_MARKER, UNCLUSTERED_MARKER,
        MULTISCALE_CLUSTERED_MARKER, MULTISCALE_MARKER} from '../markers'
import type {PropertiesType} from '../types'

import { markerZoomScaling } from './styling'

//==============================================================================

type MarkerProperties = {
    cluster: boolean
    count: number
    'details-layer'?: string
    featureId: GeoJSONId
    hidden?: boolean
    'icon-image': [string, string]
    kind?: string
    label?: string
    layer?: string
    marker: boolean
    models: string
    hyperlinks?: object
}

interface MarkerPoint
{
    type: string
    id: number
    properties: MarkerProperties
    geometry: GeoJSON.Point
}

//==============================================================================

export class MarkerLayer
{
    #featureIndexById: Map<number, number> = new Map()
    #featureToMarkerPoint: Map<number, MarkerPoint> = new Map()
    #id: string
    #map: MapLibreMap
    #points: GeoJSON.FeatureCollection = {
       type: 'FeatureCollection',
       features: []
    }
    #source: string
    #ui: UserInteractions

    constructor(flatmap: FlatMap, ui: UserInteractions, layerId: string)
    {
        this.#map = flatmap.map
        this.#ui = ui
        this.#id = `${layerId}-markers-layer`
        this.#source = `${layerId}-markers-source`

        this.#map.addSource(this.#source, {
            type: 'geojson',
            data: this.#points
        })
        this.#map.addLayer({
            id: this.#id,
            type: 'symbol',
            source: this.#source,
            filter: ['any',
                ['!', ['get', 'cluster']],
                ['>=', ['zoom'], 4]
            ],
            layout: {
                'icon-image': [
                    'let', 'index',  ['case',
                                        ['get', 'cluster'], 1,
                                        ['>', ['get', 'count'], 1], 1,
                                    0],
                    ['to-string', ['at', ['var', 'index'], ['get', 'icon-image']]]
                ],
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                'icon-offset': [0, -30],
                'icon-size': markerZoomScaling(0.2),
                'text-field': ['case',
                                    ['get', 'cluster'], ['get', 'count'],
                                    ['>', ['get', 'count'], 1], ['get', 'count'],
                                ''],
                'text-size': markerZoomScaling(10),
                'text-offset': [0, -0.71],
                'text-allow-overlap': true,
                'text-ignore-placement': true,
            },
            paint: {
                'icon-opacity': ['case', ['boolean', ['get', 'hidden'], false], 0, 0.8],
                'text-opacity': ['case', ['boolean', ['get', 'hidden'], false], 0, 0.8]
            }
        })
    }

    get id()
    //======
    {
        return this.#id
    }

    #showPoints()
    //===========
    {
        const source = this.#map.getSource(this.#source) as GeoJSONSource
        source.setData(this.#points)
    }

    addMarker(annotation: FlatMapFeatureAnnotation, options: FlatMapMarkerOptions, cluster: boolean=false): GeoJSONId|null
    //====================================================================================================================
    {
        const markerPosition = this.#ui.markerPosition(annotation)
        if (markerPosition === null || annotation.centreline) {
            return null
        }
        const featureId = +annotation.featureId
        const markerId = this.#ui.nextMarkerId()
        const markerPoint: MarkerPoint = {
            type: 'Feature',
            id: markerId,
            properties: {
                featureId,
                'icon-image': (options.kind === 'multiscale')
                              ? [MULTISCALE_MARKER, MULTISCALE_CLUSTERED_MARKER]
                              : [UNCLUSTERED_MARKER, DATASET_CLUSTERED_MARKER],
                count: 1,
                cluster,
                label: annotation.label,
                marker: true,
                models: annotation.models,
                hyperlinks: annotation.hyperlinks
            },
            geometry: {
                type: 'Point',
                coordinates: markerPosition
            } as GeoJSON.Point
        }

        const markerState = this.#ui.getFeatureState(featureId)
        if (markerState && 'hidden' in markerState) {
            markerPoint.properties['hidden'] = markerState.hidden
        }
        if ('details-layer' in annotation) {
            markerPoint.properties['details-layer'] = annotation['details-layer']
        }
        if (annotation.kind) {
            markerPoint.properties.kind = annotation.kind
        }
        if (annotation.layer) {
            markerPoint.properties.layer = annotation.layer
        }
        this.#featureToMarkerPoint.set(featureId, markerPoint)
        this.#featureIndexById.set(markerId, this.#points.features.length)
        this.#points.features.push(markerPoint as GeoJSON.Feature<GeoJSON.Point, GeoJSON.GeoJsonProperties>)
        this.#showPoints()
        return markerId
    }

    updateMarkerCount(markerId: number)
    //=================================
    {
        if (this.#featureIndexById.has(markerId)) {
            const featureIndex = this.#featureIndexById.get(markerId)
            this.#points.features[featureIndex].properties.count += 1
            this.#showPoints()
        }
    }

    clearMarkers()
    //============
    {
        this.#featureIndexById.clear()
        this.#points.features.length = 0
        this.#showPoints()
    }

    removeMarker(markerId: number)
    //=============================
    {
        if (this.#featureIndexById.has(markerId)) {
            const featureIndex = this.#featureIndexById.get(markerId)
            this.#featureIndexById.delete(markerId)
            this.#points.features.splice(featureIndex, 0)
            this.#showPoints()
        }
    }

    removeFeatureState(featureId: GeoJSONId, key: string)
    //===================================================
    {
        if (key === 'hidden') {
            if (this.#featureToMarkerPoint.has(+featureId)) {
                const markerPoint = this.#featureToMarkerPoint.get(+featureId)
                if (markerPoint && 'hidden' in markerPoint.properties) {
                    delete markerPoint.properties.hidden
                    this.#showPoints()
                }
            }
        }
    }

    setFeatureState(featureId: GeoJSONId, state: PropertiesType)
    //==========================================================
    {
        if ('hidden' in state) {
            if (this.#featureToMarkerPoint.has(+featureId)) {
                const markerPoint = this.#featureToMarkerPoint.get(+featureId)
                if (markerPoint) {
                    markerPoint.properties.hidden = !!state.hidden
                    this.#showPoints()
                }
            }
        }
    }
}

//==============================================================================
