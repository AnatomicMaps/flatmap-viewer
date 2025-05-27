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

import Set from 'core-js/actual/set'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

import * as turf from '@turf/helpers'
import * as turfLength from "@turf/length"

//==============================================================================

// Load our stylesheet last so we can overide styling rules

import '../static/css/flatmap-viewer.css'

//==============================================================================

import {PropertiesFilterExpression} from './filters'
import {
    AnnotatedFeature,
    AnnotationDrawMode,
    AnnotationEvent,
    DatasetTerms,
    ExportedFeatureProperties,
    FeatureZoomOptions,
    FlatMapAnnotations,
    FlatMapCallback,
    FlatMapFeatureAnnotation,
    FlatMapIndex,
    FlatMapLayer,
    FlatMapMarkerOptions,
    FlatMapMetadata,
    FlatMapOptions,
    FlatMapPathways,
    FlatMapPopUpOptions,
    FlatMapState
} from './flatmap-types'
import type {GeoJSONId, Point2D, Size2D} from './flatmap-types'
import {UserInteractions} from './interactions'
import {MapTermGraph, SparcTermGraph} from './knowledge'
import {KNOWLEDGE_SOURCE_SCHEMA, FlatMapServer} from './mapserver'
import {loadMarkerIcons} from './markers'
import {APINATOMY_PATH_PREFIX, PathType} from './pathways'
import {SearchIndex} from './search'

import * as images from './images'
import * as utils from './utils'

//==============================================================================

/**
 * The taxon identifier used when none has been given.
 *
 * @type       {string}
 */
export const UNCLASSIFIED_TAXON_ID = 'NCBITaxon:2787823';   // unclassified entries

//==============================================================================

const MAP_MAKER_FLIGHTPATHS_VERSION = 1.6

//==============================================================================

const EXCLUDED_FEATURE_FILTER_PROPERTIES = [
    'associated-details',
    'bounds',
    'class',
    'coordinates',
    'details-layer',
    'featureId',
    'geometry',
    'geom-type',
    'id',
    'label',
    'layer',
    'markerPosition',
    'name',
    'nerveId',
    'nodeId',
    'pathStartPosition',
    'pathEndPosition',
    'source',
    'tile-layer',
]

const EXPORTED_FEATURE_PROPERTIES = [
    'id',
    'featureId',
    'connectivity',
    'dataset',
    'dataset-ids',
    'kind',
    'label',
    'marker-terms',
    'models',
    'source',
    'taxons',
    'hyperlinks',
    'completeness',
    'missing-nodes',
    'alert',
    'biological-sex',
    'location'
]

const ENCODED_FEATURE_PROPERTIES = [
    'hyperlinks',
]

//==============================================================================

export class FLATMAP_STYLE
{
    static FUNCTIONAL = 'functional'
    static ANATOMICAL = 'anatomical'
    static CENTRELINE = 'centreline'
    static GENERIC = 'flatmap'
}

//==============================================================================

export interface CentrelineDetails
{
    models: string
    label: string
}

//==============================================================================

export interface EntityLabel {
    entity: string
    label: string
}

//==============================================================================

export type FlatMapSourceSpecification = maplibregl.VectorSourceSpecification
                                       | maplibregl.RasterSourceSpecification

export type FlatMapStyleSpecification = maplibregl.StyleSpecification & {
    "sources": {
        [_: string]: FlatMapSourceSpecification;
    }
}

//==============================================================================

export type MapDescriptionOptions = FlatMapOptions & {
    bounds: [number, number, number, number]
    images?: {
        id: string
        url: string
        options: object
    }[]
    separateLayers: boolean
    style: string
}

export type MapDescription = {
    id: string
    uuid: string
    details: FlatMapIndex
    taxon: string|null
    biologicalSex: string|null
    style: FlatMapStyleSpecification
    options: MapDescriptionOptions
    layers: FlatMapLayer[]
    sparcTermGraph: SparcTermGraph
    annotations: FlatMapAnnotations
    callback: FlatMapCallback
    pathways: FlatMapPathways
    mapMetadata: FlatMapMetadata
}

//==============================================================================

type FeatureIdMap = Map<string, GeoJSONId[]>


/**
 * Maps are not created directly but instead are created and loaded by
 * `LoadMap` of {@link MapViewer}.
 *
 * @groupDescription Markers
 * API calls to place amd remove different types of markers on a flatmap
 *
 * @showCategories
*/
export class FlatMap
{
    #annIdToFeatureId: Map<string, GeoJSONId> = new Map()
    #baseUrl: string
    #biologicalSex: string|null
    #bounds: maplibregl.LngLatBounds
    #callbacks: FlatMapCallback[] = []
    #container: string
    #created: string
    #datasetToFeatureIds: FeatureIdMap = new Map()
    #details: FlatMapIndex
    #featurePropertyValues = new Map()
    #id: string
    #initialState: FlatMapState|null = null
    #layers: FlatMapLayer[]
    #idToAnnotation: Map<GeoJSONId, FlatMapFeatureAnnotation> = new Map()
    #knowledgeSource = ''
    #map: maplibregl.Map|null = null
    #mapMetadata: FlatMapMetadata
    #mapServer: FlatMapServer
    #mapSourceToFeatureIds: FeatureIdMap = new Map()
    #mapTermGraph: MapTermGraph
    #modelToFeatureIds: FeatureIdMap = new Map()
    #normalisedOrigin: [number, number]
    #normalised_size: [number, number]
    #options: MapDescriptionOptions
    #pathways: FlatMapPathways
    #searchIndex: SearchIndex = new SearchIndex()
    #startupState = -1
    #taxon: string|null
    #taxonNames = new Map()
    #taxonToFeatureIds: FeatureIdMap = new Map()
    #userInteractions: UserInteractions|null = null
    #uuid: string

