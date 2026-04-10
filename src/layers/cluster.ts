/*==============================================================================

Flatmap viewer and annotation tool

Copyright (c) 2019 - 2024 David Brooks

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

import maplibregl from 'maplibre-gl';

//==============================================================================

import {FlatMap} from '../flatmap'
import {UserInteractions} from '../interactions'
import {DATASET_CLUSTERED_MARKER, UNCLUSTERED_MARKER} from '../markers'

//==============================================================================

type GeometricObject = GeoJSON.Point
                     | GeoJSON.MultiPoint
                     | GeoJSON.LineString
                     | GeoJSON.MultiLineString
                     | GeoJSON.Polygon
                     | GeoJSON.MultiPolygon

//==============================================================================

// Geographical clustering

export class ClusteredMarkerLayer
{
    #map: maplibregl.Map
    #points: GeoJSON.FeatureCollection = {
       type: 'FeatureCollection',
       features: []
    }
    #ui: UserInteractions

    constructor(flatmap: FlatMap, ui: UserInteractions)
    {
        this.#ui = ui
        this.#map = flatmap.map!

        this.#map.addSource('markers', {
            type: 'geojson',
            data: this.#points,
            cluster: true,      // Adds the ``point_count`` property to source data
            clusterMaxZoom: 9,  // Max zoom to cluster points on
            clusterRadius: 50   // Radius of each cluster when clustering points (defaults to 50)
        })

        this.#map.addLayer({
            id: 'clustered-markers',
            type: 'symbol',
            source: 'markers',
            filter: ['has', 'point_count'],
            layout: {
                'icon-image': DATASET_CLUSTERED_MARKER,
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                'icon-offset': [0, -17],
                'icon-size': 0.8,
                'text-field': '{point_count_abbreviated}',
                'text-size': 10,
                'text-offset': [0, -1.93]
            }
        })

        this.#map.addLayer({
            id: 'single-points',
            type: 'symbol',
            source: 'markers',
            filter: ['!', ['has', 'point_count']],
            layout: {
                'icon-image': UNCLUSTERED_MARKER,
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                'icon-offset': [0, -17],
                'icon-size': 0.6
            }
        })

        // inspect a cluster on click
        this.#map.on('click', 'clustered-markers', async (e) => {
            const features = this.#map.queryRenderedFeatures(e.point, {
                layers: ['clustered-markers']
            })
            const clusterId = features[0].properties.cluster_id
            const zoom = await (this.#map.getSource('markers') as maplibregl.GeoJSONSource).getClusterExpansionZoom(clusterId)
            this.#map.easeTo({
                center: (features[0].geometry as GeometricObject).coordinates as [number, number],
                zoom
            })
        })

        this.#map.on('click', 'single-points', this.singleMarkerEvent.bind(this))
        this.#map.on('mouseenter', 'single-points', this.singleMarkerEvent.bind(this))
        this.#map.on('mousemove', 'single-points', this.singleMarkerEvent.bind(this))

        this.#map.on('mouseenter', 'clustered-markers', () => {
            this.#map.getCanvas().style.cursor = 'pointer'
        })

        this.#map.on('mouseleave', 'clustered-markers', () => {
            this.#map.getCanvas().style.cursor = ''
        })
    }

    singleMarkerEvent(event)
    //======================
    {
        const features = this.#map.queryRenderedFeatures(event.point, {
            layers: ['single-points']
        })
        for (const feature of features) {
            const properties = feature.properties
            const position = properties.markerPosition.slice(1, -1).split(',').map(p => +p)
            this.#ui.handleMarkerEvent(event, +feature.id, position, properties)
        }
        event.originalEvent.stopPropagation()
    }

    addMarker(id: number, position: [number, number], properties={})
    //==============================================================
    {
// TODO: Don't add the marker if there already is one at the exact position
        this.#points.features.push({
            type: 'Feature',
            id,
            properties,
            geometry: {
                type: 'Point',
                coordinates: position
            }
        });                             // neccesary semicolon
        (this.#map.getSource('markers') as maplibregl.GeoJSONSource)
                  .setData(this.#points)
    }

    clearMarkers()
    //============
    {
        this.#points.features = [];     // neccesary semicolon
        (this.#map.getSource('markers') as maplibregl.GeoJSONSource)
                  .setData(this.#points)
    }
}

//==============================================================================

