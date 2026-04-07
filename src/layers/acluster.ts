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

import type {
    DataDrivenPropertyValueSpecification,
    GeoJSONSource,
    Map as MapLibreMap
} from 'maplibre-gl'

//==============================================================================

import type {FlatMap} from '../flatmap'
import type {DatasetMarkerResult, DatasetTerms, MarkerKind} from '../flatmap-types'
import type {GeoJSONId} from '../flatmap-types'
import type {UserInteractions} from '../interactions'
import {DATASET_CLUSTERED_MARKER, MULTISCALE_CLUSTERED_MARKER} from '../markers'
import type {PropertiesType} from '../types'

import {DatasetClusterSet, MAX_MARKER_ZOOM} from './datasetcluster'

//==============================================================================

export const ANATOMICAL_MARKERS_LAYER = 'anatomical-markers-layer'
const ANATOMICAL_MARKERS_SOURCE = 'anatomical-markers-source'

//==============================================================================

type Term = string | number | Term[]

//==============================================================================

function zoomCountText(maxZoom: number)
{
    const expr: Term[] = ['step', ['zoom']]
    for (let z = 0; z <= maxZoom; z += 1) {
        if (z > 0) {
            expr.push(z)
        }
        expr.push(['to-string', ['at', z, ['get', 'zoom-count']]])
    }
    return expr as DataDrivenPropertyValueSpecification<string>
}

function zoomCountIcon(maxZoom: number)
{
    const expr: Term[] = ['step', ['zoom']]
    for (let z = 0; z <= maxZoom; z += 1) {
        if (z > 0) {
            expr.push(z)
        }
        expr.push(['to-string', ['at', z, ['get','icon-zoom']]])
    }
    return expr as DataDrivenPropertyValueSpecification<string>
}

//==============================================================================

type MarkerProperties = {
    featureId: GeoJSONId
    hidden?: boolean
    'icon-zoom': string[]
    label?: string
    models: string
    'zoom-count': number[]
}

interface MarkerPoint
{
    type: string
    id: number
    properties: MarkerProperties
    geometry: GeoJSON.Point
}

//==============================================================================

