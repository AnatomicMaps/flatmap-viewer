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

import type {FlatMapCallback, FlatMapOptions} from '../flatmap-types'
import {FlatMapServer} from '../mapserver'
import type {MapIdentifier} from '../viewer'

import {PanZoom} from './panzoom'

//==============================================================================

export class SvgMap
{
//WIP    #callback: FlatMapCallback
    #container: HTMLElement
    #panzoom: PanZoom

    constructor(containerId: string, _callback: FlatMapCallback, svg: string)
    {
        this.#container = document.getElementById(containerId)!
//WIP        this.#callback = callback
        this.#panzoom = new PanZoom(this.#container)

        this.#container.innerHTML = svg

        this.#panzoom.enable(this.#container.firstElementChild as SVGSVGElement)

        // Set margins by setting zoom
        this.#panzoom.setZoom(0.95*this.#panzoom.zoom)
    }
}

//==============================================================================

export class SvgViewer
{
    #mapServer: FlatMapServer

    constructor(mapServerUrl: string)
    {
        this.#mapServer = new FlatMapServer(mapServerUrl)
    }

    async loadMap(identifier: MapIdentifier, callback: FlatMapCallback, options: FlatMapOptions={}): Promise<SvgMap>
    //===============================================================================================================
    {
        // Load the maps index file
        const mapId = (typeof identifier === 'object') ? identifier.uuid : identifier
        const mapIndex = await this.#mapServer.mapIndex(mapId)
        const mapIndexId = ('uuid' in mapIndex) ? mapIndex.uuid : mapIndex.id
        if (mapId !== mapIndexId) {
            throw new Error(`Map '${mapId}' has wrong ID in index`)
        }
        const svgBytes = await this.#mapServer.mapImage(mapId, `${mapIndex.id}.svg`)
        return new SvgMap(options.container, callback, new TextDecoder().decode(svgBytes))
    }
}

//==============================================================================
