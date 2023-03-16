/******************************************************************************

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

******************************************************************************/

'use strict';

//==============================================================================

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

//==============================================================================

// Load our stylesheet last so we can overide styling rules

import '../static/flatmap-viewer.css';

//==============================================================================

import {MapServer} from './mapserver.js';
import {MinimapControl} from './minimap.js';
import {NavigationControl} from './controls.js';
import {SearchIndex, SearchResults} from './search.js';
import {UserInteractions} from './interactions.js';

import * as images from './images.js';
import * as pathways from './pathways.js';
import * as utils from './utils.js';

//==============================================================================

const MAP_MAKER_SEPARATE_LAYERS_VERSION = 1.4;

//==============================================================================

/**
* Maps are not created directly but instead are created and loaded by
* :meth:`LoadMap` of :class:`MapManager`.
*/
class FlatMap
{
    constructor(container, mapBaseUrl, mapDescription, resolve)
    {
        this._baseUrl = mapBaseUrl;
        this.__id = mapDescription.id;
        this.__uuid = mapDescription.uuid;
        this._details = mapDescription.details;
        this._created = mapDescription.created;
        this.__taxon = mapDescription.taxon;
        this.__biologicalSex = mapDescription.biologicalSex;
        this._mapNumber = mapDescription.number;
        this._callback = mapDescription.callback;
        this._layers = mapDescription.layers;
        this._markers = mapDescription.markers;
        this._options = mapDescription.options;
        this._pathways = mapDescription.pathways;
        this._resolve = resolve;
        this._map = null;
        this.__searchIndex = new SearchIndex(this);
        this.__idToAnnotation = new Map();
        this.__datasetToFeatureIds = new Map();
        this.__modelToFeatureIds = new Map();
        this.__mapSourceToFeatureIds = new Map();
        for (const [featureId, annotation] of Object.entries(mapDescription.annotations)) {
            this.__addAnnotation(featureId, annotation);
            this.__searchIndex.indexMetadata(featureId, annotation);
        }

        // Set base of source URLs in map's style

        for (const [id, source] of Object.entries(mapDescription.style.sources)) {
            if (source.url) {
                source.url = this.addBaseUrl_(source.url);
            }
            if (source.tiles) {
                const tiles = [];
                for (const tileUrl of source.tiles) {
                    tiles.push(this.addBaseUrl_(tileUrl));
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
            mapOptions.maxZoom = mapDescription.options.maxZoom;
        }
        if ('minZoom' in mapDescription.options) {
            mapOptions.minZoom = mapDescription.options.minZoom;
        }

        // Only show location in address bar when debugging

        mapOptions.hash = (mapDescription.options.debug === true);

        // Create the map

        this._map = new maplibregl.Map(mapOptions);

        // Show tile boundaries if debugging

        if (mapDescription.options.debug === true) {
            this._map.showTileBoundaries = true;
        }

        // Don't wrap around at +/-180 degrees

        this._map.setRenderWorldCopies(false);

        // Do we want a fullscreen control?

        if (mapDescription.options.fullscreenControl === true) {
            this._map.addControl(new maplibregl.FullscreenControl(), 'top-right');
        }

        // Disable map rotation

        this._map.dragRotate.disable();
        this._map.touchZoomRotate.disableRotation();

        // Add navigation controls if option set

        if (mapDescription.options.navigationControl) {
            const value = mapDescription.options.navigationControl;
            const position = ((typeof value === 'string')
                           && (['top-left', 'top-right', 'bottom-right', 'bottom-left'].indexOf(value) >= 0))
                           ? value : 'bottom-right';
            this._map.addControl(new NavigationControl(this), position);
        }

        // Finish initialisation when all sources have loaded
        // and map has rendered

        this._userInteractions = null;
        this._initialState = null;
        this._minimap = null;

        this._map.on('idle', () => {
            if (this._userInteractions === null) {
                this.setupUserInteractions_();
            } else if (this._initialState === null) {
                this._bounds = this._map.getBounds();
                this._map.setMaxBounds(this._bounds);
                const sw = maplibregl.MercatorCoordinate.fromLngLat(this._bounds.toArray()[0]);
                const ne = maplibregl.MercatorCoordinate.fromLngLat(this._bounds.toArray()[1]);
                this.__normalised_origin = [sw.x, ne.y];
                this.__normalised_size = [ne.x - sw.x, sw.y - ne.y];
                if ('state' in this._options) {
                    this._userInteractions.setState(this._options.state);
                }
                this._initialState = this.getState();

                // Add a minimap if option set

                if (this.options.minimap) {
                    this._minimap = new MinimapControl(this, this.options.minimap);
                        this._map.addControl(this._minimap);
                    }

                this._resolve(this);
            }
        });
    }

    async setupUserInteractions_()
    //============================
    {
        // Load any images required by the map

        for (const image of this._options.images) {
            await this.addImage(image.id, image.url, '', image.options);
        }

        // Layers have now loaded so finish setting up

        this._userInteractions = new UserInteractions(this);
    }

    /**
     * The flatmap's bounds.
     */
    get bounds()
    //==========
    {
        return this._bounds;
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
     * Toggle the visibility of paths on the map.zoomIn
     *
     * * If some paths are hidden then all paths are made visible.
     * * If all paths are visible then they are all hidden.
     */
    togglePaths()
    //===========
    {
        if (this._userInteractions !== null) {
            this._userInteractions.togglePaths();
        }
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
            return this._userInteractions.pathways.pathTypes();
        }
    }

    /**
     * Hide or show paths of a given type.
     *
     * @param {string}   pathType The path type
     * @param {boolean}  enable  Show or hide paths of that type. Defaults to
     *                           ``true`` (show)
     */
    enablePath(pathType, enable=true)
    //===============================
    {
        if (this._userInteractions !== null) {
            this._userInteractions.enablePath(pathType, enable);
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
            this._userInteractions.enableSckanPath(sckanState, enable);
        }
    }

    /**
     * Hide or show centrelines and nodes.
     *
     * @param {boolean}  enable  Show or centrelines and associated nodes.
     *                           Defaults to ``true`` (show)
     */
    enableCentrelines(enable=true)
    //============================
    {
        if (this._userInteractions !== null) {
            this._userInteractions.enableCentrelines(enable);
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
                                                               : this.loadImage_(path.startsWith('/') ? this.addBaseUrl_(path)
                                                                                                      : new URL(path, baseUrl)));
            this._map.addImage(id, image, options);
        }
    }

    addBaseUrl_(url)
    //==============
    {
        if (url.startsWith('/')) {
            return `${this._baseUrl}flatmap/${this.__uuid}${url}`; // We don't want embedded `{` and `}` characters escaped
        } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
            console.log(`Invalid URL (${url}) in map's sources`);
        }
        return url;
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
        return this._created;
    }

