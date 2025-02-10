/*==============================================================================

Flatmap viewer and annotation tool

Copyright (c) 2019  David Brooks

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
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import * as turf from '@turf/helpers'
import * as turfLength from "@turf/length";

//==============================================================================

// Load our stylesheet last so we can overide styling rules

import '../static/css/flatmap-viewer.css';

//==============================================================================

import {KNOWLEDGE_SOURCE_SCHEMA, MapServer} from './mapserver'
import {SearchIndex} from './search'
import {UserInteractions} from './interactions'
import {MapTermGraph, SparcTermGraph} from './knowledge'

import {APINATOMY_PATH_PREFIX} from './pathways'

import {loadClusterIcons} from './layers/acluster'

import * as images from './images'
import * as utils from './utils'

//==============================================================================

// The released version of the viewer
export const VIEWER_VERSION = '3.2.13'

//==============================================================================

const MAP_MAKER_SEPARATE_LAYERS_VERSION = 1.4;
const MAP_MAKER_FLIGHTPATHS_VERSION = 1.6

//==============================================================================

/**
 * The taxon identifier used when none has been given.
 *
 * @type       {string}
 */
export const UNCLASSIFIED_TAXON_ID = 'NCBITaxon:2787823';   // unclassified entries

//==============================================================================


const EXCLUDED_FEATURE_FILTER_KEYS = [
    'bounds',
    'class',
    'coordinates',
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

//==============================================================================

export class FLATMAP_STYLE
{
    static FUNCTIONAL = 'functional'
    static ANATOMICAL = 'anatomical'
    static CENTRELINE = 'centreline'
    static GENERIC = 'flatmap'
}

//==============================================================================

/**
* Maps are not created directly but instead are created and loaded by
* :meth:`LoadMap` of :class:`MapManager`.
*/
export class FlatMap
{
    #baseUrl
    #callbacks = []
    #knowledgeSource = ''
    #mapServer
    #mapTermGraph
    #startupState = -1
    #taxonNames = new Map()

    constructor(container, mapServer, mapDescription, resolve)
    {
        this.#mapServer = mapServer
        this.#baseUrl = mapServer.url()
        this.__id = mapDescription.id;
        this.__uuid = mapDescription.uuid;
        this.__details = mapDescription.details;
        this.__provenance = mapDescription.provenance;
        this.__created = mapDescription.created;
        this.__taxon = mapDescription.taxon;
        this.__biologicalSex = mapDescription.biologicalSex;
        this._mapNumber = mapDescription.number;
        this.#callbacks.push(mapDescription.callback)
        this._layers = mapDescription.layers;
        this._options = mapDescription.options;
        this._pathways = mapDescription.pathways;
        this._resolve = resolve;
        this._map = null;
        this.__searchIndex = new SearchIndex(this);
        this.__idToAnnotation = new Map();
        this.__datasetToFeatureIds = new Map();
        this.__modelToFeatureIds = new Map();
        this.__mapSourceToFeatureIds = new Map();
        this.__annIdToFeatureId = new Map();
        this.__taxonToFeatureIds = new Map();
        this.__featurePropertyValues = new Map()
        this.#mapTermGraph = new MapTermGraph(mapDescription.sparcTermGraph)

        const sckanProvenance = mapDescription.details.connectivity
        if (sckanProvenance === undefined) {
            this.#knowledgeSource = this.#mapServer.latestSource
        } else if ('knowledge-source' in sckanProvenance) {
            this.#knowledgeSource = sckanProvenance['knowledge-source']
        } else if ('npo' in sckanProvenance) {
            this.#knowledgeSource = `${sckanProvenance.npo.release}-npo`
        } else {
            this.#knowledgeSource = this.#mapServer.latestSource
        }

        for (const [featureId, annotation] of Object.entries(mapDescription.annotations)) {
            this.__saveAnnotation(featureId, annotation);
            this.__searchIndex.indexMetadata(featureId, annotation);
        }

        // Set base of source URLs in map's style

        for (const [id, source] of Object.entries(mapDescription.style.sources)) {
            if (source.url) {
                source.url = this.makeServerUrl(source.url);
            }
            if (source.tiles) {
                const tiles = [];
                for (const tileUrl of source.tiles) {
                    tiles.push(this.makeServerUrl(tileUrl));
                }
                source.tiles = tiles;
            }
        }

        // Ensure rounded background images (for feature labels) are loaded

        if (!('images' in mapDescription.options)) {
            mapDescription.options.images = [];
        }
        for (const image of images.LABEL_BACKGROUNDS) {
            let found = false;
            for (const im of mapDescription.options.images) {
                if (image.id === im.id) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                mapDescription.options.images.push(image);
            }
        }

        // Set options for the map

        const mapOptions = {
            style: mapDescription.style,
            container: container,
            attributionControl: false
        };

        if ('maxZoom' in mapDescription.options) {
            mapOptions.maxZoom = mapDescription.options.maxZoom - 0.001
        }
        if ('minZoom' in mapDescription.options) {
            mapOptions.minZoom = mapDescription.options.minZoom
        }

        // Only show location in address bar when debugging

        mapOptions.hash = (mapDescription.options.debug === true);

        // Set bounds if it is set in the map's options

        if ('bounds' in mapDescription.options) {
            mapOptions.bounds = mapDescription.options.bounds
        }

        // Create the map

        this._map = new maplibregl.Map(mapOptions);

        // Show extra information if debugging

        if (mapDescription.options.debug === true) {
            this._map.showTileBoundaries = true;
            this._map.showCollisionBoxes = true;
        }

        // Don't wrap around at +/-180 degrees

        this._map.setRenderWorldCopies(false);

        // Disable map rotation

        //this._map.dragRotate.disable();
        //this._map.touchZoomRotate.disableRotation();

        // Finish initialisation when all sources have loaded
        // and map has rendered

        this._userInteractions = null;
        this._initialState = null;

        this._map.on('idle', () => {
            if (this.#startupState === -1) {
                this.#startupState = 0
                this.setupUserInteractions_();
            } else if (this.#startupState === 1) {
                this.#startupState = 2
                this._map.setRenderWorldCopies(true)
                this._bounds = this._map.getBounds();
                const bounds = this._bounds.toArray();
                const sw = maplibregl.MercatorCoordinate.fromLngLat(bounds[0]);
                const ne = maplibregl.MercatorCoordinate.fromLngLat(bounds[1]);
                this.__normalised_origin = [sw.x, ne.y];
                this.__normalised_size = [ne.x - sw.x, sw.y - ne.y];
                if ('state' in this._options) {
                    this._userInteractions.setState(this._options.state);
                }
                this._initialState = this.getState();
                if (this._userInteractions.minimap) {
                    this._userInteractions.minimap.initialise()
                }
                this._map.setMaxBounds(bounds)
                this._map.fitBounds(bounds, {animate: false})
                this.#startupState = 3
                this._resolve(this);
            }
        });
    }

    async setupUserInteractions_()
    //============================
    {
        // Get names of the taxons we have
        await this.#setTaxonName(this.__taxon)
        for (const taxon of this.taxonIdentifiers) {
            await this.#setTaxonName(taxon)
        }

        // Load any images required by the map
        for (const image of this._options.images) {
            await this.addImage(image.id, image.url, '', image.options);
        }

        // Load icons used for clustered markers
        await loadClusterIcons(this._map)

        // Load anatomical term hierarchy for the flatmap
        const termGraph = await this.#mapServer.loadJSON(`flatmap/${this.__uuid}/termgraph`)
        this.#mapTermGraph.load(termGraph)

        // Layers have now loaded so finish setting up
        this._userInteractions = new UserInteractions(this);

        // Continue initialising when next idle
        this.#startupState = 1
    }

    /**
     * The flatmap's bounds.
     */
    get bounds()
    //==========
    {
        return this._bounds;
    }

    /**
     * Does the flatmap contain flightpath information?
     *
     * @return boolean
     */
    get has_flightpaths()
    //===================
    {
        return 'version' in this.__details
            && this.__details.version >= MAP_MAKER_FLIGHTPATHS_VERSION
    }

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
        for (const [key, value] of this.__featurePropertyValues.entries()) {
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
        if (this._userInteractions !== null) {
            this._userInteractions.clearVisibilityFilter()
        }
    }

    /**
     * Sets a visibility filter for features and paths
     *
     * @param {PropertiesFilterExpression}  [filterExpression=true]  The filter specification
     */
    setVisibilityFilter(filterExpression=true)
    //========================================
    {
        if (this._userInteractions !== null) {
            this._userInteractions.setVisibilityFilter(filterExpression)
        }
    }

    // Map control methods

    /**
     * Reset a map to its initial state.
     */
    resetMap()
    //========
    {
        if (this._initialState !== null) {
            this.setState(this._initialState);
        }
        if (this._userInteractions !== null) {
            this._userInteractions.reset();
        }
    }

    /**
     * Zoom the map in.
     */
    zoomIn()
    //======
    {
        this._map.zoomIn();
    }

    /**
     * Zoom the map out.
     */
    zoomOut()
    //=======
    {
        this._map.zoomOut();
    }

    /**
     * @returns {Array.<{type: string, label: string, colour: string}>} an array of objects giving the path types
     *                                                                  present in the map along with their
     *                                                                  descriptions and colours
     */
    pathTypes()
    //=========
    {
        if (this._userInteractions !== null) {
            return this._userInteractions.pathManager.pathTypes();
        }
    }

    /**
     * Hide or show paths of a given type.
     *
     * @param {string[]|string}  pathType The path type(s) to hide or show
     * @param {boolean}          enable   Show or hide paths of that type. Defaults to
     *                                    ``true`` (show)
     */
    enablePath(pathType, enable=true)
    //===============================
    {
        if (this._userInteractions !== null) {
            this._userInteractions.enablePathsByType(pathType, enable);
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
        if (this._userInteractions !== null) {
            this._userInteractions.enableSckanPaths(sckanState, enable);
        }
    }

    /**
     * Show or hide connectivity features observed in particular species.
     *
     * @param {string | Array.<string>}   taxonId(s)  A single taxon identifier
     *                                                or an array of identifiers.
     * @param {boolean}  enable  Show or hide connectivity paths and features.
     *                           Defaults to ``true`` (show)
     */
    enableConnectivityByTaxonIds(taxonIds, enable=true)
    //=================================================
    {
        if (this._userInteractions !== null) {
            this._userInteractions.enableConnectivityByTaxonIds(taxonIds, enable);
        }
    }

    /**
     * Load images and patterns/textures referenced in style rules.
     *
     * @private
     */
    loadImage_(url)
    //=============
    {
        return new Promise((resolve, reject) => {
            this._map.loadImage(url, (error, image) => {
                if (error) reject(error);
                else resolve(image);
            });
        });
    }

    loadEncodedImage_(encodedImageUrl)
    //================================
    {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.src = encodedImageUrl;
            image.onload = (e) => resolve(e.target);
        });
    }

    async addImage(id, path, baseUrl, options={})
    //===========================================
    {
        if (!this._map.hasImage(id)) {
            const image = await (path.startsWith('data:image') ? this.loadEncodedImage_(path)
                                                               : this.loadImage_(path.startsWith('/') ? this.makeServerUrl(path)
                                                                                                      : new URL(path, baseUrl)));
            this._map.addImage(id, image, options);
        }
    }

    makeServerUrl(url, resource='flatmap/')
    //=====================================
    {
        if (url.startsWith('http://') || url.startsWith('https://')) {
            return url;
        } else if (url.startsWith('/')) {
            // We don't want embedded `{` and `}` characters escaped
            return `${this.#baseUrl}${resource}${this.__uuid}${url}`;
        } else {
            return `${this.#baseUrl}${resource}${this.__uuid}/${url}`;
        }
    }

    /**
     * The taxon identifier of the species described by the map.
     *
     * @type string
     */
    get taxon()
    //=========
    {
        return this.__taxon;
    }

    /**
     * The biological sex identifier of the species described by the map.
     *
     * @type string
     */
    get biologicalSex()
    //=================
    {
        return this.__biologicalSex;
    }

    /**
     * The map's creation time.
     *
     * @type string
     */
    get created()
    //===========
    {
        return this.__created;
    }

    /**
     * The map's id as specified at generation time.
     *
     * @type string
     */
    get id()
    //======
    {
        return this.__id;
    }

    /**
     * The map's unique universal identifier.
     *
     * For published maps this is different to the map's ``id``;
     * it might be the same as ``id`` for unpublished maps.
     *
     * @type string
     */
    get uuid()
    //========
    {
        return this.__uuid;
    }

    /**
     * The map's URL on the map server.
     *
     * @type string
     */
    get url()
    //========
    {
        let url = this.makeServerUrl('')
        if (url.endsWith('/')) {
            return url.substring(0, url.length - 1)
        }
        return url
    }

    /**
     * The map's ``index.json`` as returned from the map server.
     *
     * @type Object
     */
    get details()
    //===========
    {
        return this.__details;
    }

    /**
     * The map's provenance as returned from the map server.
     *
     * @type Object
     */
    get provenance()
    //==============
    {
        return this.__provenance;
    }

    /**
     * A unique identifier for the map within the viewer.
     *
     * @type string
     */
    get uniqueId()
    //============
    {
        return `${this.__uuid}-${this._mapNumber}`;
    }

    get annotations()
    //===============
    {
        return this.__idToAnnotation;
    }

    /**
     * Get a feature's annotations given its GeoJSON id.
     *
     * @param      {string|number}  geojsonId  The features's GeoJSON identifier
     * @return     {Object}                    The feature's annotations
     */
    annotation(geojsonId)
    //===================
    {
        return this.__idToAnnotation.get(geojsonId.toString());
    }

    /**
     * Get a feature's annotations given its external id.
     *
     * @param      {string}  annotationId  The features's external identifier
     * @return     {Object}                The feature's annotations
     */
    annotationById(annotationId)
    //==========================
    {
        if (this.__annIdToFeatureId.has(annotationId)) {
            const geojsonId = this.__annIdToFeatureId.get(annotationId)
            return this.__idToAnnotation.get(geojsonId)
        }
    }

    /**
     * Flag the feature as having external annotation.
     *
     * @param      {string}  featureId  The feature's external identifier
     */
    setFeatureAnnotated(featureId)
    //============================
    {
        if (this._userInteractions !== null) {
            this._userInteractions.setFeatureAnnotated(featureId);
        }
    }

    __updateFeatureIdMapEntry(propertyId, featureIdMap, featureId)
    //============================================================
    {
        const id = utils.normaliseId(propertyId)
        const featureIds = featureIdMap.get(id);
        if (featureIds) {
            featureIds.push(featureId);
        } else {
            featureIdMap.set(id, [featureId]);
        }
    }

    __updateFeatureIdMap(property, featureIdMap, annotation, missingId=null)
    //======================================================================
    {
        // Exclude centrelines from our set of annotated features
        if (this.options.style !== FLATMAP_STYLE.CENTRELINE && annotation.centreline) {
            return
        }
        if (property in annotation && annotation[property].length) {
            const propertyId = annotation[property];
            if (Array.isArray(propertyId)) {
                for (const id of propertyId) {
                    this.__updateFeatureIdMapEntry(id, featureIdMap, annotation.featureId);
                }
            } else {
                this.__updateFeatureIdMapEntry(propertyId, featureIdMap, annotation.featureId);
            }
        } else if (missingId !== null
               && 'models' in annotation
               && annotation.models.startsWith(APINATOMY_PATH_PREFIX)) {
            this.__updateFeatureIdMapEntry(missingId, featureIdMap, annotation.featureId);
        }
    }

    __saveAnnotation(featureId, ann)
    //==============================
    {
        ann.featureId = featureId;
        this.__idToAnnotation.set(featureId, ann);
        this.__updateFeatureIdMap('dataset', this.__datasetToFeatureIds, ann);
        this.__updateFeatureIdMap('models', this.__modelToFeatureIds, ann);
        this.__updateFeatureIdMap('source', this.__mapSourceToFeatureIds, ann);
        this.__updateFeatureIdMap('taxons', this.__taxonToFeatureIds, ann, UNCLASSIFIED_TAXON_ID);

        // Annotations contain all of a feature's properties so note them
        // for the user to know what can be used for feature filtering

        for (const [key, value] of Object.entries(ann)) {
            if (!EXCLUDED_FEATURE_FILTER_KEYS.includes(key)) {
                if (!this.__featurePropertyValues.has(key)) {
                    this.__featurePropertyValues.set(key, new Set())
                }
                const valueSet = this.__featurePropertyValues.get(key)
                if (Array.isArray(value)) {
                    this.__featurePropertyValues.set(key, valueSet.union(new Set(value.map(v => `${v}`))))
                } else {
                    valueSet.add(`${value}`)
                }
            }
        }
        this.__annIdToFeatureId.set(ann.id, featureId);

        // Pre-compute LineStrings of centrelines in centreline maps
        if (this.options.style === FLATMAP_STYLE.CENTRELINE && ann.centreline) {
            ann['lineString'] = turf.lineString(ann.coordinates)
            ann['lineLength'] = turfLength.length(ann.lineString)
        }
    }

    modelFeatureIds(anatomicalId)
    //===========================
    {
        const normalisedId = utils.normaliseId(anatomicalId)
        return this.__modelToFeatureIds.get(normalisedId) || []
    }

    modelFeatureIdList(anatomicalIds)
    //===============================
    {
        const featureIds = new utils.List();
        if (Array.isArray(anatomicalIds)) {
            for (const id of anatomicalIds) {
                featureIds.extend(this.modelFeatureIds(id));
            }
        } else {
            featureIds.extend(this.modelFeatureIds(anatomicalIds));
        }
        if (featureIds.length == 0) {
            // We couldn't find a feature by anatomical id, so check dataset and source
            featureIds.extend(this.__datasetToFeatureIds.get(anatomicalIds));
            featureIds.extend(this.__mapSourceToFeatureIds.get(anatomicalIds));
        }
        if (featureIds.length == 0 && this._userInteractions !== null) {
            // We still haven't found a feature, so check connectivity
            featureIds.extend(this._userInteractions.pathFeatureIds(anatomicalIds));
        }
        return featureIds;
    }

    modelForFeature(featureId)
    //========================
    {
        const ann = this.__idToAnnotation.get(featureId);
        return (ann && 'models' in ann) ? utils.normaliseId(ann.models) : null;
    }

    /**
     * Get model terms of all paths connected to a node.
     *
     * @param      {number}  pathId  The local (GeoJSON) identifier of a node
     * @return     {set<string>}  Model terms of all paths connected to the node
     */
    nodePathModels(nodeId)
    //====================
    {
        if (this._userInteractions !== null) {
            return this._userInteractions.nodePathModels(nodeId);
        }
    }

    /**
     * Get GeoJSON feature ids of all nodes of a path model.
     *
     * @param      {string}  pathId  The path model identifier
     * @return     {Array<string>}   GeoJSON identifiers of features on the path
     */
    pathModelNodes(modelId)
    //=====================
    {
        if (this._userInteractions !== null) {
            return [...this._userInteractions.pathModelNodes(modelId)]
        }
    }

    /**
     * Get GeoJSON feature ids of all features identified with a taxon.
     *
     * @param      {string}  taxonId  The taxon identifier
     * @return     {Array<string>}    GeoJSON identifiers of features on the path
     */
    taxonFeatureIds(taxonId)
    //======================
    {
        const featureIds = this.__taxonToFeatureIds.get(utils.normaliseId(taxonId))
        return [...new Set(featureIds ? featureIds : [])]
    }

    taxonName(taxonId)
    //================
    {
        if (this.#taxonNames.has(taxonId)) {
            return this.#taxonNames.get(taxonId)
        }
        return taxonId
    }

    async #setTaxonName(taxonId)
    //==========================
    {
        if (taxonId && !this.#taxonNames.has(taxonId)) {
            const result = await this.queryLabels(taxonId)
            if (result.length && 'label' in result[0]) {
                return this.#taxonNames.set(taxonId, result[0]['label'])
            }
        }
    }

    get layers()
    //==========
    {
        return this._layers;
    }

    get map()
    //=======
    {
        return this._map;
    }

    /**
     * The anatomical identifiers of features in the map.
     *
     * @type {string|Array.<string>}
     */
    get anatomicalIdentifiers()
    //=========================
    {
        return [...this.__modelToFeatureIds.keys()]
    }

    /**
     * The taxon identifiers of species which the map's connectivity has been observed in.
     *
     * @type {string|Array.<string>}
     */
    get taxonIdentifiers()
    //====================
    {
        return [...this.__taxonToFeatureIds.keys()]
    }

    /**
     * Datasets associated with the map.
     *
     * @type {string|Array.<string>}
     */
    get datasets()
    //============
    {
        return [...this.__datasetToFeatureIds.keys()]
    }

    get options()
    //===========
    {
        return this._options;
    }

    get pathways()
    //============
    {
        return this._pathways;
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
            mapUUID: this.__uuid,
            minZoom: this._map.getMinZoom(),
            zoom:    this._map.getZoom(),
            maxZoom: this._map.getMaxZoom()
        }
    }

    addCallback(callback)
    //===================
    {
        this.#callbacks.unshift(callback)
    }

    callback(type, data, ...args)
    //===========================
    {
        data.mapUUID = this.__uuid
        for (const callback of this.#callbacks) {
            if (callback(type, data, ...args)) {
                break
            }
        }
    }

    close()
    //=====
    {
        if (this._map) {
            this._map.remove();
            this._map = null;
        }
    }

    resize()
    //======
    {
        // Resize our map

        this._map.resize();
    }

    getIdentifier()
    //=============
    {
        // Return identifiers for reloading the map

        return {
            taxon: this.__taxon,
            biologicalSex: this.__biologicalSex,
            uuid: this.__uuid
        };
    }

    getState()
    //========
    {
        return (this._userInteractions !== null) ? this._userInteractions.getState() : {};
    }

    setState(state)
    //=============
    {
        if (this._userInteractions !== null) {
            this._userInteractions.setState(state);
        }
    }

    showPopup(featureId, content, options)
    //====================================
    {
        if (this._userInteractions !== null) {
            this._userInteractions.showPopup(featureId, content, options);
        }
    }

    /**
     * Remove the currently active popup from the map.
     */
    removePopup()
    //===========
    {
        if (this._userInteractions !== null) {
            this._userInteractions.removePopup();
        }
    }

    setPaint(options=null)
    //====================
    {
        options = utils.setDefaults(options, {
            colour: true,
            outline: true
        });
        if (this._userInteractions !== null) {
            this._userInteractions.setPaint(options);
        }
    }

    setColour(options=null)
    //=====================
    {
        console.log('`setColour()` is deprecated; please use `setPaint()` instead.')
        this.setPaint(options);
    }

    //==========================================================================

    /**
     * Get the map's current background colour.
     *
     * @return     {string}  The background colour.
     */
    getBackgroundColour()
    //===================
    {
        return this._map.getPaintProperty('background', 'background-color');
    }

    /**
     * Get the map's current background opacity.
     *
     * @return     {number}  The background opacity.
     */
    getBackgroundOpacity()
    //====================
    {
        return this._map.getPaintProperty('background', 'background-opacity');
    }

    /**
     * Sets the map's background colour.
     *
     * @param      {string}  colour  The colour
     */
    setBackgroundColour(colour)
    //=========================
    {
        localStorage.setItem('flatmap-background-colour', colour);

        this._map.setPaintProperty('background', 'background-color', colour);

        if (this._userInteractions.minimap) {
            this._userInteractions.minimap.setBackgroundColour(colour);
        }
    }

    /**
     * Sets the map's background opacity.
     *
     * @param      {number}  opacity  The opacity
     */
    setBackgroundOpacity(opacity)
    //===========================
    {
        this._map.setPaintProperty('background', 'background-opacity', opacity);

        if (this._userInteractions.minimap) {
            this._userInteractions.minimap.setBackgroundOpacity(opacity);
        }
    }

    /**
     * Show and hide the minimap.
     *
     * @param {boolean}  show  Set false to hide minimap
     */
    showMinimap(show)
    //===============
    {
        if (this._userInteractions.minimap) {
            this._userInteractions.minimap.show(show);
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
        if (this._userInteractions !== null) {
            return this._userInteractions.getLayers();
        }
    }

    /**
     * @param {string}  layerId  The layer identifier to enable
     * @param {boolean}  enable  Show or hide the layer. Defaults to ``true`` (show)
     *
     */
    enableLayer(layerId, enable=true)
    //===============================
    {
        if (this._userInteractions !== null) {
            return this._userInteractions.enableLayer(layerId, enable);
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
        if (this._userInteractions !== null) {
            this._userInteractions.enableFlightPaths(enable)
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
        if (this._userInteractions !== null) {
            return this._userInteractions.getSystems();
        }
    }

    /**
     * @param {string}  systemId  The identifier of the system to enable
     * @param {boolean}  enable  Show or hide the system. Defaults to ``true`` (show)
     *
     */
    enableSystem(systemId, enable=true)
    //===================================
    {
        if (this._userInteractions !== null) {
            return this._userInteractions.enableSystem(systemId, enable);
        }
    }

    //==========================================================================

    /**
     * Add a marker to the map.
     *
     * @param {string}  anatomicalId  The anatomical identifier of the feature on which
     *                                to place the marker.
     * @arg {Object} options          Configurable options for the marker.
     * @arg {string} options.className Space-separated CSS class names to add to marker element.
     * @arg {string} options.colour   Colour of the marker. Defaults to ``'#005974'``
     *                                (dark cyan).
     * @arg {string} options.element  The DOM element to use as a marker. The default is
     *                                a dark blue droplet-shaped SVG marker.
     * @arg {string} options.location The relative location (0.0 to 1.0) of the marker along a centreline
     *                                in a centreline map.
     * @return     {integer}          The identifier for the resulting marker. -1 is returned if the
     *                                map doesn't contain a feature with the given anatomical identifier
     */
    addMarker(anatomicalId,  options={})
    //==================================
    {
        if (this._userInteractions !== null) {
            return this._userInteractions.addMarker(anatomicalId, options);
        }
        return -1;
    }

    /**
     * Add a list of markers to the map.
     *
     * @param {Array.<string>}  anatomicalId  Anatomical identifiers of features on which
     *                                to place markers.
     * @arg {Object} options          Configurable options for the markers.
     * @arg {string} options.className Space-separated CSS class names to add to marker elemens.
     * @arg {boolean} options.cluster  The markers will be clustered together with other geographically
     *                                close markers. Defaults to ``true``.
     * @arg {string} options.colour   Colour of the markers. Defaults to ``'#005974'``
     *                                (dark cyan).
     * @arg {string} options.element  The DOM element to use as a marker. The default is
     *                                a dark blue droplet-shaped SVG marker.
     * @return     {array.<integer>}  The identifiers of the resulting markers. -1 is returned if the
     *                                map doesn't contain a feature with the given anatomical identifier
     */
    addMarkers(anatomicalIds,  options={})
    //====================================
    {
        options = Object.assign({cluster: true}, options)
        const markerIds = []
        for (const anatomicalId of anatomicalIds) {
            if (this._userInteractions !== null) {
                markerIds.push(this._userInteractions.addMarker(anatomicalId, options))
            } else {
                markerIds.push(-1)
            }
        }
        return markerIds
    }

    /**
     * Remove a marker from the map.
     *
     * @param      {integer}  markerId  The identifier of the marker, as returned
     *                                  by ``addMarker()``
     */
    removeMarker(markerId)
    //====================
    {
        if (markerId > -1 && this._userInteractions !== null) {
            this._userInteractions.removeMarker(markerId);
        }
    }

    /**
     * Remove all markers from the map.
     */
    clearMarkers()
    //============
    {
        if (this._userInteractions !== null) {
            this._userInteractions.clearMarkers();
        }
    }

    /**
     * Add dataset markers to the map.
     *
     * @param {Array.<{id: string, terms: string[]}>} datasets  An array with an object for each dataset,
     *                                                          specifying its identifier and an array of
     *                                                          associated anatomical terms
     */
    addDatasetMarkers(datasets)
    //=========================
    {
        if (this._userInteractions !== null) {
            this._userInteractions.addDatasetMarkers(datasets)
        }
    }

    /**
     * Remove all dataset markers from the map.
     */
    clearDatasetMarkers()
    //===================
    {
        if (this._userInteractions !== null) {
            this._userInteractions.clearDatasetMarkers()
        }
    }

    /**
     * Remove markers for a dataset from the map.
     *
     * @param {integer}  datasetId  The a dataset marker identifier as passed
     *                              to ``addDatasetMarkers()``
     */
    removeDatasetMarker(datasetId)
    //===========================
    {
        if (this._userInteractions !== null) {
            this._userInteractions.removeDatasetMarker(datasetId)
        }
    }

    /**
     * Return the set of anatomical identifiers visible in the current map view.
     *
     * @return {Array.<string>} A list of identifiers
     */
    visibleMarkerAnatomicalIds()
    //==========================
    {
        if (this._userInteractions !== null) {
            return this._userInteractions.visibleMarkerAnatomicalIds();
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
     */
    showMarkerPopup(markerId, content, options={})
    //============================================
    {
        if (this._userInteractions !== null) {
            return this._userInteractions.showMarkerPopup(markerId, content, options);
        }
        return false;
    }

    __exportedProperties(properties)
    //==============================
    {
        const data = {};
        const exportedProperties = [
            'id',
            'featureId',
            'connectivity',
            'dataset',
            'dataset-ids',
            'kind',
            'label',
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
        const encodedProperties = [
            'dataset-ids',
            'hyperlinks',
        ]
        for (const property of exportedProperties) {
            if (property in properties) {
                const value = properties[property];
                if (value !== undefined) {
                    if ((Array.isArray(value) && value.length)
                     || (value.constructor === Object && Object.keys(value).length)) {
                        data[property] = value
                    } else if (property === 'featureId') {
                        data[property] = +value;  // Ensure numeric
                    } else if (encodedProperties.includes(property)) {
                        data[property] = JSON.parse(value)
                    } else {
                        data[property] = value;
                    }
                }
            }
        }
        if (Object.keys(data).length > 0) {
            data['type'] = 'feature';
        }
        return data;
    }

    /**
     * Show or hide a tool for drawing regions to annotate on the map.
     *
     * @param  {boolean}  [visible=true]
     */
    showAnnotator(visible=true)
    //=========================
    {
        if (this._userInteractions !== null) {
            this._userInteractions.showAnnotator(visible)
        }
    }

    /**
     * Generate an ``annotation`` callback event when a drawn annotation has been created
     * a modified.
     *
     * @param eventType {string}   Either ``created``, ``updated`` or ``deleted``
     * @param feature   {Object}   A feature object with ``id``, ``type``, and ``geometry``
     *                             fields of a feature that has been created, updated or
     *                             deleted.
     */
    annotationEvent(eventType, feature)
    //=================================
    {
        this.callback('annotation', {
            type: eventType,
            feature: feature
        });
    }

    /**
     * Mark a drawn/changed annotation as having been accepted by the user.
     *
     * @param event      {Object}     The object as received in an annotation callback
     * @param event.type {string}     Either ``created``, ``updated`` or ``deleted``
     * @param event.feature {Object}  A feature object.
     */
    commitAnnotationEvent(event)
    //==========================
    {
        if (this._userInteractions) {
            this._userInteractions.commitAnnotationEvent(event)
        }
    }

    /**
     * Mark a drawn/changed annotation as having been rejected by the user.
     *
     * @param event      {Object}     The object as received in an annotation callback
     * @param event.type {string}     Either ``created``, ``updated`` or ``deleted``
     * @param event.feature {Object}  A feature object.
     */
    rollbackAnnotationEvent(event)
    //============================
    {
        if (this._userInteractions) {
            this._userInteractions.rollbackAnnotationEvent(event)
        }
    }

    /**
     * Clear all drawn annotations from current annotation layer.
     */
    clearAnnotationFeature()
    //======================
    {
        if (this._userInteractions) {
            this._userInteractions.clearAnnotationFeatures()
        }
    }

    /**
     * Delete the selected drawn feature
     */
    removeAnnotationFeature()
    //=======================
    {
        if (this._userInteractions) {
            this._userInteractions.removeAnnotationFeature()
        }
    }

    /**
     * Add a drawn feature to the annotation drawing tool.
     *
     * @param feature    {Object}        The feature to add
     * @param feature.id {string}        The feature's id
     * @param feature.geometry {Object}  The feature's geometry as GeoJSON
     */
    addAnnotationFeature(feature)
    //===========================
    {
        if (this._userInteractions) {
            this._userInteractions.addAnnotationFeature(feature)
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
    refreshAnnotationFeatureGeometry(feature)
    //=======================================
    {
        if (this._userInteractions) {
            return this._userInteractions.refreshAnnotationFeatureGeometry(feature)
        }
    }

    /**
     * Changes draw to another mode. The mode argument must be one of the following:
     * `simple_select`, `direct_select`, `draw_line_string`,
     * `draw_polygon` or `draw_point`. Options is accepted in first three modes.
     * More details in mapbox-gl-draw github repository.
     *
     * @param type      {Object}     The object
     * @param type.mode {string}     Either ``simple_select``, ``direct_select``, etc
     * @param type.options {Object}  Feature id(s) object.
     */
    changeAnnotationDrawMode(type)
    //============================
    {
        if (this._userInteractions) {
            this._userInteractions.changeAnnotationDrawMode(type)
        }
    }

    /**
     * Generate a callback as a result of some event with a flatmap feature.
     *
     * @param      {string}  eventType     The event type
     * @param      {Object}  properties    Properties associated with the feature
     */
    featureEvent(eventType, properties)
    //=================================
    {
        const data = this.__exportedProperties(properties);

        if (Object.keys(data).length > 0) {
            this.callback(eventType, data);
            return true;
        }
        return false;
    }

    /**
     * Return properties associated with a feature.
     *
     * @param      {number}  featureId  The feature's internal (GeoJSON) id
     * @returns    {Object}             Properties associated with the feature
     */
    featureProperties(featureId)
    //==========================
    {
        const properties = this.annotation(featureId);
        return properties ? this.__exportedProperties(properties) : {};
    }

    /**
     * Generate a callback as a result of some event with a marker.
     *
     * @param      {string}  eventType   The event type
     * @param      {integer}  markerId   The marker identifier
     * @param      {Object}  properties  Properties associated with the marker
     */
    markerEvent(eventType, markerId, properties)
    //==========================================
    {

        const data = Object.assign({}, this.__exportedProperties(properties), {
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
    controlEvent(eventType, control, value)
    //=====================================
    {
        this.callback(eventType, {
            type: 'control',
            control: control,
            value: value
        });
    }

    /**
     * Generate callbacks as a result of panning/zooming the map.
     *
     * @param {boolean}   enabled  Generate callbacks when ``true``,
     *                             otherwise disable them.
     */
    enablePanZoomEvents(enabled=true)
    //===============================
    {
        if (this._userInteractions !== null) {
            this._userInteractions.enablePanZoomEvents(enabled);
        }
    }

    /**
     * Generate a callback as a result of panning/zooming the map.
     *
     * @param {string}         type    The event type, ``pan`` or ``zoom``.
     * @param {Array.<float>}  origin  The map's normalised top-left corner
     * @param {Array.<float>}  size    The map's normalised size
     */
    panZoomEvent(type)
    //================
    {
        const bounds = this._map.getBounds();
        if (this.__normalised_origin !== undefined) {
            const sw = maplibregl.MercatorCoordinate.fromLngLat(bounds.toArray()[0]);
            const ne = maplibregl.MercatorCoordinate.fromLngLat(bounds.toArray()[1]);
            const top_left = [(sw.x - this.__normalised_origin[0])/this.__normalised_size[0],
                              (ne.y - this.__normalised_origin[1])/this.__normalised_size[1]];
            const size = [(ne.x - sw.x)/this.__normalised_size[0],
                          (sw.y - ne.y)/this.__normalised_size[1]];
            this.callback('pan-zoom', {
                type: type,
                origin: top_left,
                size: size
            });
        }
    }

    /**
     * Pan/zoom the map to a new view
     *
     * @param {Array.<float>}  origin  The map's normalised top-left corner
     * @param {Array.<float>}  size    The map's normalised size
     */
    panZoomTo(origin, size)
    //=====================
    {
        if (this.__normalised_origin !== undefined) {
            const sw_x = origin[0]*this.__normalised_size[0] + this.__normalised_origin[0];
            const ne_y = origin[1]*this.__normalised_size[1] + this.__normalised_origin[1];
            const ne_x = sw_x + size[0]*this.__normalised_size[0];
            const sw_y = ne_y + size[1]*this.__normalised_size[1];
            const sw = (new maplibregl.MercatorCoordinate(sw_x, sw_y, 0)).toLngLat();
            const ne = (new maplibregl.MercatorCoordinate(ne_x, ne_y, 0)).toLngLat();
            this._map.fitBounds([sw, ne], {animate: false});
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
     *             or a ``Suggestion`` object containing suggested matches
     *             (see https://lucaong.github.io/minisearch/modules/_minisearch_.html#suggestion).
     */
    search(text, auto=false)
    //======================
    {
        if (auto) {
            return this.__searchIndex.auto_suggest(text);
        } else {
            return this.__searchIndex.search(text);
        }
    }

    clearSearchResults()
    //==================
    {
        if (this._userInteractions !== null) {
            this._userInteractions.clearSearchResults();
        }
    }

    showSearchResults(searchResults)
    //==============================
    {
        if (this._userInteractions !== null) {
            this._userInteractions.showSearchResults(searchResults.featureIds);
        }
    }

    //==========================================================================

    /**
     * Select features on the map.
     *
     * @param {Array.<string>}  externalIds  An array of anaotomical terms identifing features to select
     */
    selectFeatures(externalIds)
    //=========================
    {
        if (this._userInteractions !== null) {
            const featureIds = this.modelFeatureIdList(externalIds);
            this._userInteractions.selectFeatures(featureIds);
        }
    }

    /**
     * Select features and zoom the map to them.
     *
     * @param      {Array.<string>}  featureIds   An array of feature identifiers
     * @param      {Object}  [options]
     * @param      {boolean} [options.zoomIn=false]  Zoom in the map (always zoom out as necessary)
     */
    zoomToFeatures(externalIds, options=null)
    //=======================================
    {
        options = utils.setDefaults(options, {
            select: true,
            highlight: false,
            padding:100
        });
        if (this._userInteractions !== null) {
            const featureIds = this.modelFeatureIdList(externalIds);
            return this._userInteractions.zoomToFeatures(featureIds, options);
        }
    }

    /**
     * Select features on the map.
     *
     * @param {string | Array.<string>}  geojsonIds  A single GeoJSON feature identifiers
     *                                               or an array of identifiers.
     */
    selectGeoJSONFeatures(geojsonIds)
    //===============================
    {
        if (this._userInteractions !== null) {
            this._userInteractions.selectFeatures(geojsonIds)
        }
    }

    /**
     * Unselect all features on the map.
     */
    unselectGeoJSONFeatures()
    //=======================
    {
        if (this._userInteractions !== null) {
            this._userInteractions.unselectFeatures()
        }
    }

    /**
     * Select features and zoom the map to them.
     *
     * @param {string | Array.<string>}  geojsonIds  A single GeoJSON feature identifiers
     *                                               or an array of identifiers.
     * @param {Object}  [options]
     * @param {boolean} [options.zoomIn=false]  Zoom in the map (always zoom out as necessary)
     */
    zoomToGeoJSONFeatures(geojsonIds, options=null)
    //=============================================
    {
        options = utils.setDefaults(options, {
            select: true,
            highlight: false,
            padding:100
        })
        if (this._userInteractions !== null) {
            return this._userInteractions.zoomToFeatures(geojsonIds, options)
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
    addImage(anatomicalId, imageUrl, options={}) // : string[]
    //==========================================
    {
        if (this._userInteractions !== null) {
            return this._userInteractions.addImage(anatomicalId, imageUrl, options)
        }
        return null
    }

    /**
     * Remove images for an anatomical features.
     *
     * @param   {string}   mapImageId       An image identifier previously returned by ``addImage()``.
     */
    removeImage(mapImageId)
    //=====================
    {
        if (this._userInteractions !== null) {
            this._userInteractions.removeImage(mapImageId)
        }
    }

    //==========================================================================
    /**
     * @typedef {Object} CentrelineDetails
     * @property {string} models
     * @property {string} label
     */

    /**
     * Get a details of the nerve centrelines in the map.
     *
     * @return  {CentrelineDetails[]}
     */
    getNerveDetails()
    //===============
    {
        if (this._userInteractions !== null) {
            return this._userInteractions.getNerveDetails()
        }
        return []
    }

    /**
     * Enable/disable the neuron paths associated with a nerve centreline.
     *
     * @param   {string[]|string}   nerveModels   Anatomical identifiers of nerve centrelines
     * @param   {boolean}  [enable=true]
     */
    enableNeuronPathsByNerve(nerveModels, enable=true)
    //================================================
    {
        if (this._userInteractions !== null) {
            this._userInteractions.enableNeuronPathsByNerve(nerveModels, enable)
        }
    }

    //==========================================================================

    get knowledgeSource()
    //===================
    {
        return this.#knowledgeSource
    }

    /**
     * @typedef {Object} EntityLabel
     * @property {string} entity
     * @property {string} label
     */

    /**
     * Get labels for entities from the flatmap's server's knowledge store.
     *
     * @param   {string[]|string}  entities  Anatomical identifiers of entities.
     * @return  {EntityLabel[]}              An ``EntityLabel`` array.
     */
    async queryLabels(entities)
    //=========================
    {
        const entityLabels = []
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
                let last_entity = null
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
     * @param   {string}  entity  The URI of an entity.
     * @return  {Object}          JSON describing the entity.
     */
    async queryKnowledge(entity)
    //==========================
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
        const featureIds = []
        for (const anatomicalId of featureEntities) {
            featureIds.push(...this.modelFeatureIds(anatomicalId))
        }
        const featurePaths = await this.queryPathsForGeoJsonFeatures(featureIds)
        return featurePaths
    }

    /**
     * Get all paths associated with a set of features.
     *
     * @param      {number|number[]}    geojsonIds  GeoJSON ids of features
     * @return     {Promise<string[]>}  A Promise resolving to an array of path identifiers
     */
    async queryPathsForGeoJsonFeatures(geojsonIds)
    //============================================
    {
        if (this.#mapServer.knowledgeSchema < KNOWLEDGE_SOURCE_SCHEMA) {
            return []
        }
        const featureIds = Array.isArray(geojsonIds) ? geojsonIds
                              : geojsonIds ? [geojsonIds]
                              : []
        const uniqueIds = new Set(featureIds.map(id => `${id}`))
        const connectivityNodes = new Set()
        for (const featureId of uniqueIds) {
            const annotation = this.__idToAnnotation.get(featureId)
            if ('anatomical-nodes' in annotation) {
                for (const node of annotation['anatomical-nodes']) {
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

}   // End of FlatMap class

//==============================================================================

/**
 * A manager for FlatMaps.
 * @example
 * const mapManager = new MapManger('https://mapcore-demo.org/flatmaps/');
 */
export class MapManager
{
    /**
     * The released version of the viewer
     */
    static version = VIEWER_VERSION

    #sparcTermGraph = new SparcTermGraph()

    /* Create a MapManager */
    constructor(mapServerUrl, options={})
    {
        this._mapServer = new MapServer(mapServerUrl);
        this._options = options;

        this._mapList = [];
        this._mapNumber = 0;

        this._initialisingMutex = new utils.Mutex();
        this._initialised = false;
    }

    async ensureInitialised_()
    //========================
    {
        return await this._initialisingMutex.dispatch(async () => {
            if (!this._initialised) {
                await this._mapServer.initialise()
                this._mapList = []
                let maps
                try {
                    maps = await this._mapServer.loadJSON('')
                } catch {
                    window.alert(`Cannot connect to flatmap server at ${this._mapServer.url()}`)
                    return
                }
                // Check map schema version (set by mapmaker) and
                // remove maps we can't view (giving a console warning...)
                for (const map of maps) {
                    // Are features in separate vector tile source layers?
                    map.separateLayers = ('version' in map && map.version >= MAP_MAKER_SEPARATE_LAYERS_VERSION);
                    this._mapList.push(map);
                }
                await this.#sparcTermGraph.load(this._mapServer)
                this._initialised = true
            }
        })
    }

    allMaps()
    //=======
    {
        return new Promise(async(resolve, reject) => {
            await this.ensureInitialised_();
            const allMaps = {};
            for (const map of this._mapList) {
                const id = ('uuid' in map) ? map.uuid : map.id;
                allMaps[id] = map;
            }
            resolve(allMaps);
        });
    }

    findMap_(identifier)
    //==================
    {
        return new Promise(async(resolve, reject) => {
            await this.ensureInitialised_();
            resolve(this.lookupMap_(identifier));
        });
    }

    latestMap_(identifier)
    //====================
    {
        const mapDescribes = (identifier.constructor.name === "String") ? identifier
                           : ('uuid' in identifier) ? identifier.uuid
                           : ('taxon' in identifier) ? identifier.taxon
                           : null;
        if (mapDescribes === null) {
            return null;
        }
        let latestMap = null;
        let lastCreatedTime = '';
        for (const map of this._mapList) {
            if (('uuid' in map && mapDescribes === map.uuid
             || mapDescribes === map.id
             || 'taxon' in map && mapDescribes === map.taxon
             || mapDescribes === map.source)
            && (!('biologicalSex' in identifier)
             || ('biologicalSex' in map
               && identifier.biologicalSex === map.biologicalSex))) {
                if ('created' in map) {
                    if (lastCreatedTime < map.created) {
                        lastCreatedTime = map.created;
                        latestMap = map;
                    }
                } else {
                    latestMap = map;
                    break;
                }
            }
        }
        return latestMap;
    }

    lookupMap_(identifier)
    //====================
    {
         if (typeof identifier === 'object') {
            return this.latestMap_(identifier);
        }
        return this.latestMap_({uuid: identifier});
    }

   /**
    * Load and display a FlatMap.
    *
    * @arg identifier {string|Object} A string or object identifying the map to load. If a string its
    *                                 value can be either the map's ``uuid``, assigned at generation time,
    *                                 or taxon and biological sex identifiers of the species that the map
    *                                 represents. The latest version of a map is loaded unless it has been
    *                                 identified using a ``uuid`` (see below).
    * @arg identifier.taxon {string} The taxon identifier of the species represented by the map. This is
    *                                specified as metadata in the map's source file.)
    * @arg identifier.biologicalSex {string} The biological sex of the species represented by the map.
    *                                 This is specified as metadata in the map's source file.)
    * @arg identifier.uuid {string} The unique uuid the flatmap. If given then this exact map will
    *                                be loaded, overriding ``taxon`` and ``biologicalSex``.
    * @arg container {string} The id of the HTML container in which to display the map.
    * @arg callback {function(string, Object)} A callback function, invoked when events occur with the map. The
    *                                          first parameter gives the type of event, the second provides
    *                                          details about the event.
    * @arg options {Object} Configurable options for the map.
    * @arg options.background {string} Background colour of flatmap. Defaults to ``white``.
    * @arg options.debug {boolean} Enable debugging mode.
    * @arg options.flightPaths {boolean} Enable flight path (3D) view of neuron paths
    * @arg options.fullscreenControl {boolean} Add a ``Show full screen`` button to the map.
    * @arg options.layerOptions {Object} Options to control colour and outlines of features
    * @arg options.layerOptions.colour {boolean} Use colour fill (if available) for features. Defaults to ``true``.
    * @arg options.layerOptions.outline {boolean} Show the border of features. Defaults to ``true``.
    * @arg options.layerOptions.sckan {string} Show neuron paths known to SCKAN: values are ``valid`` (default),
    *                                        ``invalid``, ``all`` or ``none``.
    * @arg options.minimap {boolean|Object} Display a MiniMap of the flatmap. Defaults to ``false``.
    * @arg options.minimap.position {string} The minimap's position: ``bottom-left`` (default), ``bottom-right``,
    *                                        ``top-left`` or ``top-right``.
    * @arg options.minimap.width {number|string} The width of the minimap. Defaults to ``320px``. Can also
    *                                            be given as a percentage of the flatmap's width, e.g. ``10%``.
    *                                            The minimap's ``height`` is determined from its width using
    *                                            the flatmap's aspect ratio.
    * @arg options.maxZoom {number} The maximum zoom level of the map.
    * @arg options.minZoom {number} The minimum zoom level of the map.
    * @arg options.navigationControl {boolean} Add navigation controls (zoom buttons) to the map.
    * @arg options.showPosition {boolean} Show ``position`` of tooltip.
    * @arg options.standalone {boolean} Viewer is running ``standalone``, as opposed to integrated into
    *                                   another application so show a number of controls. Defaults to ``false``.
    * @arg options.tooltipDelay {number} The number of milliseconds to delay the tooltip showing.
    * @example
    * const humanMap1 = mapManager.loadMap('humanV1', 'div-1');
    *
    * const humanMap2 = mapManager.loadMap('NCBITaxon:9606', 'div-2');
    *
    * const humanMap3 = mapManager.loadMap({taxon: 'NCBITaxon:9606'}, 'div-3');
    *
    * const humanMap4 = mapManager.loadMap(
    *                     {uuid: 'a563be90-9225-51c1-a84d-00ed2d03b7dc'},
    *                     'div-4');
    */
    loadMap(identifier, container, callback, options={})
    //==================================================
    {
        return new Promise(async(resolve, reject) => {
            try {
                const map = await this.findMap_(identifier);
                if (map === null) {
                    reject(`Unknown map: ${JSON.stringify(identifier)}`);
                };

                // Load the maps index file

                const mapId = ('uuid' in map) ? map.uuid : map.id;
                const mapIndex = await this._mapServer.loadJSON(`flatmap/${mapId}/`);
                const mapIndexId = ('uuid' in mapIndex) ? mapIndex.uuid : mapIndex.id;
                if (mapId !== mapIndexId) {
                    throw new Error(`Map '${mapId}' has wrong ID in index`);
                }
                const mapOptions = Object.assign({}, this._options, options);

                // If bounds are not specified in options then set them

                if (!('bounds' in options) && ('bounds' in mapIndex)) {
                    mapOptions['bounds'] = mapIndex['bounds'];
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
                    mapOptions['image-layers'] = mapIndex['image_layer'];
                }

                // Use the map's zoom range set when it was built

                if ('max-zoom' in mapIndex) {
                    mapOptions.maxZoom = mapIndex['max-zoom'];
                }
                if ('min-zoom' in mapIndex) {
                    mapOptions.minZoom = mapIndex['min-zoom'];
                }

                // Get details about the map's layers

                let mapLayers = [];
                if (!('version' in mapIndex) || mapIndex.version <= 1.0) {
                    for (const layer of mapIndex.layers) {
                        // Set layer data if the layer just has an id specified
                        if (typeof layer === 'string') {
                            mapLayers.push({
                                id: layer,
                                description: layer.charAt(0).toUpperCase() + layer.slice(1),
                                selectable: true
                            });
                        } else {
                            mapLayers.push(layer);
                        }
                    }
                } else {
                    mapLayers = await this._mapServer.loadJSON(`flatmap/${mapId}/layers`);
                }

                // Get the map's style file

                const mapStyle = await this._mapServer.loadJSON(`flatmap/${mapId}/style`);

                // Make sure the style has glyphs defined

                if (!('glyphs' in mapStyle)) {
                    mapStyle.glyphs = 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf';
                }

                // Get the map's pathways

                const pathways = await this._mapServer.loadJSON(`flatmap/${mapId}/pathways`);

                // Get the map's annotations

                const annotations = await this._mapServer.loadJSON(`flatmap/${mapId}/annotations`);

                // Get the map's provenance

                const provenance = await this._mapServer.loadJSON(`flatmap/${mapId}/metadata`);

                // Set zoom range if not specified as an option

                if ('vector-tiles' in mapStyle.sources) {
                    if (!('minZoom' in mapOptions)) {
                        mapOptions['minZoom'] = mapStyle.sources['vector-tiles'].minzoom;
                    }
                    if (!('maxZoom' in mapOptions)) {
                        mapOptions['maxZoom'] = mapStyle.sources['vector-tiles'].maxzoom;
                    }
                }

                // Make sure ``layerOptions`` are set

                if ('layerOptions' in mapOptions) {
                    if (!('colour' in mapOptions.layerOptions)) {
                        mapOptions.layerOptions.colour = true;
                    }
                    if (!('outline' in mapOptions.layerOptions)) {
                        mapOptions.layerOptions.outline = true;
                    }
                } else {
                    mapOptions.layerOptions = {
                        colour: true,
                        outline: true
                    };
                }
                mapOptions.layerOptions.authoring = ('authoring' in mapIndex) ? mapIndex.authoring : false
                mapOptions.layerOptions.flatmapStyle = mapOptions.style

                // Are features in separate vector tile source layers?

                mapOptions.separateLayers = map.separateLayers;

                // Display the map

                this._mapNumber += 1;
                const flatmap = new FlatMap(container, this._mapServer,
                    {
                        id: map,
                        uuid: mapId,
                        details: mapIndex,
                        taxon: map.taxon,
                        biologicalSex: map.biologicalSex,
                        style: mapStyle,
                        options: mapOptions,
                        layers: mapLayers,
                        annotations: annotations,
                        number: this._mapNumber,
                        pathways: pathways,
                        provenance, provenance,
                        callback: callback,
                        sparcTermGraph: this.#sparcTermGraph
                    },
                    resolve);

                return flatmap;

            } catch (err) {
                reject(err);
            }
        });
    }
}

//==============================================================================
