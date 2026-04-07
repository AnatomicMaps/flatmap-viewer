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

import type {Layer} from '@deck.gl/core'
import {MapboxOverlay} from '@deck.gl/mapbox'

import type {IControl, Map as MapLibreMap} from 'maplibre-gl'

//==============================================================================

import type {FlatMap} from '../flatmap'

//==============================================================================

export class DeckGlOverlay
{
    #overlay: MapboxOverlay = new MapboxOverlay(
        {
            interleaved: true,
            layers: [],
            getCursor: () => 'default'
        }
    )
    #layers: Map<string, Layer> = new Map()

    #map: MapLibreMap

    constructor(flatmap: FlatMap)
    {
        this.#map = flatmap.map

        this.#map.addControl(this.#overlay as IControl)
    }

    addLayer(layer: Layer)
    //====================
    {
        this.#layers.set(layer.id, layer)
        this.#setLayers()
    }

    finalise()
    //========
    {
        this.#overlay.finalize()
    }

    queryFeaturesAtPoint(point)
    //=========================
    {
        return this.#overlay
                   .pickMultipleObjects(point)
    }

    removeLayer(layerId: string)
    //==========================
    {
        if (this.#layers.has(layerId)) {
            this.#layers.delete(layerId)
            this.#setLayers()
        }
    }

    setLayers(layers: Layer[])
    //========================
    {
        for (const layer of layers) {
            this.#layers.set(layer.id, layer)
        }
        this.#setLayers()
    }

    #setLayers()
    //==========
    {
        this.#overlay.setProps({
            layers: [...this.#layers.values()]
        })
    }
}

//==============================================================================