    /**
     * The map's id as specified at generation time.
     *
     * @type string
     */
    get id()
    //======
    {
        return this.__uuid;
    }

    /**
     * The map's ``index.json`` as returned from the map server.
     *
     * @type Object
     */
    get details()
    //===========
    {
        return this._details;
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

    annotation(featureId)
    //===================
    {
        return this.__idToAnnotation.get(featureId.toString());
    }

    __updateFeatureIdMap(property, featureIdMap, annotation)
    //======================================================
    {
        if (property in annotation) {
            const id = utils.normaliseId(annotation[property]);
            const featureIds = featureIdMap.get(id);
            if (featureIds) {
                featureIds.push(annotation.featureId);
            } else {
                featureIdMap.set(id, [annotation.featureId]);
            }
        }
    }

    __addAnnotation(featureId, ann)
    //=============================
    {
        ann.featureId = featureId;
        this.__idToAnnotation.set(featureId, ann);
        this.__updateFeatureIdMap('dataset', this.__datasetToFeatureIds, ann);
        this.__updateFeatureIdMap('models', this.__modelToFeatureIds, ann);
        this.__updateFeatureIdMap('source', this.__mapSourceToFeatureIds, ann);
    }

    modelFeatureIds(anatomicalId)
    //===========================
    {
        const featureIds = this.__modelToFeatureIds.get(utils.normaliseId(anatomicalId));
        return featureIds ? featureIds : [];
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
            featureIds.extend(this._userInteractions.pathwaysFeatureIds(anatomicalIds));
        }
        return featureIds;
    }

    modelForFeature(featureId)
    //========================
    {
        const ann = this.__idToAnnotation.get(featureId);
        return (ann && 'models' in ann) ? utils.normaliseId(ann.models) : null;
    }