    constructor(container: string, mapServer: FlatMapServer, mapDescription: MapDescription)
    {
        this.#container = container
        this.#mapServer = mapServer
        this.#baseUrl = mapServer.url()
        this.#id = mapDescription.id
        this.#uuid = mapDescription.uuid
        this.#details = mapDescription.details
        this.#mapMetadata = mapDescription.mapMetadata
        this.#created = mapDescription.mapMetadata.created
        this.#taxon = mapDescription.taxon
        this.#biologicalSex = mapDescription.biologicalSex
        this.#callbacks.push(mapDescription.callback)
        this.#layers = mapDescription.layers
        this.#options = mapDescription.options
        this.#pathways = mapDescription.pathways
        this.#mapTermGraph = new MapTermGraph(mapDescription.sparcTermGraph)

        const sckanProvenance = mapDescription.details.connectivity
        if (!sckanProvenance) {
            this.#knowledgeSource = this.#mapServer.latestSource
        } else if ('knowledge-source' in sckanProvenance) {
            this.#knowledgeSource = sckanProvenance['knowledge-source'] || ''
        } else if ('npo' in sckanProvenance) {
            this.#knowledgeSource = `${sckanProvenance.npo!.release}-npo`     // NB. Drop `-npo` (server will need to check...) <<<<<<<<<
        } else {
            this.#knowledgeSource = this.#mapServer.latestSource
        }

        for (const [featureId, annotation] of Object.entries(mapDescription.annotations)) {
            this.#saveAnnotation(+featureId, annotation)
            this.#searchIndex.indexMetadata(+featureId, annotation)
        }

        // Set base of source URLs in map's style

        for (const [_, source] of Object.entries(mapDescription.style.sources)) {
            if (source.url) {
                source.url = this.makeServerUrl(source.url)
            }
            if (source.tiles) {
                const tiles: string[] = []
                for (const tileUrl of source.tiles) {
                    tiles.push(this.makeServerUrl(tileUrl))
                }
                source.tiles = tiles
            }
        }

        // Ensure rounded background images (for feature labels) are loaded

        if (!('images' in mapDescription.options)) {
            mapDescription.options.images = []
        }
        for (const image of images.LABEL_BACKGROUNDS) {
            let found = false
            for (const im of mapDescription.options.images || []) {
                if (image.id === im.id) {
                    found = true
                    break
                }
            }
            if (!found) {
                mapDescription.options.images!.push(image)
            }
        }

        // Set options for the map

        const mapOptions: maplibregl.MapOptions = {
            style: mapDescription.style,
            container: container,
            attributionControl: false
        }

        if ('maxZoom' in mapDescription.options) {
            mapOptions.maxZoom = mapDescription.options.maxZoom! - 0.001
        }
        if ('minZoom' in mapDescription.options) {
            mapOptions.minZoom = mapDescription.options.minZoom
        }

        // Only show location in address bar when debugging

        //mapOptions.hash = (mapDescription.options.debug === true)

        // Set bounds if it is set in the map's options

        if ('bounds' in mapDescription.options) {
            mapOptions.bounds = mapDescription.options.bounds
        }

        // Create the map

        this.#map = new maplibregl.Map(mapOptions)

        // Show extra information if debugging

        if (mapDescription.options.debug === true) {
            this.#map.showTileBoundaries = true
            this.#map.showCollisionBoxes = true
        }

        // Don't wrap around at +/-180 degrees

        this.#map.setRenderWorldCopies(false)

        // Disable map rotation
        // REMOVE old code...
        //this.#map.dragRotate.disable()
        //this.#map.touchZoomRotate.disableRotation()

        // Finish initialisation when all sources have loaded
        // and map has rendered

        const idleSubscription = this.#map.on('idle', async() => {
            if (this.#startupState === -1) {
                this.#startupState = 0
                await this.#setupUserInteractions()
            } else if (this.#startupState === 1) {
                this.#startupState = 2
                this.#map!.setRenderWorldCopies(true)
                this.#bounds = this.#map!.getBounds()
                if (this.#bounds.getEast() >= 180) {
                    this.#bounds.setNorthEast(new maplibregl.LngLat(179.9, this.#bounds.getNorth()))
                }
                if (this.#bounds.getWest() <= -180) {
                    this.#bounds.setSouthWest(new maplibregl.LngLat(-179.9, this.#bounds.getSouth()))
                }
                const bounds = this.#bounds.toArray()
                const sw = maplibregl.MercatorCoordinate.fromLngLat(bounds[0])
                const ne = maplibregl.MercatorCoordinate.fromLngLat(bounds[1])
                this.#normalisedOrigin = [sw.x, ne.y]
                this.#normalised_size = [ne.x - sw.x, sw.y - ne.y]
                if ('state' in this.#options) {
                    this.#userInteractions!.setState(this.#options.state)
                }
                this.#initialState = this.getState()
                if (this.#userInteractions!.minimap) {
                    this.#userInteractions!.minimap.initialise()
                }
                this.#map!.setMaxBounds(this.#bounds)
                this.#map!.fitBounds(this.#bounds, {animate: false})
                this.#startupState = 3

                idleSubscription.unsubscribe()
            }
        })
    }

    async mapLoaded()
    //===============
    {
        while (this.#startupState < 3) {
            await utils.wait(10)
        }
    }

    async #setupUserInteractions()
    //============================
    {
        // Get names of the taxons we have
        await this.#setTaxonName(this.#taxon)
        for (const taxon of this.taxonIdentifiers) {
            await this.#setTaxonName(taxon)
        }

        // Load any images required by the map
        for (const image of this.#options.images || []) {
            await this.#addImage(image.id, image.url, '', image.options)
        }

        // Load icons used for clustered markers
        await loadMarkerIcons(this.#map!)

        // Load anatomical term hierarchy for the flatmap
        const termGraph = (await this.#mapServer.mapTermGraph(this.#uuid))!
        this.#mapTermGraph.load(termGraph)

        // Layers have now loaded so finish setting up
        this.#userInteractions = new UserInteractions(this)

        // Continue initialising when next idle
        this.#startupState = 1
    }

    /**
     * The flatmap's bounds.
     *
     * @group Properties
     */
    get bounds(): maplibregl.LngLatBoundsLike
    //=======================================
    {
        return this.#bounds
    }

    /**
     * Does the flatmap contain flightpath information?
     *
     * @return boolean
     *
     * @group Properties
     */
    get has_flightpaths()
    //===================
    {
        return 'version' in this.#details
            && this.#details.version >= MAP_MAKER_FLIGHTPATHS_VERSION
    }

    /**
     * @group Properties
     */
    get mapTermGraph()
    //================
    {
        return this.#mapTermGraph
    }

    /**
     * Get valid keys and their value ranges to use when filtering feature
     * and path visibility.
     *
     * @return {Object}  Value ranges are string arrays
     */
    featureFilterRanges()
    //===================
    {
        const filterRanges = {}
        for (const [key, value] of this.#featurePropertyValues.entries()) {
            filterRanges[key] = [...value.values()]
        }
        return filterRanges
    }

    /**
     * Clear any visibility filter on features and paths.
     */
    clearVisibilityFilter()
    //=====================
    {
        if (this.#userInteractions !== null) {
            this.#userInteractions.clearVisibilityFilter()
        }
    }

    /**
     * Sets a visibility filter for features and paths
     *
     * @param {PropertiesFilterExpression}  [filterExpression=true]  The filter specification
     */
    setVisibilityFilter(filterExpression: PropertiesFilterExpression=true)
    //====================================================================
    {
        if (this.#userInteractions !== null) {
            this.#userInteractions.setVisibilityFilter(filterExpression)
        }
    }

    // Map control methods

    /**
     * Reset a map to its initial state.
     */
    resetMap()
    //========
    {
        if (this.#initialState !== null) {
            this.setState(this.#initialState)
        }
        if (this.#userInteractions !== null) {
            this.#userInteractions.reset()
        }
    }

    /**
     * Zoom the map in.
     */
    zoomIn()
    //======
    {
        this.#map!.zoomIn()
    }

    /**
     * Zoom the map out.
     */
    zoomOut()
    //=======
    {
        this.#map!.zoomOut()
    }

    /**
     * @returns A array of objects giving the path types
     *          present in the map along with their
     *          descriptions and colours
     */
    pathTypes(): PathType[]
    //=====================
    {
        if (this.#userInteractions !== null) {
            return this.#userInteractions.pathManager.pathTypes()
        }
    }

    /**
     * Hide or show paths of a given type.
     *
     * @param  pathType The path type(s) to hide or show
     * @param  enable   Show or hide paths of that type. Defaults to
     *                  ``true`` (show)
     */
    enablePath(pathTypes: string|string[], enable=true)
    //=================================================
    {
        if (this.#userInteractions !== null) {
            this.#userInteractions.enablePathsByType(pathTypes, enable)
        }
    }

    /**
     * Hide or show all paths valid in SCKAN.
     *
     * @param {string}   sckanState  Either ``valid`` or ``invalid``
     * @param {boolean}  enable  Show or hide paths with that SCKAN state.
     *                           Defaults to ``true`` (show)
     */
    enableSckanPath(sckanState, enable=true)
    //======================================
    {
        if (this.#userInteractions !== null) {
            this.#userInteractions.enableSckanPaths(sckanState, enable)
        }
    }

    /**
     * Show or hide connectivity features observed in particular species.
     *
     * @param taxonIds  A single taxon identifier or an array of identifiers.
     * @param enable  Show or hide connectivity paths and features.
     *                Defaults to ``true`` (show)
     */
    enableConnectivityByTaxonIds(taxonIds: string|string[], enable=true)
    //==================================================================
    {
        if (this.#userInteractions !== null) {
            this.#userInteractions.enableConnectivityByTaxonIds(taxonIds, enable)
        }
    }

    /**
     * Load images and patterns/textures referenced in style rules.
     *
     * @private
     */
    async #loadImage(url: string)
    //===========================
    {

        const response = await this.#map!.loadImage(url)
        return response.data
    }

    #loadEncodedImage(encodedImageUrl)
    //================================
    {
        return new Promise((resolve, _) => {
            const image = new Image()
            image.src = encodedImageUrl
            image.onload = (e) => resolve(e.target)
        })
    }

    async #addImage(id, path, baseUrl, options={})
    //============================================
    {
        if (!this.#map!.hasImage(id)) {
            const image = await (path.startsWith('data:image') ? this.#loadEncodedImage(path)
                                                               : this.#loadImage(path.startsWith('/') ? this.makeServerUrl(path)
                                                                                                      : new URL(path, baseUrl).href))
            this.#map!.addImage(id, <ImageBitmap>image, options)
        }
    }

    makeServerUrl(url, resource='flatmap/'): string
    //==============================================
    {
        if (url.startsWith('http://') || url.startsWith('https://')) {
            return url
        } else if (url.startsWith('/')) {
            // We don't want embedded `{` and `}` characters escaped
            return `${this.#baseUrl}${resource}${this.#uuid}${url}`
        } else {
            return `${this.#baseUrl}${resource}${this.#uuid}/${url}`
        }
    }

    /**
     * The taxon identifier of the species described by the map.
     *
     * @type string
     *
     * @group Properties
     */
    get taxon()
    //=========
    {
        return this.#taxon
    }

    /**
     * The biological sex identifier of the species described by the map.
     *
     * @group Properties
     */
    get biologicalSex(): string|null
    //==============================
    {
        return this.#biologicalSex
    }

    /**
     * The map's creation time.
     *
     * @type string
     *
     * @group Properties
     */
    get created()
    //===========
    {
        return this.#created
    }

    /**
     * The map's id as specified at generation time.
     *
     * @type string
     *
     * @group Properties
     */
    get id()
    //======
    {
        return this.#id
    }

    /**
     * The map's unique universal identifier.
     *
     * For published maps this is different to the map's ``id``
     * it might be the same as ``id`` for unpublished maps.
     *
     * @type string
     *
     * @group Properties
     */
    get uuid()
    //========
    {
        return this.#uuid
    }

    /**
     * The map's URL on the map server.
     *
     * @type string
     *
     * @group Properties
     */
    get url()
    //========
    {
        const url = this.makeServerUrl('')
        if (url.endsWith('/')) {
            return url.substring(0, url.length - 1)
        }
        return url
    }

    /**
     * The map's ``index.json`` as returned from the map server.
     *
     * @type Object
     *
     * @group Properties
     */
    get details()
    //===========
    {
        return this.#details
    }

    /**
     * @deprecated Replaced by ``FlatMap.mapMetadata`` since version 4.1.0
     *
     * @group Properties
     */
    get provenance()
    //==============
    {
        return this.mapMetadata
    }

    /**
     * The map's mapMetadata as returned from the map server.
     *
     * @type Object
     *
     * @group Properties
     */
    get mapMetadata()
    //===============
    {
        return this.#mapMetadata
    }

    /**
     * A unique identifier for the map within the viewer.
     *
     * @type string
     *
     * @group Properties
     */
    get uniqueId()
    //============
    {
        return `${this.#uuid}-${this.#container}`
    }

    /**
     * @group Properties
     */
    get annotations(): Map<GeoJSONId, FlatMapFeatureAnnotation>
    //=========================================================
    {
        return this.#idToAnnotation
    }

    /**
     * Get a feature's annotations given its GeoJSON id.
     *
     * @param      {string}  geojsonId  The features's GeoJSON identifier
     * @return     {FlatMapFeatureAnnotation}                    The feature's annotations
     */
    annotation(geojsonId: GeoJSONId): FlatMapFeatureAnnotation|null
    //=============================================================
    {
        return this.#idToAnnotation.get(+geojsonId) || null
    }

    /**
     * Get a feature's annotations given its external id.
     *
     * @param      {string}  annotationId  The features's external identifier
     * @return     {Object}                The feature's annotations
     */
    annotationById(annotationId: string): FlatMapFeatureAnnotation|null
    //=================================================================
    {
        if (this.#annIdToFeatureId.has(annotationId)) {
            const geojsonId = this.#annIdToFeatureId.get(annotationId) || -1
            return this.#idToAnnotation.get(+geojsonId) || null
        }
        return null
    }

    /**
     * Flag the feature as having external annotation.
     *
     * @param      {string}  featureId  The feature's external identifier
     */
    setFeatureAnnotated(featureId: string)
    //====================================
    {
        if (this.#userInteractions !== null) {
            this.#userInteractions.setFeatureAnnotated(featureId)
        }
    }

    #updateFeatureIdMapEntry(propertyId: string, featureIdMap: FeatureIdMap, featureId?: GeoJSONId)
    //=============================================================================================
    {
        if (featureId) {
            const id = utils.normaliseId(propertyId)
            const featureIds = featureIdMap.get(id)
            if (featureIds) {
                featureIds.push(featureId)
            } else {
                featureIdMap.set(id, [featureId])
            }
        }
    }

    #updateFeatureIdMap(property: string, featureIdMap: FeatureIdMap,
                        annotation: FlatMapFeatureAnnotation, missingId: string|null=null)
    //====================================================================================
    {
        // Exclude centrelines from our set of annotated features
        if (this.options.style !== FLATMAP_STYLE.CENTRELINE && annotation.centreline) {
            return
        }
        if (property in annotation && annotation[property].length) {
            const propertyId = annotation[property]
            if (Array.isArray(propertyId)) {
                for (const id of propertyId) {
                    this.#updateFeatureIdMapEntry(id, featureIdMap, annotation.featureId)
                }
            } else {
                this.#updateFeatureIdMapEntry(propertyId, featureIdMap, annotation.featureId)
            }
        } else if (missingId !== null
               && 'models' in annotation
               && annotation.models!.startsWith(APINATOMY_PATH_PREFIX)) {
            this.#updateFeatureIdMapEntry(missingId, featureIdMap, annotation.featureId)
        }
    }

    #saveAnnotation(featureId: GeoJSONId, ann: FlatMapFeatureAnnotation)
    //==================================================================
    {
        ann.featureId = featureId
        this.#idToAnnotation.set(+featureId, ann)
        this.#updateFeatureIdMap('dataset', this.#datasetToFeatureIds, ann)
        this.#updateFeatureIdMap('models', this.#modelToFeatureIds, ann)
        this.#updateFeatureIdMap('source', this.#mapSourceToFeatureIds, ann)
        this.#updateFeatureIdMap('taxons', this.#taxonToFeatureIds, ann, UNCLASSIFIED_TAXON_ID)

        // Annotations contain all of a feature's properties so note them
        // for the user to know what can be used for feature filtering

        for (const [key, value] of Object.entries(ann)) {
            if (!EXCLUDED_FEATURE_FILTER_PROPERTIES.includes(key)) {
                if (!this.#featurePropertyValues.has(key)) {
                    this.#featurePropertyValues.set(key, new Set())
                }
                const valueSet = this.#featurePropertyValues.get(key)
                if (Array.isArray(value)) {
                    this.#featurePropertyValues.set(key, valueSet.union(new Set(value.map(v => `${v}`))))
                } else {
                    valueSet.add(`${value}`)
                }
            }
        }
        this.#annIdToFeatureId.set(ann.id, featureId)

        // Pre-compute LineStrings of centrelines in centreline maps
        if (this.options.style === FLATMAP_STYLE.CENTRELINE && ann.centreline) {
            ann['lineString'] = turf.lineString(ann.coordinates!)
            ann['lineLength'] = turfLength.length(ann.lineString)
        }
    }

    modelFeatureIds(anatomicalId: string): GeoJSONId[]
    //================================================
    {
        const normalisedId = utils.normaliseId(anatomicalId)
        return this.#modelToFeatureIds.get(normalisedId) || []
    }

    modelFeatureIdList(anatomicalIds: string[]): GeoJSONId[]
    //======================================================
    {
        const featureIds = new utils.List<GeoJSONId>()
        if (Array.isArray(anatomicalIds)) {
            for (const id of anatomicalIds) {
                featureIds.extend(this.modelFeatureIds(id))
            }
        } else {
            featureIds.extend(this.modelFeatureIds(anatomicalIds))
        }
        if (featureIds.length == 0) {
            // We couldn't find a feature by anatomical id, so check dataset and source
            if (Array.isArray(anatomicalIds)) {
                for (const id of anatomicalIds) {
                    featureIds.extend(this.#datasetToFeatureIds.get(id) || [])
                    featureIds.extend(this.#mapSourceToFeatureIds.get(id) || [])
                }
            } else {
                featureIds.extend(this.#datasetToFeatureIds.get(anatomicalIds) || [])
                featureIds.extend(this.#mapSourceToFeatureIds.get(anatomicalIds) || [])
            }
        }
        if (featureIds.length == 0 && this.#userInteractions !== null) {
            // We still haven't found a feature, so check connectivity
            featureIds.extend(this.#userInteractions.pathFeatureIds(anatomicalIds))
        }
        return featureIds
    }

    modelForFeature(featureId: GeoJSONId): string|null
    //================================================
    {
        const ann = this.#idToAnnotation.get(+featureId)
        return (ann && 'models' in ann) ? utils.normaliseId(ann.models!) : null
    }

    /**
     * Get model terms of all paths connected to a node.
     *
     * @param      nodeId  The local (GeoJSON) identifier of a node
     * @return             Model terms of all paths connected to the node
     */
    nodePathModels(nodeId: GeoJSONId): Set<string>
    //============================================
    {
        if (this.#userInteractions !== null) {
            return this.#userInteractions.nodePathModels(nodeId)
        }
    }

    /**
     * Get GeoJSON feature ids of all nodes of a path model.
     *
     * @param  modelId  The path's model identifier
     * @return GeoJSON identifiers of features on the path
     */
    pathModelNodes(modelId: string): GeoJSONId[]
    //==========================================
    {
        if (this.#userInteractions !== null) {
            return [...this.#userInteractions.pathModelNodes(modelId)]
        }
        return []
    }

    /**
     * Get GeoJSON feature ids of all features identified with a taxon.
     *
     * @param  taxonId  The taxon identifier
     * @return          GeoJSON identifiers of features on the path
     */
    taxonFeatureIds(taxonId: string): GeoJSONId[]
    //===========================================
    {
        const featureIds = this.#taxonToFeatureIds.get(utils.normaliseId(taxonId))
        return [...new Set(featureIds ? featureIds : [])]
    }

    taxonName(taxonId: string): string
    //================================
    {
        if (this.#taxonNames.has(taxonId)) {
            return this.#taxonNames.get(taxonId)
        }
        return taxonId
    }

    async #setTaxonName(taxonId: string|null)
    //=======================================
    {
        if (taxonId && !this.#taxonNames.has(taxonId)) {
            const result = await this.queryLabels(taxonId)
            if (result.length && 'label' in result[0]) {
                return this.#taxonNames.set(taxonId, result[0]['label'])
            }
        }
    }

    /**
     * @group Properties
     */
    get layers()
    //==========
    {
        return this.#layers
    }

    /**
     * @group Properties
     */
    get map(): maplibregl.Map|null
    //============================
    {
        return this.#map
    }

    /**
     * The anatomical identifiers of features in the map.
     *
     * @type {Array.<string>}
     *
     * @group Properties
     */
    get anatomicalIdentifiers(): string[]
    //===================================
    {
        return [...this.#modelToFeatureIds.keys()]
    }

    /**
     * The taxon identifiers of species which the map's connectivity has been observed in.
     *
     * @type {Array.<string>}
     *
     * @group Properties
     */
    get taxonIdentifiers(): string[]
    //==============================
    {
        return [...this.#taxonToFeatureIds.keys()]
    }

    /**
     * Datasets associated with the map.
     *
     * @type {Array.<string>}
     *
     * @group Properties
     */
    get datasets(): string[]
    //======================
    {
        return [...this.#datasetToFeatureIds.keys()]
    }

    /**
     * @group Properties
     */
    get options()
    //===========
    {
        return this.#options
    }

    /**
     * @group Properties
     */
    get pathways(): FlatMapPathways
    //=============================
    {
        return this.#pathways
    }

    /**
     * Get the map's zoom settings.
     *
     * @return {Object.<{minZoom: number, zoom: number, maxZoom: number}>}  The map's minimum, current, and maximum zoom levels.
     */
    getZoom()
    //=======
    {
        return {
            mapUUID: this.#uuid,
            minZoom: this.#map!.getMinZoom(),
            zoom:    this.#map!.getZoom(),
            maxZoom: this.#map!.getMaxZoom()
        }
    }

    addCallback(callback: FlatMapCallback)
    //====================================
    {
        this.#callbacks.unshift(callback)
    }

    async callback(type: string, properties: ExportedFeatureProperties|ExportedFeatureProperties[])
    //=============================================================================================
    {
        const data = {...properties, mapUUID: this.#uuid}
        for (const callback of this.#callbacks) {
            const handled = await callback(type, data)
            if (handled) {
                break
            }
        }
    }

    close()
    //=====
    {
        if (this.#map) {
            this.#map.remove()
            this.#map = null
        }
    }

    closePane()
    //=========
    {
        this.close()
        this.callback('close-pane', {container: this.#container})
    }

    resize()
    //======
    {
        // Resize our map

        this.#map!.resize(undefined, false)
    }

    getIdentifier()
    //=============
    {
        // Return identifiers for reloading the map

        return {
            taxon: this.#taxon,
            biologicalSex: this.#biologicalSex,
            uuid: this.#uuid
        }
    }

    getState(): FlatMapState|null
    //===========================
    {
        return (this.#userInteractions !== null) ? this.#userInteractions.getState() : null
    }

    setState(state)
    //=============
    {
        if (this.#userInteractions !== null) {
            this.#userInteractions.setState(state)
        }
    }

    showPopup(featureId, content, options: FlatMapPopUpOptions={})
    //============================================================
    {
        if (this.#userInteractions !== null) {
            this.#userInteractions.showPopup(featureId, content, options)
        }
    }

    /**
     * Remove the currently active popup from the map.
     */
    removePopup()
    //===========
    {
        if (this.#userInteractions !== null) {
            this.#userInteractions.removePopup()
        }
    }

    setPaint(options={})
    //==================
    {
        options = utils.setDefaults(options, {
            coloured: true,
            outlined: true
        })
        if (this.#userInteractions !== null) {
            this.#userInteractions.setPaint(options)
        }
    }

    setColour(options={})
    //===================
    {
        console.log('`setColour()` is deprecated; please use `setPaint()` instead.')
        this.setPaint(options)
    }

    //==========================================================================

    /**
     * Get the map's current background colour.
     *
     * @return     {string}  The background colour.
     */
    getBackgroundColour(): string
    //===========================
    {
        return this.#map!.getPaintProperty('background', 'background-color') as string
    }

    /**
     * Get the map's current background opacity.
     *
     * @return     {number}  The background opacity.
     */
    getBackgroundOpacity(): number
    //============================
    {
        return this.#map!.getPaintProperty('background', 'background-opacity') as number
    }

    /**
     * Sets the map's background colour.
     *
     * @param      {string}  colour  The colour
     */
    setBackgroundColour(colour: string)
    //=================================
    {
        localStorage.setItem('flatmap-background-colour', colour)

        this.#map!.setPaintProperty('background', 'background-color', colour)

        if (this.#userInteractions!.minimap) {
            this.#userInteractions!.minimap.setBackgroundColour(colour)
        }
    }

    /**
     * Sets the map's background opacity.
     *
     * @param      {number}  opacity  The opacity
     */
    setBackgroundOpacity(opacity: number)
    //===================================
    {
        this.#map!.setPaintProperty('background', 'background-opacity', opacity)

        if (this.#userInteractions!.minimap) {
            this.#userInteractions!.minimap.setBackgroundOpacity(opacity)
        }
    }

    /**
     * Show and hide the minimap.
     *
     * @param {boolean}  show  Set false to hide minimap
     */
    showMinimap(show: boolean)
    //========================
    {
        if (this.#userInteractions!.minimap) {
            this.#userInteractions!.minimap.show(show)
        }

    }

    //==========================================================================

    /**
     * Get a list of the flatmap's layers.
     *
     * @return {Array.<{id: string, description: string, enabled: boolean}>}  An array with layer details
     */
    getLayers()
    //=========
    {
        if (this.#userInteractions !== null) {
            return this.#userInteractions.getLayers()
        }
    }

    /**
     * @param {string}  layerId  The layer identifier to enable
     * @param {boolean}  enable  Show or hide the layer. Defaults to ``true`` (show)
     *
     */
    enableLayer(layerId: string, enable=true)
    //=======================================
    {
        if (this.#userInteractions !== null) {
            return this.#userInteractions.enableLayer(layerId, enable)
        }
    }

    /**
     * Show/hide flight path view.
     *
     * @param      {boolean}  [enable=true]
     */
    enableFlightPaths(enable=true)
    //============================
    {
        if (this.#userInteractions !== null) {
            this.#userInteractions.enableFlightPaths(enable)
        }
    }

    //==========================================================================

    /**
     * Get a list of a FC flatmap's systems.
     *
     * @return {Array.<{id: string, name: string, colour: string, enabled: boolean}>}  An array with system details
     */
    getSystems()
    //==========
    {
        if (this.#userInteractions !== null) {
            return this.#userInteractions.getSystems()
        }
    }

    /**
     * @param {string}  systemId  The identifier of the system to enable
     * @param {boolean}  enable  Show or hide the system. Defaults to ``true`` (show)
     *
     */
    enableSystem(systemId: string, enable=true)
    //================================= ========
    {
        if (this.#userInteractions !== null) {
            return this.#userInteractions.enableSystem(systemId, enable)
        }
    }

    //==========================================================================
    //==========================================================================

    /**
     * Add a marker to the map.
     *
     * @param anatomicalId  The anatomical identifier of the feature on which
     *                      to place the marker.
     * @param options       Configurable options for the marker.
     * @return              The identifiers for the resulting markers. An empty array is returned if the
     *                      map doesn't contain a feature with the given anatomical identifier
     *
     * @group Markers
     */
    addMarker(anatomicalId: string,  options: FlatMapMarkerOptions={}): GeoJSONId[]
    //=============================================================================
    {
        if (this.#userInteractions !== null) {
            if (options.kind === 'multiscale') {
                return this.#userInteractions.addLayeredMarker(anatomicalId, options)
            } else {
                const markerId = this.#userInteractions.addMarker(anatomicalId, options)
                if (markerId > 0) {
                    return [markerId]
                }
            }
        }
        return []
    }

    /**
     * Add a list of markers to the map.
     *
     * @param {Array.<string>}  anatomicalIds  Anatomical identifiers of features on which
     *                                to place markers.
     * @param {FlatMapMarkerOptions} options          Configurable options for the markers.
     * @return     {array.<integer>}  The identifiers of the resulting markers. An empty array
     *                                is returned if the map doesn't contain a feature with
     *                                the given anatomical identifier
     *
     * @group Markers
     */
    addMarkers(anatomicalIds: string[],  options: FlatMapMarkerOptions={}): GeoJSONId[]
    //=================================================================================
    {
        options = Object.assign({cluster: true}, options)
        const markerIds: GeoJSONId[] = []
        for (const anatomicalId of anatomicalIds) {
            if (this.#userInteractions !== null) {
                if (options.kind === 'multiscale') {
                    const markerIds = this.#userInteractions.addLayeredMarker(anatomicalId, options)
                    markerIds.push(...markerIds)
                } else {
                    const markerId = this.#userInteractions.addMarker(anatomicalId, options)
                    if (markerId > 0) {
                        markerIds.push(markerId)
                    }
                }
            }
        }
        return markerIds
    }

    /**
     * Remove a marker from the map.
     *
     * @param      {integer}  markerId  The identifier of the marker, as returned
     *                                  by ``addMarker()``
     *
     * @group Markers
     */
    removeMarker(markerId: number)
    //============================
    {
        if (markerId > -1 && this.#userInteractions !== null) {
            this.#userInteractions.removeMarker(markerId)
        }
    }

    /**
     * Remove all markers from the map.
     *
     * @group Markers
     */
    clearMarkers()
    //============
    {
        if (this.#userInteractions !== null) {
            this.#userInteractions.clearMarkers()
        }
    }

    /**
     * Return the set of anatomical identifiers of the markers visible
     * in the current map view.
     *
     * @return {Array.<string>} A list of identifiers
     *
     * @group Markers
     */
    visibleMarkerAnatomicalIds(): string[]
    //====================================
    {
        if (this.#userInteractions !== null) {
            return this.#userInteractions.visibleMarkerAnatomicalIds()
        }
    }

    /**
     * Shows a popup at a marker.
     *
     * This method should only be called in response to a ``mouseenter`` event
     * passed to the map's ``callback`` function otherwise a popup won't be shown.
     *
     * @param      {integer}  markerId  The identifier of the marker
     * @param      {string | DOMElement}  content  The popup's content
     * @param      {Object}  options
     * @returns    {boolean} Return true if the popup is shown
     *
     * The resulting popup is given a class name of ``flatmap-tooltip-popup``.
     *
     * @group Markers
     */
    showMarkerPopup(markerId, content, options={}): boolean
    //=====================================================
    {
        if (this.#userInteractions !== null) {
            return this.#userInteractions.showMarkerPopup(markerId, content, options)
        }
        return false
    }

    //==========================================================================

    /**
     * Add dataset markers to the map.
     *
     * @param {Array.<{id: string, terms: string[]}>} datasets  An array with an object for each dataset,
     *                                                          specifying its identifier and an array of
     *                                                          associated anatomical terms
     *
     * @group Markers
     */
    addDatasetMarkers(datasets: DatasetTerms[])
    //=========================================
    {
        if (this.#userInteractions !== null) {
            this.#userInteractions.addDatasetMarkers(datasets)
        }
    }

    /**
     * Remove all dataset markers from the map.
     *
     * @group Markers
     */
    clearDatasetMarkers()
    //===================
    {
        if (this.#userInteractions !== null) {
            this.#userInteractions.clearDatasetMarkers()
        }
    }

    /**
     * Remove markers for a dataset from the map.
     *
     * @param datasetId  A dataset marker identifier as passed
     *                   to ``addDatasetMarkers()``
     *
     * @group Markers
     */
    removeDatasetMarker(datasetId: string)
    //====================================
    {
        if (this.#userInteractions !== null) {
            this.#userInteractions.removeDatasetMarker(datasetId)
        }
    }

    //==========================================================================
    //==========================================================================

    exportedFeatureProperties(properties: FlatMapFeatureAnnotation): ExportedFeatureProperties
    //========================================================================================
    {
        const data = {}
        for (const property of EXPORTED_FEATURE_PROPERTIES) {
            if (property in properties) {
                const value = properties[property]
                if (value) {
                    if ((Array.isArray(value) && value.length)
                     || (value.constructor === Object && Object.keys(value).length)) {
                        data[property] = value
                    } else if (property === 'featureId') {
                        data[property] = +value;  // Ensure numeric
                    } else if (ENCODED_FEATURE_PROPERTIES.includes(property)) {
                        data[property] = JSON.parse(`${value}`)
                    } else {
                        data[property] = value
                    }
                }
            }
        }
        if (Object.keys(data).length > 0) {
            data['type'] = 'feature'
        }
        return data
    }

    /**
     * Show or hide a tool for drawing regions to annotate on the map.
     *
     * @param  {boolean}  [visible=true]
     */
    showAnnotator(visible: boolean=true)
    //==================================
    {
        if (this.#userInteractions !== null) {
            this.#userInteractions.showAnnotator(visible)
        }
    }

    /**
     * Generate an ``annotation`` callback event when a drawn annotation has been created
     * a modified.
     *
     * @param eventType {string}   Either ``created``, ``updated`` or ``deleted``
     * @param feature   {AnnotatedFeature}   A feature object with ``id``, ``type``, and ``geometry``
     *                             fields of a feature that has been created, updated or
     *                             deleted.
     */
    annotationEvent(eventType: string, feature: AnnotatedFeature)
    //===========================================================
    {
        this.callback('annotation', {
            type: eventType,
            feature: feature
        })
    }

    /**
     * Mark a drawn/changed annotation as having been accepted by the user.
     *
     * @param event      {AnnotationEvent}     The object as received in an annotation callback
     */
    commitAnnotationEvent(event: AnnotationEvent)
    //===========================================
    {
        if (this.#userInteractions) {
            this.#userInteractions.commitAnnotationEvent(event)
        }
    }

    /**
     * Mark a drawn/changed annotation as having been rejected by the user.
     *
     * @param event      {AnnotationEvent}     The object as received in an annotation callback
     */
    rollbackAnnotationEvent(event: AnnotationEvent)
    //=============================================
    {
        if (this.#userInteractions) {
            this.#userInteractions.rollbackAnnotationEvent(event)
        }
    }

    /**
     * Clear all drawn annotations from current annotation layer.
     */
    clearAnnotationFeature()
    //======================
    {
        if (this.#userInteractions) {
            this.#userInteractions.clearAnnotationFeatures()
        }
    }

    /**
     * Delete the selected drawn feature
     */
    removeAnnotationFeature()
    //=======================
    {
        if (this.#userInteractions) {
            this.#userInteractions.removeAnnotationFeature()
        }
    }

    /**
     * Add a drawn feature to the annotation drawing tool.
     *
     * @param feature    {AnnotatedFeature}        The feature to add
     */
    addAnnotationFeature(feature: AnnotatedFeature)
    //=============================================
    {
        if (this.#userInteractions) {
            this.#userInteractions.addAnnotationFeature(feature)
        }
    }

    /**
     * Return the feature as it is currently drawn. This is so
     * the correct geometry can be saved with a feature should
     * a user make changes before submitting dialog provided
     * by an external annotator.
     *
     * @param feature    {Object}  The drawn feature to refresh.
     * @returns {Object|null}  The feature with currently geometry or ``null``
     *                         if the feature has been deleted.
     */
    refreshAnnotationFeatureGeometry(feature: AnnotatedFeature): AnnotatedFeature|null
    //================================================================================
    {
        if (this.#userInteractions) {
            return this.#userInteractions.refreshAnnotationFeatureGeometry(feature)
        }
        return null
    }

    /**
     * Changes the mode for drawing annotations.
     */
    changeAnnotationDrawMode(mode: AnnotationDrawMode)
    //================================================
    {
        if (this.#userInteractions) {
            this.#userInteractions.changeAnnotationDrawMode(mode)
        }
    }

    /**
     * Generate a callback as a result of some event with a flatmap feature.
     *
     * @param      {string}  eventType     The event type
     * @param      {Object}  properties    Properties associated with the feature
     */
    featureEvent(eventType: string, properties: FlatMapFeatureAnnotation|FlatMapFeatureAnnotation[])
    //==============================================================================================
    {

        if (Array.isArray(properties)) {
            const featureData: ExportedFeatureProperties[] = []
            for (const p of properties) {
                const data = this.exportedFeatureProperties(p)
                if (Object.keys(data).length > 0) {
                    featureData.push(data)
                }
            }
            if (featureData.length === 1) {
                this.callback(eventType, featureData[0])
                return true
            } else if (featureData.length) {
                this.callback(eventType, featureData)
                return true
            }
        } else {
            const data = this.exportedFeatureProperties(properties)
            if (Object.keys(data).length > 0) {
                this.callback(eventType, data)
                return true
            }
        }
        return false
    }

    /**
     * Return properties associated with a feature.
     *
     * @param      featureId  The feature's internal (GeoJSON) id
     * @returns               Properties associated with the feature
     */
    featureProperties(featureId: GeoJSONId): ExportedFeatureProperties
    //================================================================
    {
        const properties = this.annotation(featureId)
        return properties ? this.exportedFeatureProperties(properties) : {}
    }

    /**
     * Generate a callback as a result of some event with a marker.
     *
     * @param      {string}  eventType   The event type
     * @param      {integer}  markerId   The marker's GeoJSON identifier
     * @param      {Object}  properties  Properties associated with the marker
     */
    markerEvent(eventType: string, markerId: number, properties: FlatMapFeatureAnnotation)
    //====================================================================================
    {

        const data = Object.assign({}, this.exportedFeatureProperties(properties), {
            type: 'marker',
            id: markerId
        })
        this.callback(eventType, data)
    }

    /**
     * Generate a callback as a result of some event in a control.
     *
     * @param      {string}  eventType     The event type
     * @param      {string}  control       The name of the control
     * @param      {string}  value         The value of the control
     */
    controlEvent(eventType: string, control: string, value: string)
    //=============================================================
    {
        this.callback(eventType, {
            type: 'control',
            control: control,
            value: value
        })
    }

    /**
     * Generate callbacks as a result of panning/zooming the map.
     *
     * @param {boolean}   enabled  Generate callbacks when ``true``,
     *                             otherwise disable them.
     */
    enablePanZoomEvents(enabled: boolean=true)
    //========================================
    {
        if (this.#userInteractions !== null) {
            this.#userInteractions.enablePanZoomEvents(enabled)
        }
    }

    /**
     * Generate a callback as a result of panning/zooming the map.
     *
     * @param {string}         type    The event type, ``pan`` or ``zoom``.
     */
    panZoomEvent(type: string)
    //========================
    {
        const bounds = this.#map!.getBounds()
        if (this.#normalisedOrigin) {
            const sw = maplibregl.MercatorCoordinate.fromLngLat(bounds.toArray()[0])
            const ne = maplibregl.MercatorCoordinate.fromLngLat(bounds.toArray()[1])
            const top_left: Point2D = [(sw.x - this.#normalisedOrigin[0])/this.#normalised_size[0],
                                       (ne.y - this.#normalisedOrigin[1])/this.#normalised_size[1]]
            const size: Size2D = [(ne.x - sw.x)/this.#normalised_size[0],
                                  (sw.y - ne.y)/this.#normalised_size[1]]
            this.callback('pan-zoom', {
                type: type,
                origin: top_left,
                size: size
            })
        }
    }

    /**
     * Pan/zoom the map to a new view
     *
     * @param {[number, number]}  origin  The map's normalised top-left corner
     * @param {[number, number]}  size    The map's normalised size
     */
    panZoomTo(origin: [number, number], size: [number, number])
    //=========================================================
    {
        if (this.#normalisedOrigin) {
            const sw_x = origin[0]*this.#normalised_size[0] + this.#normalisedOrigin[0]
            const ne_y = origin[1]*this.#normalised_size[1] + this.#normalisedOrigin[1]
            const ne_x = sw_x + size[0]*this.#normalised_size[0]
            const sw_y = ne_y + size[1]*this.#normalised_size[1]
            const sw = (new maplibregl.MercatorCoordinate(sw_x, sw_y, 0)).toLngLat()
            const ne = (new maplibregl.MercatorCoordinate(ne_x, ne_y, 0)).toLngLat()
            this.#map!.fitBounds([sw, ne], {animate: false})
        }
    }

    //==========================================================================

    /**
     * Find features with labels or terms matching ``text``.
     *
     * @param      {string}   text          The text to search
     * @param      {boolean}  [auto=false]  If ``true`` return suggestions of text to search for.
     * @return     Either a ``Searchresults`` object with fields of ``featureIds`` and ``results``,
     *             where ``results`` has ``featureId``, ``score``, ``terms`` and ``text`` fields,
     *             or a `Suggestion` object containing suggested matches
     *             (see https://lucaong.github.io/minisearch/types/MiniSearch.Suggestion.html).
     */
    search(text: string, auto: boolean=false)
    //=======================================
    {
        if (auto) {
            return this.#searchIndex.auto_suggest(text)
        } else {
            return this.#searchIndex.search(text)
        }
    }

    clearSearchResults()
    //==================
    {
        if (this.#userInteractions !== null) {
            this.#userInteractions.clearSearchResults()
        }
    }

    showSearchResults(searchResults)
    //==============================
    {
        if (this.#userInteractions !== null) {
            this.#userInteractions.showSearchResults(searchResults.featureIds)
        }
    }

    //==========================================================================

    /**
     * Select features on the map.
     *
     * @param  externalIds  An array of anaotomical terms identifing features to select
     */
    selectFeatures(externalIds: string[])
    //====================================
    {
        if (this.#userInteractions !== null) {
            const featureIds = this.modelFeatureIdList(externalIds)
            this.#userInteractions.selectFeatures(featureIds)
        }
    }

    /**
     * Select features and zoom the map to them.
     *
     * @param      {Array.<string>}  featureIds   An array of feature identifiers
     * @param      {Object}  [options]
     * @param      {boolean} [options.zoomIn=false]  Zoom in the map (always zoom out as necessary)
     * @param      {string} [options.selection='clear']  `clear`, `expand`, or `contract` the current selection
     */
    zoomToFeatures(externalIds: string[], options: FeatureZoomOptions={})
    //===================================================================
    {
        options = utils.setDefaults(options, {
            select: true,
            highlight: false,
            padding: 100
        })
        if (this.#userInteractions !== null) {
            const featureIds = this.modelFeatureIdList(externalIds)
            this.#userInteractions.zoomToFeatures(featureIds, options)
        }
    }

    /**
     * Select features on the map.
     *
     * @param  geojsonIds  A single GeoJSON feature identifiers
     *                     or an array of identifiers.
     */
    selectGeoJSONFeatures(geojsonIds: GeoJSONId|GeoJSONId[])
    //======================================================
    {
        if (this.#userInteractions !== null) {
            this.#userInteractions.selectFeatures(Array.isArray(geojsonIds) ? geojsonIds : [geojsonIds])
        }
    }

    /**
     * Unselect all features on the map.
     */
    unselectGeoJSONFeatures()
    //=======================
    {
        if (this.#userInteractions !== null) {
            this.#userInteractions.unselectFeatures()
        }
    }

    /**
     * Select features and zoom the map to them.
     *
     * @param  geojsonIds  An array of  GeoJSON feature identifiers
     * @param {boolean} [options.zoomIn=false]  Zoom in the map (always zoom out as necessary)
     */
    zoomToGeoJSONFeatures(geojsonIds: GeoJSONId[], options?: {zoomIn?: boolean})
    //==========================================================================
    {
        options = utils.setDefaults(options, {
            select: true,
            highlight: false,
            padding:100
        })
        if (this.#userInteractions !== null) {
            this.#userInteractions.zoomToFeatures(geojsonIds, options)
        }
    }

    //==========================================================================

    /**
     * Display an image on a given anatomical feature.
     *
     * @param   {string}   anatomicalId     The anatomical identifier of the feature on which
     *                                      to place the image. The image is scaled to fit within
     *                                      the feature's bounding box.
     * @param   {string}   imageUrl         The URL of the image to display.
     * @return  {string|null}               A identifying the image(s) added to the map. A map may
     *                                      have several features corresponding to a particular
     *                                      anatomical identifier, which will result in an image
     *                                      being placed on each feature. ``null`` is returned if
     *                                      there are no features with the given ``anatomicalId``.
     */
    addImage(anatomicalId: string, imageUrl: string, options={}): string|null
    //=======================================================================
    {
        if (this.#userInteractions !== null) {
            return this.#userInteractions.addImage(anatomicalId, imageUrl, options)
        }
        return null
    }

    /**
     * Remove images for an anatomical features.
     *
     * @param   {string}   mapImageId       An image identifier previously returned by ``addImage()``.
     */
    removeImage(mapImageId: string)
    //=============================
    {
        if (this.#userInteractions !== null) {
            this.#userInteractions.removeImage(mapImageId)
        }
    }

    //==========================================================================

    /**
     * Get a details of the nerve centrelines in the map.
     */
    getNerveDetails(): CentrelineDetails[]
    //====================================
    {
        if (this.#userInteractions !== null) {
            return this.#userInteractions.getNerveDetails()
        }
        return []
    }

    /**
     * Enable/disable the neuron paths associated with a nerve centreline.
     *
     * @param   nerveModels   Anatomical identifiers of nerve centrelines
     * @param   [enable=true]
     */
    enableNeuronPathsByNerve(nerveModels: string|string[], enable: boolean=true)
    //==========================================================================
    {
        if (this.#userInteractions !== null) {
            this.#userInteractions.enableNeuronPathsByNerve(nerveModels, enable)
        }
    }

    //==========================================================================

    /**
     * @group Properties
     */
    get knowledgeSource()
    //===================
    {
        return this.#knowledgeSource
    }

    /**
     * Get labels for entities from the flatmap's server's knowledge store.
     *
     * @param   entities  Anatomical identifiers of entities.
     */
    async queryLabels(entities: string|string[]): Promise<EntityLabel[]>
    //==================================================================
    {
        const entityLabels: {entity: string, label: string}[] = []
        const entityArray = Array.isArray(entities) ? entities
                          : entities ? [entities]
                          : []
        if (entityArray.length > 0) {
            if (this.#mapServer.knowledgeSchema >= KNOWLEDGE_SOURCE_SCHEMA) {
                const rows = await this.#mapServer.queryKnowledge(
                                    `select source, entity, knowledge from knowledge
                                        where (source=? or source is null)
                                           and entity in (?${', ?'.repeat(entityArray.length-1)})
                                        order by entity, source desc`,
                                    [this.#knowledgeSource, ...entityArray])
                let last_entity: string|null = null
                for (const row of rows) {
                    // In entity, source[desc] order; we use the most recent label
                    if (row[1] !== last_entity) {
                        const knowledge = JSON.parse(row[2])
                        entityLabels.push({
                            entity: row[1],
                            label: knowledge['label'] || row[1]
                        })
                        last_entity = row[1]
                    }
                }
            } else {
                const rows = await this.#mapServer.queryKnowledge(
                                    `select entity, label from labels
                                        where entity in (?${', ?'.repeat(entityArray.length-1)})`,
                                    entityArray)
                return rows.map(entityLabel => {
                    return {
                        entity: entityLabel[0],
                        label: entityLabel[1]
                    }
                })
            }
        }
        return entityLabels
    }

    /**
     * Get knowledge about an entity from the flatmap's server's knowledge store.
     *
     * @param   entity  The URI of an entity.
     * @return  {Object}          JSON describing the entity.
     */
    async queryKnowledge(entity: string)
    //==================================
    {
        const rows = (this.#mapServer.knowledgeSchema >= KNOWLEDGE_SOURCE_SCHEMA)
                   ? await this.#mapServer.queryKnowledge(
                             'select knowledge from knowledge where (source=? or source is null) and entity=? order by source desc',
                             [this.#knowledgeSource, entity])
                   : await this.#mapServer.queryKnowledge(
                             'select knowledge from knowledge where entity=?',
                             [entity])
        // Rows are in source[desc] order; we use the most recent
        return rows.length ? JSON.parse(rows[0]) : {}
    }

    /**
     * Get all paths associated with a set of features.
     *
     * @param      {string|string[]}    entities  Anatomical terms of features
     * @return     {Promise<string[]>}  A Promise resolving to an array of path identifiers
     */
    async queryPathsForFeatures(entities)
    //===================================
    {
        const featureEntities = Array.isArray(entities) ? entities
                              : entities ? [entities]
                              : []
        const featureIds: number[] = []
        for (const anatomicalId of featureEntities) {
            featureIds.push(...this.modelFeatureIds(anatomicalId))
        }
        const featurePaths = await this.getPathsForGeoJsonFeatures(featureIds)
        return featurePaths
    }

    /**
     * Get all paths associated with a set of features.
     *
     * @param  geojsonIds  GeoJSON ids of features
     * @return A Promise resolving to an array of path identifiers
     */
    async getPathsForGeoJsonFeatures(geojsonIds: GeoJSONId|GeoJSONId[]): Promise<string[]>
    //====================================================================================
    {
        if (this.#mapServer.knowledgeSchema < KNOWLEDGE_SOURCE_SCHEMA) {
            return []
        }
        const featureIds = Array.isArray(geojsonIds) ? geojsonIds
                              : geojsonIds ? [geojsonIds]
                              : []
        const uniqueIds = new Set(featureIds)
        const connectivityNodes: Set<string> = new Set()
        for (const featureId of uniqueIds) {
            const annotation = this.#idToAnnotation.get(+featureId)
            if (annotation && 'anatomical-nodes' in annotation) {
                for (const node of annotation['anatomical-nodes']!) {
                    connectivityNodes.add(node)
                }
            }
        }
        if (connectivityNodes.size > 0) {
            const rows = await this.#mapServer.queryKnowledge(
                                `select path from connectivity_nodes
                                    where source=? and node in (?${', ?'.repeat(connectivityNodes.size-1)})
                                    order by node, path, source desc`,
                                [this.#knowledgeSource, ...connectivityNodes.values()])
            const featurePaths = new Set(rows.map(row => row[0]))
            return [...featurePaths.values()]
        }
        return []
    }

    //==========================================================================

    addCloseControl()
    //===============
    {
        if (this.#userInteractions !== null) {
            this.#userInteractions.addCloseControl()
        }
    }

    removeCloseControl()
    //===============
    {
        if (this.#userInteractions !== null) {
            this.#userInteractions.removeCloseControl()
        }
    }

    //==========================================================================

}   // End of FlatMap class

//==============================================================================