export class ClusteredAnatomicalMarkerLayer
{
    #datasetFeatureIds: Map<string, Set<number>> = new Map()
    #datasetsByZoomTerm: Map<string, Set<string>[]> = new Map()
    #featureToMarkerPoint: Map<number, MarkerPoint> = new Map()
    #featureToTerm: Map<number, string> = new Map()
    #flatmap: FlatMap
    #kindByDataset: Map<string, MarkerKind> = new Map()
    #kindByTerm: Map<string, MarkerKind> = new Map()
    #map: MapLibreMap
    #markerTerms: Map<string, Set<string>> = new Map()
    #datasetTermsByZoomTerm: Map<string, Set<string>[]> = new Map()
    #multiScaleByZoomTerm: Map<string, boolean[]> = new Map()
    #maxZoom: number
    #points: GeoJSON.FeatureCollection = {
       type: 'FeatureCollection',
       features: []
    }
    #ui: UserInteractions

    constructor(flatmap: FlatMap, ui: UserInteractions)
    {
        this.#ui = ui
        this.#flatmap = flatmap
        this.#map = flatmap.map
        this.#maxZoom = Math.ceil(this.#map.getMaxZoom())

        this.#map.addSource(ANATOMICAL_MARKERS_SOURCE, {
            type: 'geojson',
            data: this.#points
        })
        this.#map.addLayer({
            id: ANATOMICAL_MARKERS_LAYER,
            type: 'symbol',
            source: ANATOMICAL_MARKERS_SOURCE,
            filter: ['let', 'index', ['min', ['floor', ['zoom']], this.#maxZoom-1],
                        ['>', ['at', ['var', 'index'], ['get', 'zoom-count']], 0]
                    ],
            layout: {
                'icon-image': zoomCountIcon(this.#maxZoom),
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                'icon-offset': [0, -17],
                'icon-size': 0.8,
                'text-field': zoomCountText(this.#maxZoom),
                'text-size': 10,
                'text-offset': [0, -1.93],
                'text-allow-overlap': true,
                'text-ignore-placement': true,
            },
            paint: {
                'icon-opacity': ['case', ['boolean', ['get', 'hidden'], false], 0, 1],
                'text-opacity': ['case', ['boolean', ['get', 'hidden'], false], 0, 1]
            }
        })
    }

    datasetTerms(term: string): DatasetMarkerResult[]
    //===============================================
    {
        const zoomLevel = Math.floor(this.#map.getZoom())
        const terms = [...(this.#datasetTermsByZoomTerm.get(term)[zoomLevel] || []).values()]
        return terms.map(term => {
            const result: DatasetMarkerResult = {
                term,
                kind: this.#kindByTerm.get(term) || 'dataset'
            }
            const termFeatures = this.#flatmap.modelFeatureIds(term)
            if (termFeatures.length) {
                const annotation = this.#flatmap.annotation(termFeatures[0])
                if (annotation && 'label' in annotation) {
                    result.label = annotation.label
                }
            }
            return result
        })
    }

    #showPoints()
    //===========
    {
        const source = this.#map.getSource(ANATOMICAL_MARKERS_SOURCE) as GeoJSONSource
        source.setData(this.#points)
    }

    #update()
    //=======
    {
        const markerPoints: MarkerPoint[] = []
        this.#featureToTerm.clear()
        this.#datasetsByZoomTerm.forEach((zoomDatasets, term) => {
            const countByZoom: number[] = zoomDatasets.map(dsIds => dsIds.size)
            for (const featureId of this.#flatmap.modelFeatureIds(term)) {
                const annotation = this.#flatmap.annotation(featureId)
                if (!annotation
                 || annotation.centreline
                 || !('markerPosition' in annotation) && !annotation.geometry.includes('Polygon')) {
                    continue
                }
                const markerId = this.#ui.nextMarkerId()
                const markerPosition = this.#ui.markerPosition(annotation)
                const markerPoint: MarkerPoint = {
                    type: 'Feature',
                    id: markerId,
                    properties: {
                        featureId,
                        'icon-zoom': this.#multiScaleByZoomTerm.get(term).map(ms => ms ? MULTISCALE_CLUSTERED_MARKER : DATASET_CLUSTERED_MARKER),
                        label: annotation.label,
                        models: term,
                        'zoom-count': countByZoom
                    },
                    geometry: {
                        type: 'Point',
                        coordinates: markerPosition
                    } as GeoJSON.Point
                }
                const markerState = this.#ui.getFeatureState(featureId)
                if (markerState && 'hidden' in markerState) {
                    markerPoint.properties.hidden = markerState.hidden
                }
                markerPoints.push(markerPoint)
                this.#featureToTerm.set(+featureId, term)
            }
        })
        this.#points.features = (markerPoints as GeoJSON.Feature<GeoJSON.Point, GeoJSON.GeoJsonProperties>[])
        this.#showPoints()
    }

    addDatasetMarkers(datasets: DatasetTerms[]): DatasetTerms[]
    //=========================================================
    {
        const mapDatasetMarkers: DatasetTerms[] = []

        for (const dataset of datasets) {
            if (dataset.terms.length) {
                const clusteredSet = new DatasetClusterSet(dataset, this.#flatmap)
                mapDatasetMarkers.push({
                    id: dataset.id,
                    terms: clusteredSet.markerTerms
                })
                if (dataset.kind) {
                    this.#kindByDataset.set(dataset.id, dataset.kind)
                }
                for (const cluster of clusteredSet.clusters) {
                    let zoomDatasets = this.#datasetsByZoomTerm.get(cluster.markerTerm)
                    let zoomMultiscale = this.#multiScaleByZoomTerm.get(cluster.markerTerm)
                    let zoomDatasetTerms = this.#datasetTermsByZoomTerm.get(cluster.markerTerm)
                    if (!zoomDatasets) {
                        zoomDatasets = []
                        zoomMultiscale = []
                        zoomDatasetTerms = []
                        for (let n = 0; n <= MAX_MARKER_ZOOM; n +=1) {
                            zoomDatasets.push(new Set<string>())
                            zoomMultiscale.push(false)
                            zoomDatasetTerms.push(new Set<string>())
                        }
                        this.#datasetsByZoomTerm.set(cluster.markerTerm, zoomDatasets)
                        this.#multiScaleByZoomTerm.set(cluster.markerTerm, zoomMultiscale)
                        this.#datasetTermsByZoomTerm.set(cluster.markerTerm, zoomDatasetTerms)
                    }
                    for (let zoom = cluster.minZoom; zoom < cluster.maxZoom; zoom += 1) {
                        zoomDatasets[zoom].add(cluster.datasetId)
                        zoomMultiscale[zoom] ||= (this.#kindByDataset.get(cluster.datasetId) === 'multiscale')
                        const datasetTerms = clusteredSet.descendents.get(cluster.markerTerm)
                        if (datasetTerms) {
                            for (const term of datasetTerms.values()) {
                                zoomDatasetTerms[zoom].add(term)
                            }
                        }
                    }
                    if (cluster.maxZoom === MAX_MARKER_ZOOM) {
                        zoomDatasets[MAX_MARKER_ZOOM].add(cluster.datasetId)
                        zoomMultiscale[MAX_MARKER_ZOOM] ||= (this.#kindByDataset.get(cluster.datasetId) === 'multiscale')
                        const datasetTerms = clusteredSet.descendents.get(cluster.markerTerm)
                        if (datasetTerms) {
                            for (const term of datasetTerms.values()) {
                                zoomDatasetTerms[MAX_MARKER_ZOOM].add(term)
                            }
                        }
                        let datasetFeatureIds = this.#datasetFeatureIds.get(cluster.datasetId)
                        if (!datasetFeatureIds) {
                            datasetFeatureIds = new Set()
                            this.#datasetFeatureIds.set(cluster.datasetId, datasetFeatureIds)
                        }
                        for (const featureId of this.#flatmap.modelFeatureIds(cluster.markerTerm)) {
                            datasetFeatureIds.add(+featureId)
                        }
                    }
                }
                for (const [term, datasetTerms] of clusteredSet.descendents.entries()) {
                    if (!this.#markerTerms.has(term)) {
                        this.#markerTerms.set(term, new Set())
                    }
                    for (const datasetTerm of datasetTerms.values()) {
                        this.#markerTerms.get(term).add(datasetTerm)
                        if (this.#kindByTerm.get(datasetTerm) !== 'multiscale') {
                            this.#kindByTerm.set(datasetTerm, dataset.kind || 'dataset')
                        }
                    }
                }
            }
        }
        this.#update()
        return mapDatasetMarkers
    }

    clearDatasetMarkers()
    //===================
    {
        this.#datasetFeatureIds.clear()
        this.#datasetsByZoomTerm.clear()
        this.#kindByDataset.clear()
        this.#multiScaleByZoomTerm.clear()
        this.#update()
    }

    removeDatasetMarker(datasetId: string)
    //====================================
    {
        if (this.#datasetFeatureIds.has(datasetId)) {
            this.#datasetFeatureIds.delete(datasetId)
        }
        this.#datasetsByZoomTerm.forEach((zoomDatasets, term) => {
            const zoomMultiscale = Array(MAX_MARKER_ZOOM).fill(false)
            zoomDatasets.forEach((datasetIds, zoom) => {
                datasetIds.forEach(dsId => {
                    if (dsId !== datasetId) {
                        zoomMultiscale[zoom] ||= (this.#kindByDataset.get(dsId) === 'multiscale')
                    }
                })
                datasetIds.delete(datasetId)
            })
            this.#multiScaleByZoomTerm.set(term, zoomMultiscale)
        })
        if (this.#kindByDataset.has(datasetId)) {
            this.#kindByDataset.delete(datasetId)
        }
        this.#update()
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