    nodePathModels(nodeId)
    //====================
    {
        if (this._userInteractions !== null) {
            return this._userInteractions.nodePathModels(nodeId);
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

    get markers()
    //===========
    {
        return this._markers;
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
            'minZoom': this._map.getMinZoom(),
            'zoom':    this._map.getZoom(),
            'maxZoom': this._map.getMaxZoom()
        }
    }

    callback(type, data, ...args)
    //===========================
    {
        if (this._callback) {
            return this._callback(type, data, ...args);
        }
    }

    setInitialPosition()
    //==================
    {
        if ('bounds' in this._options) {
            this._map.fitBounds(this._options['bounds'], {animate: false});
        }
        if ('center' in this._options) {
            this._map.setCenter(this._options['center']);
        }
        if ('zoom' in this._options) {
            this._map.setZoom(this._options['zoom']);
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

    setColour(options=null)
    //=====================
    {
        options = utils.setDefaults(options, {
            colour: true,
            outline: true
        });
        if (this._userInteractions !== null) {
            this._userInteractions.setColour(options);
        }
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

        if (this._minimap) {
            this._minimap.setBackgroundColour(colour);
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

        if (this._minimap) {
            this._minimap.setBackgroundOpacity(opacity);
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
        if (this._minimap) {
            this._minimap.show(show);
        }

    }

    //==========================================================================

    /**
     * Get a list of the flatmap's layers.
     *
     * @return {Array.Object.<{id: string, description: string, enabled: boolean}>}  An array with layer details
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

    //==========================================================================

    /**
     * Add a marker to the map.
     *
     * @param      {string}  anatomicalId     The anatomical identifier of the feature on which
     *                                        to place the marker
     * @param      {string}  [htmlElement=null]  An optional parameter giving the DOM element to
     *                                           use as a marker. The default is a light blue,
     *                                           droplet-shaped SVG marker.
     * @return     {integer}  The identifier for the resulting marker. -1 is returned if the
     *                        map doesn't contain a feature with the given anatomical identifier
     */
    addMarker(anatomicalId,  htmlElement=null)
    //========================================
    {
        if (this._userInteractions !== null) {
            return this._userInteractions.addMarker(anatomicalId, htmlElement);
        }
        return -1;
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
        if (this._userInteractions !== null) {
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
     * passed to the map's ``callback`` function as a popup won't be shown.
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

    /**
     * Generate a callback as a result of some event with a flatmap feature.
     *
     * @param      {string}  eventType     The event type
     * @param      {Object}  properties    Properties associated with the feature
     */
    featureEvent(eventType, properties)
    //=================================
    {
        const data = {};
        const exportedProperties = [
            'connectivity',
            'dataset',
            'kind',
            'label',
            'models',
            'nodeId',
            'source',
            'hyperlinks'
        ];
        const jsonProperties = [
            'hyperlinks'
        ];
        for (const property of exportedProperties) {
            if (property in properties) {
                const value = properties[property];
                if (value !== undefined) {
                    if (jsonProperties.indexOf(property) >= 0) {
                        data[property] = JSON.parse(properties[property])
                    } else {
                        data[property] = properties[property];
                    }
                }
            }
        }
        if (Object.keys(data).length > 0) {
            data['type'] = 'feature';
            this.callback(eventType, data);
            return true;
        }
        return false;
    }

    /**
     * Generate a callback as a result of some event with a marker.
     *
     * @param      {string}  eventType     The event type
     * @param      {integer}  markerId      The marker identifier
     * @param      {string}  anatomicalId  The anatomical identifier for the marker
     */
    markerEvent(eventType, markerId, anatomicalId)
    //============================================
    {
        this.callback(eventType, {
            type: 'marker',
            id: markerId,
            models: anatomicalId
        });
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
     * Highlight features on the map.
     *
     * @param {Array.<string>}  externalIds  An array of anaotomical terms identifing features to highlight
     */
    highlightFeatures(externalIds)
    //============================
    {
        if (this._userInteractions !== null) {
            const featureIds = this.modelFeatureIdList(externalIds);
            this._userInteractions.highlightFeatures(featureIds);
        }
    }

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
     * Zoom map to features.
     *
     * @param      {Array.<string>}  externalIds   An array of anaotomical terms identifing features
     * @param      {Object}  [options]
     * @param      {boolean} [options.select=true]  Select the features zoomed to
     * @param      {boolean} [options.highlight=false]  Highlight the features zoomed to
     * @param      {number}  [options.padding=100]  Padding around the composite bounding box
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
            this._userInteractions.zoomToFeatures(featureIds, options);
        }
    }
}

//==============================================================================

/**
 * A manager for FlatMaps.
 * @example
 * const mapManager = new MapManger('https://mapcore-demo.org/flatmaps/');
 */
export class MapManager
{
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
                this._mapList = [];
                const maps = await this._mapServer.loadJSON('');
                // Check map schema version (set by mapmaker) and
                // remove maps we can't view (giving a console warning...)
                for (const map of maps) {
                    // Are features in separate vector tile source layers?
                    map.separateLayers = ('version' in map && map.version >= MAP_MAKER_SEPARATE_LAYERS_VERSION);
                    this._mapList.push(map);
                }
                this._initialised = true;
            }
        });
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
                    mapOptions.style = mapIndex.style;  // Currently ``anatomical`` or ``functional``
                } else {
                    mapOptions.style = 'flatmap';       // Default is a generic ``flatmap``
                }

                // Mapmaker has changed the name of the field to indicate that indicates if
                // there are raster layers
                if (!('image-layers' in mapIndex) && ('image_layer' in mapIndex)) {
                    mapIndex['image-layers'] = mapIndex['image_layer'];
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

                // Get additional marker details for the map

                const mapMarkers = await this._mapServer.loadJSON(`flatmap/${mapId}/markers`);

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
                mapOptions.layerOptions.authoring = ('authoring' in mapIndex) ? mapIndex.authoring : false;

                // Are features in separate vector tile source layers?

                mapOptions.separateLayers = map.separateLayers;

                // Display the map

                this._mapNumber += 1;
                const flatmap = new FlatMap(container, this._mapServer.url(),
                    {
                        id: map,
                        uuid: mapId,
                        details: mapIndex,
                        taxon: map.taxon,
                        biologicalSex: map.biologicalSex,
                        style: mapStyle,
                        options: mapOptions,
                        layers: mapLayers,
                        markers: mapMarkers,
                        annotations: annotations,
                        number: this._mapNumber,
                        pathways: pathways,
                        callback: callback
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
