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

import {FlatMap, FLATMAP_STYLE, MapDescriptionOptions} from './flatmap'
import {FlatMapCallback, FlatMapLayer, FlatMapOptions, FlatMapServerIndex} from './flatmap-types'
import {SparcTermGraph} from './knowledge'
import {FlatMapServer} from './mapserver'
import * as utils from './utils'

//==============================================================================

// The released version of the viewer
export const VIEWER_VERSION = '4.0.3'

//==============================================================================

const MAP_MAKER_SEPARATE_LAYERS_VERSION = 1.4

//==============================================================================

export type MapIdentifier = {
    biologicalSex?: string
    taxon?: string
    uuid?: string
} | string

//==============================================================================

export type MapListEntry = FlatMapServerIndex & {
    describes?: string
    id?: string
    separateLayers?: boolean
}

//==============================================================================

export interface PreloadedImage
{
    id: string
    url: string
    options: {
        content: number[]
        stretchX: number[][]
        stretchY: number[][]
    }

}

export interface MapViewerOptions extends FlatMapOptions
{
    container: string
    panes?: number
    images?: PreloadedImage[]
}

//==============================================================================

/**
 * A viewer for FlatMaps.
 *
 * @example
 * const viewer = new MapViewer('https://mapcore-demo.org/flatmaps/', {container: 'container-id'})
 */
export class MapViewer
{
    /**
     * The released version of the viewer
     */
    static version = VIEWER_VERSION

    #container: string
    #containerElement: HTMLElement
    #initialisingMutex: utils.Mutex = new utils.Mutex()
    #initialised: boolean = false
    #mapList: MapListEntry[] = []
    #mapNumber: number = 0
    #mapsByPane: Map<number, FlatMap> = new Map()
    #mapServer: FlatMapServer
    #images: PreloadedImage[]
    #panes: number
    #sparcTermGraph = new SparcTermGraph()

    // also have a callback for viewer events...
    // -- as an option in MapViewerOptions?
    //
    // Do we just have a viewer callback? With map events having a map number field??
    //

    constructor(mapServerUrl: string, options: MapViewerOptions)
    {
        this.#mapServer = new FlatMapServer(mapServerUrl)
        this.#container = options.container
        this.#containerElement = document.getElementById(this.#container)
        this.#images = options.images || []
        this.#panes = options.panes || 1
        if (this.#panes > 1) {
            this.#containerElement.style.display = 'flex'
        }
    }

