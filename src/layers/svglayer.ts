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

import type {Map as MapLibreMap} from 'maplibre-gl'

//import {BitmapLayer, BitmapLayerProps} from '@deck.gl/layers';
//import {GeoJsonLayer, GeoJsonLayerProps} from '@deck.gl/layers';
import {MVTLayer /*, TileLayer */} from '@deck.gl/geo-layers'
import {Matrix4} from '@math.gl/core';

//==============================================================================

import type {FlatMap} from '../flatmap'

import type {DeckGlOverlay} from './deckgl'

//==============================================================================

//   >>>>>>>>>>>>>>>>>>>>>>>>>>>>   WIP   <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

type Bounds = [GeoJSON.Position, GeoJSON.Position]

//const FC_LV_MYOCYTE_BOUNDS: Bounds = [[-7.09305, -0.35484], [-6.06056, -0.03271]]

const LAYER_OFFSET = new Matrix4().translate([0, 0, 2000])

const MIN_VISIBLE_ZOOM = 8

//==============================================================================

function _boundingGeoJSONPolygon(bounds: Bounds): GeoJSON.Feature<GeoJSON.Polygon>
{
    return {
        type: 'Feature',
        properties: {},
        geometry: {
            type: 'Polygon',
            coordinates: [[bounds[0], [bounds[0][0], bounds[1][1]],
                           bounds[1], [bounds[1][0], bounds[0][1]]]]
        }
    }
}

function _imageBounds(bounds: Bounds): [number, number, number, number]
{
    return [bounds[0][0], bounds[0][1], bounds[1][0], bounds[1][1]]
}

//==============================================================================

export class SvgLayer
{
    #deckOverlay: DeckGlOverlay
//    #layerProps: [BitmapLayerProps, GeoJsonLayerProps]
    #map: MapLibreMap
    #visible: boolean

    constructor(deckOverlay: DeckGlOverlay, flatmap: FlatMap)
    {
        this.#deckOverlay = deckOverlay
        this.#map = flatmap.map
        this.#visible = (this.#map.getZoom() >= MIN_VISIBLE_ZOOM)
        this.#makeLayerProps()
        this.#redraw()
    }

    zoomEvent()
    //=========
    {
        const visible = (this.#map.getZoom() >= MIN_VISIBLE_ZOOM)
        if (this.#visible !== visible) {
            this.#visible = visible
            this.#makeLayerProps()
            this.#redraw()
        }
    }

    #makeLayerProps()
    //===============
    {
        /*
        this.#layerProps = [
            {
                id: 'bitmap',
                image: 'http://localhost:8000/image/CardiomyocyteV1.png',
                bounds: imageBounds(FC_LV_MYOCYTE_BOUNDS),
                pickable: false,
                modelMatrix: LAYER_OFFSET,
                visible: this.#visible
            },
            {
                id: 'geojson',
                data: boundingGeoJSONPolygon(FC_LV_MYOCYTE_BOUNDS),
                stroked: false,
                filled: true,
                pickable: false,
                getFillColor: [255, 255, 255],
                opacity: 0.7,
                modelMatrix: LAYER_OFFSET,
                visible: this.#visible
            }
        ]
        */
    }

    #redraw()
    //=======
    {
        const layers = [
            //new GeoJsonLayer(this.#layerProps[1]),
            //new BitmapLayer(this.#layerProps[0])
/*
            new TileLayer({
                id: 'TileLayer',
                data: 'http://localhost:8000/flatmap/cardiac-myocyte/tiles/cardiac-myocyte_image/{z}/{x}/{y}',
                minZoom: 8,
                maxZoom: 12,
                renderSubLayers: props => {
                    const {boundingBox} = props.tile
                    return new BitmapLayer(props, {
                        data: null,
                        image: props.data,
                        bounds: [boundingBox[0][0], boundingBox[0][1], boundingBox[1][0], boundingBox[1][1]]
                    })
                },
                modelMatrix: LAYER_OFFSET,
            }),
*/
            new MVTLayer({
                id: 'MVTLayer',
                data: [
                    'http://localhost:8000/flatmap/cardiac-myocyte/mvtiles/{z}/{x}/{y}'
                ],
                minZoom: 6,
                maxZoom: 12,
                getFillColor: [0, 240, 240],
                getLineWidth: 2,
                getLineColor: [192, 0, 0],
                getPointRadius: 2,
                pointRadiusUnits: 'pixels',
                stroked: true,
                modelMatrix: LAYER_OFFSET,
            })
        ]
        this.#deckOverlay.setLayers(layers)
    }
}

//==============================================================================

/*

*   Rasterise SVG to get bit map
*   Can we put bitmap tiles into a bounded area??

    *   Yes -- https://deck.gl/docs/api-reference/geo-layers/tile-layer
    *   can set minZoom (to 8) and extent



 */