    async #ensureInitialised()
    //========================
    {
        return await this.#initialisingMutex.dispatch(async () => {
            if (!this.#initialised) {
                await this.#mapServer.initialise()
                this.#mapList = []
                let maps
                try {
                    maps = await this.#mapServer.flatMaps()
                } catch {
                    window.alert(`Cannot connect to flatmap server at ${this.#mapServer.url()}`)
                    return
                }
                // Check map schema version (set by mapmaker) and
                // remove maps we can't view (giving a console warning...)
                for (const map of maps) {
                    // Are features in separate vector tile source layers?
                    map.separateLayers = ('version' in map && map.version >= MAP_MAKER_SEPARATE_LAYERS_VERSION)
                    this.#mapList.push(map)
                }
                await this.#sparcTermGraph.load(this.#mapServer)
                this.#initialised = true
            }
        })
    }

    async allMaps(): Promise<Record<string, MapListEntry>>
    //====================================================
    {
        await this.#ensureInitialised()
        const allMaps = {}
        for (const map of this.#mapList) {
            const id = ('uuid' in map) ? map.uuid : map.id
            allMaps[id] = map
        }
        return allMaps
    }

    async #findMap(identifier: MapIdentifier): Promise<MapListEntry>
    //==============================================================
    {
        await this.#ensureInitialised()
        return this.#lookupMap(identifier)
    }

    #latestMap(identifier: MapIdentifier)
    //===================================
    {
        const mapDescribes = (typeof identifier === 'string' || identifier instanceof String)
                                ? identifier
                                : (identifier.uuid || identifier.taxon || null)
        if (mapDescribes === null) {
            return null
        }
        const biologicalSex = (typeof identifier === 'string' || identifier instanceof String)
                                ? null
                                : identifier.biologicalSex || null
        let latestMap = null
        let lastCreatedTime: string = ''
        for (const map of this.#mapList) {
            if (('uuid' in map && mapDescribes === map.uuid
             || mapDescribes === map.id
             || 'taxon' in map && mapDescribes === map.taxon
             || mapDescribes === map.source)
            && (biologicalSex === null
             || ('biologicalSex' in map && biologicalSex === map.biologicalSex))) {
                if ('created' in map) {
                    if (lastCreatedTime < map.created) {
                        lastCreatedTime = map.created
                        latestMap = map
                    }
                } else {
                    latestMap = map
                    break
                }
            }
        }
        return latestMap
    }

    #lookupMap(identifier: MapIdentifier)
    //===================================
    {
         if (typeof identifier === 'object') {
            return this.#latestMap(identifier)
        }
        return this.#latestMap({uuid: identifier})
    }

   /**
    * Load and display a FlatMap.
    *
    * @param identifier A string or object identifying the map to load. If a string its
    *                   value can be either the map's ``uuid``, assigned at generation time,
    *                   or taxon and biological sex identifiers of the species that the map
    *                   represents. The latest version of a map is loaded unless it has been
    *                   identified using a ``uuid`` (see below).
    * @param callback   A callback function, invoked when events occur with the map. The
    *                   first parameter gives the type of event, the second provides
    *                   details about the event.
    * @param options Configurable options for the map.
    * @example
    * const humanMap1 = mapManager.loadMap('humanV1', 'div-1')
    *
    * const humanMap2 = mapManager.loadMap('NCBITaxon:9606', 'div-2')
    *
    * const humanMap3 = mapManager.loadMap({taxon: 'NCBITaxon:9606'}, 'div-3')
    *
    * const humanMap4 = mapManager.loadMap(
    *                     {uuid: 'a563be90-9225-51c1-a84d-00ed2d03b7dc'},
    *                     'div-4')
    */
    async loadMap(identifier: MapIdentifier, callback: FlatMapCallback, options: FlatMapOptions={}): Promise<FlatMap>
    //===============================================================================================================
    {
        const map = await this.#findMap(identifier)
        if (map === null) {
            throw new Error(`Unknown map: ${JSON.stringify(identifier)}`)
        }

        // Load the maps index file

        const mapId = ('uuid' in map) ? map.uuid : map.id
        const mapIndex = await this.#mapServer.mapIndex(mapId)

        // Don't create a new pane for an already open map
        for (const flatmap of this.#mapsByPane.values()) {
            if (mapId === flatmap.uuid) {
                return flatmap
            }
        }

        const mapIndexId = ('uuid' in mapIndex) ? mapIndex.uuid : mapIndex.id
        if (mapId !== mapIndexId) {
            throw new Error(`Map '${mapId}' has wrong ID in index`)
        }
        const mapOptions = Object.assign({images: this.#images}, options) as MapDescriptionOptions

        // If bounds are not specified in options then set them

        if (!('bounds' in options) && ('bounds' in mapIndex)) {
            mapOptions['bounds'] = mapIndex['bounds']
        }

        // Note the kind of map

        if ('style' in mapIndex) {
            mapOptions.style = mapIndex.style;          // Currently ``anatomical``, ``functional`` or ``centreline``
        } else {
            mapOptions.style = FLATMAP_STYLE.GENERIC    // Default is a generic ``flatmap``
        }

        // Mapmaker has changed the name of the field to indicate that indicates if
        // there are raster layers
        if (!('image-layers' in mapOptions) && ('image_layer' in mapIndex)) {
            mapOptions['image-layers'] = mapIndex['image_layer']
        }

        // Use the map's zoom range set when it was built

        if ('max-zoom' in mapIndex) {
            mapOptions.maxZoom = mapIndex['max-zoom']
        }
        if ('min-zoom' in mapIndex) {
            mapOptions.minZoom = mapIndex['min-zoom']
        }

        // Get details about the map's layers

        let mapLayers: FlatMapLayer[] = []
        if (!('version' in mapIndex) || mapIndex.version <= 1.0) {
            for (const layer of mapIndex.layers) {
                // Set layer data if the layer just has an id specified
                if (typeof layer === 'string') {
                    mapLayers.push({
                        id: layer,
                        description: layer.charAt(0).toUpperCase() + layer.slice(1)
                    })
                } else {
                    mapLayers.push(layer)
                }
            }
        } else {
            mapLayers = await this.#mapServer.mapLayers(mapId)
        }

        // Get the map's style file

        const mapStyle = await this.#mapServer.mapStyle(mapId)

        // Make sure the style has glyphs defined

        if (!('glyphs' in mapStyle)) {
            mapStyle.glyphs = 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf'
        }

        // Get the map's pathways

        const pathways = await this.#mapServer.mapPathways(mapId)

        // Get the map's annotations

        const annotations = await this.#mapServer.mapAnnotations(mapId)

        // Get metadata about the map

        const mapMetadata = await this.#mapServer.mapMetadata(mapId)

        // Set zoom range if not specified as an option

        if ('vector-tiles' in mapStyle.sources) {
            const vectorTilesSource = <maplibregl.VectorSourceSpecification>mapStyle.sources['vector-tiles']
            if (!('minZoom' in mapOptions)) {
                mapOptions['minZoom'] =  vectorTilesSource.minzoom
            }
            if (!('maxZoom' in mapOptions)) {
                mapOptions['maxZoom'] = vectorTilesSource.maxzoom
            }
        }

        // Make sure ``layerOptions`` fields are set

        if (mapOptions.layerOptions) {
            if (!('coloured' in mapOptions.layerOptions)) {
                mapOptions.layerOptions.coloured = true
            }
            if (!('outlined' in mapOptions.layerOptions)) {
                mapOptions.layerOptions.outlined = true
            }
        } else {
            mapOptions.layerOptions = {
                coloured: true,
                outlined: true
            }
        }
        mapOptions.layerOptions.authoring = ('authoring' in mapIndex) ? mapIndex.authoring : false

        // Are features in separate vector tile source layers?

        mapOptions.separateLayers = map.separateLayers

        // Create a container for the map if in multi-pane mode and no container is given

        let containerId: string = options.container || null

        if (containerId) {
            // Saves a nest
        } else if (this.#panes <= 1) {
            containerId = this.#container
        } else if (this.#mapsByPane.size >= this.#panes) {
            const flatmap = this.#mapsByPane.get(this.#mapNumber)
            if (flatmap) {
                flatmap.close()
            }
            containerId = `${this.#container}-${this.#mapNumber}`
        } else {
            this.#mapNumber += 1
            containerId = `${this.#container}-${this.#mapNumber}`
            const mapPane = document.createElement('div')
            mapPane.id = containerId
            mapPane.setAttribute('class', 'flatmap-viewer-pane')
            this.#containerElement.append(mapPane)
        }
        if (!options.container) {
            mapOptions.addCloseControl = (this.#panes > 1) && (this.#mapsByPane.size >= 1)
            if (this.#mapsByPane.size === 1) {
                for (const flatmap of this.#mapsByPane.values()) {
                    flatmap.addCloseControl()
                }
            }
        }

        // Don't clutter the screen with controls if a multipane viewer

        mapOptions.allControls = (this.#panes <= 1)

        // Display the map

        const flatmap = new FlatMap(this, containerId, this.#mapServer,
            {
                id: map.id,
                uuid: mapId,
                details: mapIndex,
                taxon: map.taxon,
                biologicalSex: map.biologicalSex,
                style: mapStyle,
                options: mapOptions,
                layers: mapLayers,
                number: this.#mapNumber,
                sparcTermGraph: this.#sparcTermGraph,
                annotations,
                callback,
                pathways,
                mapMetadata
            })
        await flatmap.mapLoaded()

        this.#mapsByPane.set(this.#mapNumber, flatmap)
        return flatmap
    }

    closeMaps()
    //=========
    {
        for (const [mapNumber, flatmap] of this.#mapsByPane.entries()) {
            flatmap.close()
            if (!flatmap.options.container && this.#panes > 1) {
                const container = document.getElementById(`${this.#container}-${mapNumber}`)
                container.remove()
            }
        }
        this.#mapsByPane.clear()
        this.#mapNumber = 0
    }

    closePane(mapNumber: number)
    //==========================
    {
        if (this.#mapsByPane.size > 1) {
            const flatmap = this.#mapsByPane.get(mapNumber)
            if (flatmap) {
                flatmap.close()
                this.#mapsByPane.delete(mapNumber)
            }
            const container = document.getElementById(`${this.#container}-${mapNumber}`)
            container.remove()
        }
        if (this.#mapsByPane.size <= 1) {
            for (const flatmap of this.#mapsByPane.values()) {
                flatmap.removeCloseControl()
            }
        }
    }
}

//==============================================================================
