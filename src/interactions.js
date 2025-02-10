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

import maplibregl from 'maplibre-gl';

import {default as turfArea} from '@turf/area'
import {default as turfAlong} from '@turf/along'
import {default as turfBBox} from '@turf/bbox'
import * as turf from '@turf/helpers'
import * as turfNearestPointOnLine from "@turf/nearest-point-on-line"
import * as turfProjection from '@turf/projection'

import polylabel from 'polylabel';

//==============================================================================

import {PropertiesFilter} from './filters'
import {inAnatomicalClusterLayer, LayerManager} from './layers';
import {PATHWAYS_LAYER, PathManager} from './pathways';
import {NerveCentreFacet} from './filters/facets/nerve'
import {PathTypeFacet} from './filters/facets/pathtype'
import {TaxonFacet} from './filters/facets/taxon'
import {VECTOR_TILES_SOURCE} from './layers/styling';
import {SystemsManager} from './systems';
import {FLATMAP_STYLE} from './flatmap-viewer'

import {displayedProperties, InfoControl} from './controls/info';
import {AnnotatorControl, BackgroundControl, LayerControl, SCKANControl} from './controls/controls';
import {AnnotationDrawControl, DRAW_ANNOTATION_LAYERS} from './controls/annotation'
import {NerveCentrelineControl} from './controls/nerves'
import {PathControl} from './controls/paths';
import {FlightPathControl} from './controls/flightpaths'
import {SearchControl} from './controls/search';
import {MinimapControl} from './controls/minimap';
import {SystemsControl} from './controls/systems';
import {TaxonsControl} from './controls/taxons';
import {latex2Svg} from './mathjax';

import * as utils from './utils';

//==============================================================================


// smallest `group` features when zoom < SHOW_DETAILS_ZOOM if there are some, otherwise smallest feature
// if no non-group features then smallest group one

const SHOW_DETAILS_ZOOM = 6;

//==============================================================================

function bounds(feature)
//======================
{
    // Find the feature's bounding box

    let bounds = ('bounds' in feature.properties) ? feature.properties.bounds
                                                  : feature.properties.bbox;
    if (bounds) {
        // Bounding box is defined in GeoJSON

        return JSON.parse(bounds);
    } else {
        // Get the bounding box of the current polygon. This won't neccessary
        // be the full feature because of tiling

        const polygon = turf.geometry(feature.geometry.type, feature.geometry.coordinates);
        return turfBBox(polygon);
    }
}

//==============================================================================

function expandBounds(bbox1, bbox2, padding)
//==========================================
{
    return (bbox1 === null) ? [...bbox2]
                            : [Math.min(bbox1[0], bbox2[0]), Math.min(bbox1[1], bbox2[1]),
                               Math.max(bbox1[2], bbox2[2]), Math.max(bbox1[3], bbox2[3])
                              ];
}

//==============================================================================

function labelPosition(feature)
{
    if (feature.geometry.type === 'Point') {
        return feature.geometry.coordinates
    }
    const polygon = feature.geometry.coordinates;
    // Rough heuristic. Area is in km^2; below appears to be good enough.
    const precision = ('area' in feature.properties)
                        ? Math.sqrt(feature.properties.area)/500000
                        : 0.1;
    return polylabel(polygon, precision);
}

//==============================================================================

function getRenderedLabel(properties)
{
    if (!('renderedLabel' in properties)) {
        const label = ('label' in properties) ? properties.label
                    : ('user_label' in properties) ? properties.user_label
                    : ''
        const uppercaseLabel = (label !== '') ? (label.substr(0, 1).toUpperCase()
                                               + label.substr(1)).replaceAll("\n", "<br/>")
                                              : ''
        properties.renderedLabel = uppercaseLabel.replaceAll(/\$([^\$]*)\$/g, math => latex2Svg(math.slice(1, -1)))
    }
    return properties.renderedLabel;
}

//==============================================================================

export class UserInteractions
{
    #activeFeatures = new Map()
    #annotationDrawControl = null
    #imageLayerIds = new Map()
    #lastImageId = 0
    #lastMarkerId = 900000
    #minimap = null
    #nerveCentrelineFacet
    #pathTypeFacet
    #selectedFeatureRefCount = new Map()
    #taxonFacet

    constructor(flatmap)
    {
        this._flatmap = flatmap;
        this._map = flatmap.map;

        this._currentPopup = null;
        this._infoControl = null;
        this._tooltip = null;

        this._inQuery = false;
        this._modal = false;

        // Default colour settings
        this.__colourOptions = {colour: true, outline: true};

        // Marker placement and interaction

        this.__activeMarker = null;
        this.__markerIdByMarker = new Map();
        this.__markerIdByFeatureId = new Map();
        this.__annotationByMarkerId = new Map();

        // Where to put labels and popups on a feature
        this.__markerPositions = new Map();

        // Track enabled features

        this.__featureEnabledCount = new Map(Array.from(this._flatmap.annotations.keys()).map(k => [+k, 0]));

        const featuresEnabled = flatmap.options.style !== FLATMAP_STYLE.FUNCTIONAL;

        this.tooltipDelay = flatmap.options.tooltipDelay || 0;

        // Path visibility is either controlled externally or by a local control
        // FC path visiblitity is determined by system visiblity

        this.__pathManager = new PathManager(flatmap, this, featuresEnabled);

        // The path types in this map

        const mapPathTypes = this.__pathManager.pathTypes();

        // Add and manage our layers. NB. This needs to be done after we
        // have a path manager but before paths are enabled

        this._layerManager = new LayerManager(flatmap, this);

        // Set initial enabled state of paths
        this.__pathManager.enablePathLines(true, true)

        this.#pathTypeFacet = new PathTypeFacet(mapPathTypes)
        this._layerManager.addFilteredFacet(this.#pathTypeFacet)

        this.#nerveCentrelineFacet = new NerveCentreFacet(this.__pathManager.nerveCentrelineDetails)
        this._layerManager.addFilteredFacet(this.#nerveCentrelineFacet)

        // Note features that are FC systems
        this.__systemsManager = new SystemsManager(this._flatmap, this, featuresEnabled);

        // All taxons of connectivity paths are enabled by default
        this.#taxonFacet = new TaxonFacet(this._flatmap.taxonIdentifiers)
        this._layerManager.addFilteredFacet(this.#taxonFacet)

        // Add a minimap if option set
        if (flatmap.options.minimap) {
            this.#minimap = new MinimapControl(flatmap, flatmap.options.minimap,
                this._layerManager.minimapStyleSpecification)
            this._map.addControl(this.#minimap)
        }

        // Do we want a fullscreen control?
        if (flatmap.options.fullscreenControl === true) {
            this._map.addControl(new maplibregl.FullscreenControl(), 'top-right');
        }

        // Add navigation controls if option set
        if (flatmap.options.navigationControl) {
            const value = flatmap.options.navigationControl;
            const position = ((typeof value === 'string')
                           && ['top-left', 'top-right', 'bottom-right', 'bottom-left'].includes(value))
                           ? value : 'bottom-right';
            this._map.addControl(new NavigationControl(flatmap), position);
        }

        // Add various controls when running standalone
        if (flatmap.options.standalone) {
            // Add a control to search annotations if option set
            this._map.addControl(new SearchControl(flatmap));

            // Show information about features
            this._infoControl = new InfoControl(flatmap);
            this._map.addControl(this._infoControl);

            // Control background colour (NB. this depends on having map layers created)
            this._map.addControl(new BackgroundControl(flatmap));

            // Add a control to manage our paths
            this._map.addControl(new PathControl(flatmap, mapPathTypes));

            // Add a control for nerve centrelines if they are present
            if (flatmap.options.style === FLATMAP_STYLE.ANATOMICAL && this.__pathManager.haveCentrelines) {
                this._map.addControl(new NerveCentrelineControl(flatmap, this))
            }

            if (flatmap.options.style === FLATMAP_STYLE.FUNCTIONAL) {
                // SCKAN path and SYSTEMS controls for FC maps
                this._map.addControl(new SystemsControl(flatmap, this.__systemsManager.systems));
                this._map.addControl(new SCKANControl(flatmap, flatmap.options.layerOptions));
            } else {
                // Connectivity taxon control for AC maps
                this._map.addControl(new TaxonsControl(flatmap));
            }

            if (flatmap.has_flightpaths) {
                this._map.addControl(new FlightPathControl(flatmap, flatmap.options.flightPaths));
            }

            if (flatmap.options.annotator) {
                this._map.addControl(new AnnotatorControl(flatmap));
            }

            // Add a control to control layer visibility
            this._map.addControl(new LayerControl(flatmap, this._layerManager));
        }

        // Initialise map annotation
        this.__setupAnnotation()

        // Add an initially hidden tool for drawing on the map.
        this.#annotationDrawControl = new AnnotationDrawControl(flatmap, false)
        this._map.addControl(this.#annotationDrawControl)

        // Set initial path viewing mode
        if (flatmap.options.flightPaths === true) {
            this._layerManager.setFlightPathMode(true)
        }

        // Handle mouse events

        const handleMouseMoveEvent = this.mouseMoveEvent_.bind(this);
        this._map.on('click', this.clickEvent_.bind(this));
        this._map.on('dblclick', event => {
            const clickedFeatures = this._layerManager.featuresAtPoint(event.point)
            for (const feature of clickedFeatures) {
                if (feature.properties.kind === 'expandable'
                 && this._map.getZoom() > (feature.properties.maxzoom - 2)) {
                    event.preventDefault()
                    this._map.fitBounds(bounds(feature), {
                        padding: 0,
                        animate: false
                    })
                    break
                }
            }
        })
        this._map.on('touchend', this.clickEvent_.bind(this));
        this._map.on('mousemove', utils.delay(handleMouseMoveEvent, this.tooltipDelay));
        this._lastFeatureMouseEntered = null;
        this._lastFeatureModelsMouse = null;
        this.__lastClickLngLat = null;

        // Handle pan/zoom events
        this._map.on('move', this.panZoomEvent_.bind(this, 'pan'));
        this._map.on('zoom', this.panZoomEvent_.bind(this, 'zoom'));
        this.__pan_zoom_enabled = false;
    }

    get minimap()
    //===========
    {
        return this.#minimap
    }

    get pathManager()
    //===============
    {
        return this.__pathManager;
    }

    getState()
    //========
    {
        // Return the map's centre, zoom, and active layers
        // Can only be called when the map is fully loaded
        return {
            center: this._map.getCenter().toArray(),
            zoom: this._map.getZoom(),
            bearing: this._map.getBearing(),
            pitch: this._map.getPitch()
        };
    }

    setState(state)
    //=============
    {
        // Restore the map to a saved state

        const options = Object.assign({}, state)
        if ('zoom' in options) {
            if ('center' in options) {
                options['around'] = options.center;
            } else {
                options['around'] = [0, 0];
            }
        }
        if (Object.keys(options).length > 0) {
            this._map.jumpTo(options);
        }
    }

    showAnnotator(visible=true)
    //=========================
    {
        if (this.#annotationDrawControl) {
            this.#annotationDrawControl.show(visible)
        }
    }

    commitAnnotationEvent(event)
    //==========================
    {
        if (this.#annotationDrawControl) {
            this.#annotationDrawControl.commitEvent(event)
        }
    }

    abortAnnotationEvent(event)
    //=========================
    {
        if (this.#annotationDrawControl) {
            this.#annotationDrawControl.abortEvent(event)
        }
    }

    rollbackAnnotationEvent(event)
    //============================
    {
        if (this.#annotationDrawControl) {
            this.#annotationDrawControl.rollbackEvent(event)
        }
    }

    clearAnnotationFeatures()
    //=======================
    {
        if (this.#annotationDrawControl) {
            this.#annotationDrawControl.clearFeatures()
        }
    }

    removeAnnotationFeature()
    //=======================
    {
        if (this.#annotationDrawControl) {
            this.#annotationDrawControl.removeFeature()
        }
    }

    addAnnotationFeature(feature)
    //===========================
    {
        if (this.#annotationDrawControl) {
            this.#annotationDrawControl.addFeature(feature)
        }
    }

    refreshAnnotationFeatureGeometry(feature)
    //=======================================
    {
        if (this.#annotationDrawControl) {
            return this.#annotationDrawControl.refreshGeometry(feature)
        }
    }

    changeAnnotationDrawMode(type)
    //=============================
    {
        if (this.#annotationDrawControl) {
            this.#annotationDrawControl.changeMode(type)
        }
    }

    __setupAnnotation()
    //=================
    {
        // Relate external annotation identifiers to map (GeoJSON) ids
        this.__featureIdToMapId = new Map([...this._flatmap.annotations.entries()]
                                                  .map(idAnn => [idAnn[1].id, idAnn[0]]))
        // Flag features that have annotations
        for (const mapId of this.__featureIdToMapId.values()) {
            const feature = this.mapFeature(mapId)
            if (feature !== undefined) {
                this._map.setFeatureState(feature, { 'map-annotation': true })
            }
        }
    }

    setFeatureAnnotated(featureId)
    //============================
    {
        // External feature id to map's GeoJSON id
        const mapId = this.__featureIdToMapId.get(featureId)
        if (mapId) {
            const feature = this.mapFeature(mapId)
            if (feature !== undefined) {
                this._map.setFeatureState(feature, { 'annotated': true })
            }
        }
    }

    #setPaint(options)
    //================
    {
        this._layerManager.setPaint(options)
    }

    setPaint(options)
    //===============
    {
        this.__colourOptions = options;
        this.#setPaint(options);
    }

    getLayers()
    //=========
    {
        return this._layerManager.layers;
    }

    enableLayer(layerId, enable=true)
    //===============================
    {
        this._layerManager.activate(layerId, enable);
    }

    enableFlightPaths(enable=true)
    //============================
    {
        this._layerManager.setFlightPathMode(enable)
    }

    getSystems()
    //==========
    {
        return this.__systemsManager.systems;
    }

    enableSystem(systemId, enable=true)
    //=================================
    {
        this.__systemsManager.enable(systemId, enable);
    }

    mapFeatureFromAnnotation(annotation)
    //==================================
    {
        if (annotation) {
            return {
                id: +annotation.featureId,
                source: VECTOR_TILES_SOURCE,
                sourceLayer: (this._flatmap.options.separateLayers
                             ? `${annotation['layer']}_${annotation['tile-layer']}`
                             : annotation['tile-layer']).replaceAll('/', '_'),
                children: annotation.children || []
            }
        }
        return undefined
    }

    mapFeature(geojsonId)
    //===================
    {
        return this.mapFeatureFromAnnotation(this._flatmap.annotation(geojsonId))
    }

    #markerToFeature(feature)
    //=======================
    {
        if (inAnatomicalClusterLayer(feature)) {
            return this.mapFeature(feature.properties.featureId)
        }
        return feature
    }

    #getFeatureState(feature)
    //=======================
    {
        feature = this.#markerToFeature(feature)
        return this._map.getFeatureState(feature)
    }


    getFeatureState(featureId)
    //========================
    {
        const feature = this.mapFeature(featureId)
        if (feature) {
            const state = this._map.getFeatureState(feature)
            if (Object.keys(state).length) {
                return state
            }
        }
        return undefined
    }

    #removeFeatureState(feature, key)
    //===============================
    {
        feature = this.#markerToFeature(feature)
        this._map.removeFeatureState(feature, key)
        this._layerManager.removeFeatureState(feature, key)
    }

    #setFeatureState(feature, state)
    //==============================
    {
        feature = this.#markerToFeature(feature)
        this._map.setFeatureState(feature, state)
        this._layerManager.setFeatureState(feature, state)
    }

    enableMapFeature(feature, enable=true)
    //====================================
    {
        if (feature !== undefined) {
            const state = this.#getFeatureState(feature);
            if  ('hidden' in state) {
                if (enable) {
                    this.#removeFeatureState(feature, 'hidden');
                } else if (!state.hidden) {
                    this.#setFeatureState(feature, { hidden: true });
                }
            } else if (!enable) {
                this.#setFeatureState(feature, { hidden: true });
            }
            this.__enableFeatureMarker(feature.id, enable);
        }
    }

    enableFeature(featureId, enable=true, force=false)
    //================================================
    {
        const enabledCount = this.__featureEnabledCount.get(+featureId)
        if (force || enable && enabledCount === 0 || !enable && enabledCount == 1) {
            this.enableMapFeature(this.mapFeature(featureId), enable)
        }
        if (force) {
            this.__featureEnabledCount.set(+featureId, enable ? 1 : 0);
        } else {
            this.__featureEnabledCount.set(+featureId, enabledCount + (enable ? 1 : -1));
        }
    }

    enableFeatureWithChildren(featureId, enable=true, force=false)
    //============================================================
    {
        const feature = this.mapFeature(featureId);
        if (feature !== undefined) {
            this.enableFeature(featureId, enable, force);
            for (const childFeatureId of feature.children) {
                this.enableFeatureWithChildren(childFeatureId, enable, force);
            }
        }
    }

    __enableFeatureMarker(featureId, enable=true)
    //===========================================
    {
        const markerId = this.__markerIdByFeatureId.get(+featureId);
        if (markerId !== undefined) {
            const markerDiv = document.getElementById(`marker-${markerId}`);
            if (markerDiv) {
                markerDiv.style.visibility = enable ? 'visible' : 'hidden';
            }
        }
    }

    __featureEnabled(feature)
    //=======================
    {
        if (feature.id) {
            const state = this.#getFeatureState(feature);
            return (state !== undefined
                && !(state.hidden || false)
                && !(state.invisible || false))
        }
        return DRAW_ANNOTATION_LAYERS.includes(feature.layer.id)
    }

    featureSelected_(featureId)
    //=========================
    {
        return this.#selectedFeatureRefCount.has(+featureId)
    }

    selectFeature(featureId, dim=true)
    //================================
    {
        const ann = this._flatmap.annotation(featureId);
        if (ann && 'sckan' in ann) {
            const sckanState = this._layerManager.sckanState;
            if (sckanState === 'none'
             || sckanState === 'valid' && !ann.sckan
             || sckanState === 'invalid' && ann.sckan) {
                return false;
            }
        }
        featureId = +featureId;   // Ensure numeric
        let result = false;
        const noSelection = (this.#selectedFeatureRefCount.size === 0)
        if (this.#selectedFeatureRefCount.has(featureId)) {
            this.#selectedFeatureRefCount.set(featureId, this.#selectedFeatureRefCount.get(featureId) + 1)
            result = true;
        } else {
            const feature = this.mapFeature(featureId);
            if (feature !== undefined) {
                const state = this.#getFeatureState(feature);
                if (state !== undefined && (!('hidden' in state) || !state.hidden)) {
                    this.#setFeatureState(feature, { selected: true });
                    this.#selectedFeatureRefCount.set(featureId, 1)
                    result = true;
                }
            }
        }
        if (result && noSelection) {
            this.#setPaint({...this.__colourOptions, dimmed: dim});
        }
        return result;
    }

    unselectFeature(featureId)
    //========================
    {
        featureId = +featureId;   // Ensure numeric
        if (this.#selectedFeatureRefCount.has(featureId)) {
            const refCount = this.#selectedFeatureRefCount.get(featureId)
            if (refCount > 1) {
                this.#selectedFeatureRefCount.set(featureId, refCount - 1)
            } else {
                const feature = this.mapFeature(featureId);
                if (feature !== undefined) {
                    this.#removeFeatureState(feature, 'selected');
                    this.#selectedFeatureRefCount.delete(+featureId)
                }
            }
        }
        if (this.#selectedFeatureRefCount.size === 0) {
            this.#setPaint({...this.__colourOptions, dimmed: false});
        }
    }

    unselectFeatures()
    //================
    {
        for (const featureId of this.#selectedFeatureRefCount.keys()) {
            const feature = this.mapFeature(featureId);
            if (feature !== undefined) {
                this.#removeFeatureState(feature, 'selected');
            }
        }
        this.#selectedFeatureRefCount.clear();
        this.#setPaint({...this.__colourOptions, dimmed: false});
    }

    activateFeature(feature)
    //======================
    {
        if (feature !== undefined) {
            this.#setFeatureState(feature, { active: true });
            if (!this.#activeFeatures.has(+feature.id)) {
                this.#activeFeatures.set(+feature.id, feature)
            }
        }
    }

    activateLineFeatures(lineFeatures)
    //================================
    {
        for (const lineFeature of lineFeatures) {
            this.activateFeature(lineFeature)
            const lineIds = new Set(lineFeatures.map(f => f.properties.featureId))
            for (const featureId of this.__pathManager.lineFeatureIds(lineIds)) {
                this.activateFeature(this.mapFeature(featureId))
            }
        }
    }

    resetActiveFeatures_()
    //====================
    {
        for (const feature of this.#activeFeatures.values()) {
            this.#removeFeatureState(feature, 'active')
        }
        this.#activeFeatures.clear()
    }

    smallestAnnotatedPolygonFeature_(features)
    //========================================
    {
        // Get the smallest feature from a list of features

        let smallestArea = 0;
        let smallestFeature = null;
        for (const feature of features) {
            if (feature.geometry.type.includes('Polygon')
             && this.#getFeatureState(feature)['map-annotation']) {
                const polygon = turf.geometry(feature.geometry.type, feature.geometry.coordinates);
                const area = turfArea(polygon);
                if (smallestFeature === null || smallestArea > area) {
                    smallestFeature = feature;
                    smallestArea = area;
                }
            }
        }
        return smallestFeature;
    }

    setModal_(event)
    //==============
    {
        this._modal = true;
    }

    __clearModal(event)
    //=================
    {
        this._modal = false;
    }

    reset()
    //=====
    {
        this.__clearModal();
        this.__clearActiveMarker();
        this.unselectFeatures();
    }

    clearSearchResults(reset=true)
    //============================
    {
        this.unselectFeatures();
    }

    /**
     * Select features on the map.
     *
     * @param {Array.<string>}  featureIds  An array of feature identifiers to highlight
     */
    selectFeatures(featureIds)
    //========================
    {
        if (featureIds.length) {
            this.unselectFeatures();
            for (const featureId of featureIds) {
                const annotation = this._flatmap.annotation(featureId);
                if (annotation) {
                    if (this.selectFeature(featureId)) {
                        if ('type' in annotation && annotation.type.startsWith('line')) {
                            for (const pathFeatureId of this.__pathManager.lineFeatureIds([featureId])) {
                                this.selectFeature(pathFeatureId);
                            }
                        }
                    }
                }
            }
        }
    }

    showSearchResults(featureIds)
    //===========================
    {
        this.unselectFeatures();
        this.zoomToFeatures(featureIds);
    }

    /**
     * Select features and zoom the map to them.
     *
     * @param      {Array.<string>}  featureIds   An array of feature identifiers
     * @param      {Object}  [options]
     * @param      {boolean} [options.zoomIn=false]  Zoom in the map (always zoom out as necessary)
     */
    zoomToFeatures(featureIds, options=null)
    //======================================
    {
        options = utils.setDefaults(options, {
            zoomIn: false,
            sequence: false
        });
        if (featureIds.length) {
            if (!options.sequence) this.unselectFeatures();
            let bbox = null || options.bbox;
            if (!options.zoomIn) {
                const bounds = this._map.getBounds().toArray();
                bbox = [...bounds[0], ...bounds[1]];
            }
            for (const featureId of featureIds) {
                const annotation = this._flatmap.annotation(featureId)
                if (annotation) {
                    if (this.selectFeature(featureId)) {
                        bbox = expandBounds(bbox, annotation.bounds)
                        if ('type' in annotation && annotation.type.startsWith('line')) {
                            for (const pathFeatureId of this.__pathManager.lineFeatureIds([featureId])) {
                                if (this.selectFeature(pathFeatureId)) {
                                    const pathAnnotation = this._flatmap.annotation(pathFeatureId)
                                    bbox = expandBounds(bbox, pathAnnotation.bounds)
                                }
                            }
                        }
                    }
                }
            }
            if (bbox !== null) {
                this._map.fitBounds(bbox, {
                    padding: 0,
                    animate: false
                })
                return bbox
            }
        }
    }

    showPopup(featureId, content, options={})
    //=======================================
    {
        const ann = this._flatmap.annotation(featureId);
        const drawn = options && options.annotationFeatureGeometry;
        if (ann || drawn) {  // The feature exists or it is a drawn annotation

            // Remove any existing popup

            if (this._currentPopup) {
                if (options && options.preserveSelection) {
                    this._currentPopup.options.preserveSelection = options.preserveSelection;
                }
                this._currentPopup.remove();
            }

            // Clear selection if we are not preserving it

            if (options && options.preserveSelection) {
                delete options.preserveSelection;       // Don't pass to onClose()
            } else {                                    // via the popup's options
                this.unselectFeatures();
            }

            // Select the feature

            this.selectFeature(featureId);

            // Find the pop-up's postion

            let location = null;
            if ('positionAtLastClick' in options
               && options.positionAtLastClick
               && this.__lastClickLngLat !== null) {
                location = this.__lastClickLngLat;
            } else if (drawn) {
                // Popup at the centroid of the feature
                // Calculated with the feature geometry coordinates
                location = options.annotationFeatureGeometry;
            } else {
                // Position popup at the feature's 'centre'
                location = this.markerPosition(featureId, ann, options);
            }

            // Make sure the feature is on screen

            if (!this._map.getBounds().contains(location)) {
                this._map.panTo(location);
            }
            this.setModal_();
            this._currentPopup = new maplibregl.Popup(options).addTo(this._map);
            this._currentPopup.on('close', this.__onCloseCurrentPopup.bind(this));
            if (drawn) {
                this._currentPopup.on('close', this.abortAnnotationEvent.bind(this));
            }
            this._currentPopup.setLngLat(location);
            if (typeof content === 'object') {
                this._currentPopup.setDOMContent(content);
            } else {
                this._currentPopup.setText(content);
            }
        }
    }

    __onCloseCurrentPopup()
    //=====================
    {
        if (this._currentPopup) {
            this.__clearModal();
            if (!(this._currentPopup.options && this._currentPopup.options.preserveSelection)) {
                this.unselectFeatures();
            }
            this._currentPopup = null;
        }
    }

    removeTooltip_()
    //==============
    {
        if (this._tooltip) {
            this._tooltip.remove();
            this._tooltip = null;
        }
    }

    /**
     * Remove the currently active popup from the map.
     */
    removePopup()
    //===========
    {
        if (this._currentPopup) {
            this._currentPopup.remove();
            this._currentPopup = null;
        }
    }

    lineTooltip_(lineFeatures)
    //========================
    {
        const tooltips = [];
        for (const lineFeature of lineFeatures) {
            const properties = lineFeature.properties;
            if ('error' in properties) {
                tooltips.push(`<div class="feature-error">Error: ${properties.error}</div>`)
            }
            if ('warning' in properties) {
                tooltips.push(`<div class="feature-error">Warning: ${properties.warning}</div>`)
            }
            if ('label' in properties && (!('tooltip' in properties) || properties.tooltip)) {
                const label = properties.label;
                const cleanLabel = (label.substr(0, 1).toUpperCase() + label.substr(1)).replaceAll("\n", "<br/>");
                if (!tooltips.includes(cleanLabel)) {
                    tooltips.push(cleanLabel);
                }
            }
        }
        return (tooltips.length === 0) ? ''
                                       : `<div class='flatmap-feature-label'>${tooltips.join('<hr/>')}</div>`;
    }

    tooltipHtml_(properties, forceLabel=false)
    //========================================
    {
        const tooltip = [];
        if ('error' in properties) {
            tooltip.push(`<div class="feature-error">Error: ${properties.error}</div>`)
        }
        if ('warning' in properties) {
            tooltip.push(`<div class="feature-error">Warning: ${properties.warning}</div>`)
        }
        if (('label' in properties
          || 'hyperlink' in properties
          || 'user_label' in properties)
                && (forceLabel || !('tooltip' in properties) || properties.tooltip)) {
            const renderedLabel = getRenderedLabel(properties);
            if ('hyperlink' in properties) {
                if (renderedLabel === '') {
                    tooltip.push(`<a href='${properties.hyperlink}'>${properties.hyperlink}</a>`);
                } else {
                    tooltip.push(`<a href='${properties.hyperlink}'>${renderedLabel}</a></div>`);
                }
            } else {
                tooltip.push(renderedLabel);
            }
        }
        return (tooltip.length === 0) ? ''
                                      : `<div class='flatmap-feature-label'>${tooltip.join('<hr/>')}</div>`;
    }

    __featureEvent(type, feature, values={})
    //======================================
    {
        const properties = Object.assign({}, feature.properties, values)
        if (inAnatomicalClusterLayer(feature)) {
            return this._flatmap.markerEvent(type, feature.id, properties);
        } else if (feature.sourceLayer === PATHWAYS_LAYER) {  // I suspect this is never true as source layer
                                                              // names are like `neural_routes_pathways`
            return this._flatmap.featureEvent(type, this.__pathManager.pathProperties(feature));
        } else if ('properties' in feature) {
            return this._flatmap.featureEvent(type, properties);
        }
        return false;
    }

    __resetFeatureDisplay()
    //=====================
    {
        // Remove any existing tooltip
        this.removeTooltip_();

        // Reset cursor
        this._map.getCanvas().style.cursor = 'default';

        // Reset any active features
        this.resetActiveFeatures_();
    }

    #renderedFeatures(point)
    //======================
    {
        const features = this._layerManager.featuresAtPoint(point)
        return features.filter(feature => this.__featureEnabled(feature));
    }

    mouseMoveEvent_(event)
    //====================
    {
        this.#updateActiveFeature(event.point, event.lngLat)
    }

    #updateActiveFeature(eventPoint, lngLat)
    //======================================
    {
        // No tooltip when context menu is open
        if (this._modal) {
            return;
        }

        // Remove tooltip, reset active features, etc
        this.__resetFeatureDisplay();

        // Reset any info display
        const displayInfo = (this._infoControl && this._infoControl.active);
        if (displayInfo) {
            this._infoControl.reset()
        }

        // Get all the features at the current point
        const features = this.#renderedFeatures(eventPoint)
        if (features.length === 0) {
            this._lastFeatureMouseEntered = null;
            this._lastFeatureModelsMouse = null;
            return;
        }

        // Simulate `mouseenter` events on features

        const feature = features[0]
        const featureId = inAnatomicalClusterLayer(feature) ? feature.id
                                                            : feature.properties.featureId
        const featureModels = ('properties' in feature && 'models' in feature.properties)
                            ? feature.properties.models
                            : null
        if (this._lastFeatureMouseEntered !== featureId
         && (this._lastFeatureModelsMouse === null
          || this._lastFeatureModelsMouse !== featureModels)) {
            if (this.__featureEvent('mouseenter', feature,
                                    this.#locationOnLine(featureId, lngLat))) {
                this._lastFeatureMouseEntered = featureId
                this._lastFeatureModelsMouse = featureModels
            } else {
                this._lastFeatureMouseEntered = null
                this._lastFeatureModelsMouse = null
            }
        } else if (this._flatmap.options.style === FLATMAP_STYLE.CENTRELINE
                && feature.properties.centreline) {
            if (this._lastFeatureMouseEntered === featureId) {
                const location = this.#locationOnLine(featureId, lngLat)
                if ('location' in location) {
                    this.__featureEvent('mousemove', feature, location)
                }
            }
        }

        let info = '';
        let tooltip = '';
        let tooltipFeature = null;
        const eventLngLat = this._map.unproject(eventPoint)
        if (displayInfo) {
            if (!('tooltip' in features[0].properties)) {
                this.activateFeature(features[0]);
            }
            info = this._infoControl.featureInformation(features, eventLngLat);
        } else if (this._flatmap.options.showId) {
            this.activateFeature(features[0])
            tooltipFeature = features[0]
        }
        const lineFeatures = features.filter(feature => ('centreline' in feature.properties
                                                      || ('type' in feature.properties
                                                        && feature.properties.type.startsWith('line')) ));
        if (lineFeatures.length > 0) {
            tooltip = this.lineTooltip_(lineFeatures);
            tooltipFeature = lineFeatures[0];
            this.activateLineFeatures(lineFeatures)
        } else {
            const topSourceLayer = feature.sourceLayer
            let labelledFeatures = features.filter(feature => (feature.sourceLayer === topSourceLayer
                                                         && ('hyperlink' in feature.properties
                                                          || 'label' in feature.properties
                                                          || 'user_label' in feature.properties
                                                          || this._flatmap.options.showId && 'id' in feature.properties
                                                            )
                                                         && (!('tooltip' in feature.properties)
                                                            || feature.properties.tooltip)))
                                           .sort((a, b) => (a.properties.area - b.properties.area));
            if (labelledFeatures.length > 0) {
                // Favour group features at low zoom levels
                const zoomLevel = this._map.getZoom();
                const groupFeatures = labelledFeatures.filter(feature => (feature.properties.group
                                                     && zoomLevel < (feature.properties.scale + 1)));
                if (groupFeatures.length > 0) {
                    labelledFeatures = groupFeatures;
                }
                const feature = labelledFeatures[0];
                if (feature.properties.user_drawn) {
                    feature.id = feature.properties.id
                }
                tooltip = this.tooltipHtml_(feature.properties);
                tooltipFeature = feature;
                if (this._flatmap.options.debug) {  // Do this when Info on and not debug??
                    const debugProperties = [
                        'featureId',
                        'nerveId',
                        'tile-layer',
                        'type',
                        ...displayedProperties
                    ];
                    const htmlList = [];
                    const featureIds = [];
                    for (const feature of labelledFeatures) {
                        if (!featureIds.includes(feature.id)) {
                            featureIds.push(feature.id);
                            for (const prop of debugProperties) {
                                if (prop in feature.properties) {
                                    htmlList.push(`<span class="info-name">${prop}:</span>`);
                                    htmlList.push(`<span class="info-value">${feature.properties[prop]}</span>`);
                                }
                            }
                        }
                        //htmlList.push(`<span class="info-name">Area:</span>`);
                        //htmlList.push(`<span class="info-value">${feature.properties.area/1000000000}</span>`);
                        //htmlList.push(`<span class="info-name">Scale:</span>`);
                        //htmlList.push(`<span class="info-value">${feature.properties.scale}</span>`);
                    }
                    if (!this._flatmap.options.debug) {
                        info = `<div id="info-control-info">${htmlList.join('\n')}</div>`;
                    }
                }
                this.activateFeature(feature);
                this.__activateRelatedFeatures(feature);
                if ('hyperlink' in feature.properties) {
                    this._map.getCanvas().style.cursor = 'pointer';
                }
            }
        }

        if (info !== '') {
            this._infoControl.show(info);
        }
        this.__showToolTip(tooltip, eventLngLat, tooltipFeature);
    }

    __showToolTip(html, lngLat, feature=null)
    //=======================================
    {
        // Show a tooltip
        if (html !== ''
        || this._flatmap.options.showPosition
        || this._flatmap.options.showId && feature !== null) {
            let header = '';
            if (this._flatmap.options.showPosition) {
                const pt = turf.point(lngLat.toArray())
                const gps = turfProjection.toMercator(pt)
                const coords = JSON.stringify(gps.geometry.coordinates)
                let geopos = null
                if (this._flatmap.options.showLngLat) {
                    geopos = JSON.stringify(lngLat.toArray())
                }
                const position = (geopos === null) ? coords : `${geopos}<br/>${coords}`
                header = (feature === null)
                             ? position
                             : `${position} (${feature.id})`
            }
            if (this._flatmap.options.showId && feature !== null && 'id' in feature.properties) {
                header = `${header} ${feature.properties.id}`;
            }
            if (header !== '') {
                html = `<span>${header}</span><br/>${html}`;
            }
            if (html !== '') {
                this._tooltip = new maplibregl.Popup({
                    closeButton: false,
                    closeOnClick: false,
                    maxWidth: 'none',
                    className: 'flatmap-tooltip-popup'
                });
                this._tooltip
                    .setLngLat(lngLat)
                    .setHTML(html)
                    .addTo(this._map);
            }
        }
    }

    #selectActiveFeatures(event)
    //==========================
    {
        const singleSelection = !(event.ctrlKey || event.metaKey)
        if (singleSelection) {
            this.unselectFeatures()
        }
        for (const [featureId, feature] of this.#activeFeatures) {
            const dim = !('properties' in feature
                       && 'kind' in feature.properties
                       && ['cell-type', 'scaffold', 'tissue'].includes(feature.properties.kind))
            if (singleSelection) {
                this.selectFeature(featureId, dim)
            } else if (this.featureSelected_(featureId)) {
                this.unselectFeature(featureId)
            } else {
                this.selectFeature(featureId, dim)
            }
        }
    }

    clickEvent_(event)
    //================
    {
        if (this._modal) {
            return;
        }

        // Reset pitch and bearing with an ``alt-meta-click``
        if (event.originalEvent.altKey && event.originalEvent.metaKey) {
            this._map.resetNorthPitch({animate: false})
            return
        }

        this.__clearActiveMarker();

        let clickedFeatures = this.#renderedFeatures(event.point)
        if (clickedFeatures.length == 0) {
            this.unselectFeatures();
            return;
        }
        const clickedDrawnFeatures = clickedFeatures.filter((f) => !f.id);
        clickedFeatures = clickedFeatures.filter((f) => f.id)
        const clickedFeature = clickedFeatures[0]
        if (this._modal) {
            // Remove tooltip, reset active features, etc
            this.__resetFeatureDisplay();
            this.unselectFeatures();
            this.__clearModal();
        } else if (clickedDrawnFeatures.length > 0) {
            // Layer of existing drawn features
            const clickedOnColdLayer = clickedDrawnFeatures.filter((f) => f.source === 'mapbox-gl-draw-cold')[0];
            // Layer of currently drawing feature
            const clickedOnHotLayer = clickedDrawnFeatures.filter((f) => f.source === 'mapbox-gl-draw-hot')[0];
            this.__featureEvent('click',
                clickedOnColdLayer ? clickedOnColdLayer
              : clickedFeature ? clickedFeature
              : clickedOnHotLayer
            );
        } else if (clickedFeatures.length) {
            this.__lastClickLngLat = event.lngLat
            if (this._flatmap.options.style !== FLATMAP_STYLE.CENTRELINE) {
                this.#selectActiveFeatures(event.originalEvent)
                this.__featureEvent('click', clickedFeature)
            } else {
                const seenFeatures = new Set()
                this.#selectActiveFeatures(event.originalEvent)
                const centreline_click = (clickedFeature.properties.kind === 'centreline')
                for (const feature of clickedFeatures) {
                    if (!seenFeatures.has(feature.properties.id)) {
                        seenFeatures.add(feature.properties.id)
                        if (!centreline_click || centreline_click && (feature.properties.kind === 'centreline')) {
                            this.__featureEvent('click', feature,
                                                this.#locationOnLine(feature.id, event.lngLat))
                        }
                    }
                }
            }
            if (this._flatmap.options.standalone) {
                if ('properties' in clickedFeature && 'hyperlink' in clickedFeature.properties) {
                    window.open(clickedFeature.properties.hyperlink, '_blank');
                }
            }
        }
    }

    #locationOnLine(featureId, lngLat)
    //================================
    {
        if (lngLat && this._flatmap.options.style === FLATMAP_STYLE.CENTRELINE) {
            const annotation = this._flatmap.annotation(featureId)
            if (annotation.centreline && 'lineString' in annotation) {
                const line = annotation.lineString
                const clickedPoint = turf.point([lngLat.lng, lngLat.lat])
                const linePoint = turfNearestPointOnLine.nearestPointOnLine(line, clickedPoint)
                return {
                    location: linePoint.properties.location/annotation.lineLength
                }
            }
        }
        return {}
    }

    __activateRelatedFeatures(feature)
    //================================
    {
        if ('nerveId' in feature.properties) {
            const nerveId = feature.properties.nerveId;
            if (nerveId !== feature.id) {
                this.activateFeature(this.mapFeature(nerveId));
            }
            for (const featureId of this.__pathManager.nerveFeatureIds(nerveId)) {
                this.activateFeature(this.mapFeature(featureId));
            }
        }
        if ('nodeId' in feature.properties) {
            for (const featureId of this.__pathManager.pathFeatureIds(feature.properties.nodeId)) {
                this.activateFeature(this.mapFeature(featureId));
            }
        }
    }

    clearVisibilityFilter()
    //=====================
    {
        this._layerManager.clearVisibilityFilter()
    }

    setVisibilityFilter(filterSpecification=true)
    //===========================================
    {
        this._layerManager.setVisibilityFilter(new PropertiesFilter(filterSpecification))
    }

    enablePathsBySystem(system, enable=true, force=false)
    //===================================================
    {
        this.__pathManager.enablePathsBySystem(system, enable, force);
    }

    enablePathsByType(pathType, enable=true)
    //======================================
    {
        this.#pathTypeFacet.enable(Array.isArray(pathType) ? pathType : [pathType], enable)
        this._layerManager.refresh()
    }

    pathFeatureIds(externalIds)
    //=========================
    {
        const featureIds = new utils.List();
        featureIds.extend(this.__pathManager.connectivityModelFeatureIds(externalIds));
        featureIds.extend(this.__pathManager.pathModelFeatureIds(externalIds));
        return featureIds;
    }

    pathModelNodes(modelId)
    //=====================
    {
        return this.__pathManager.pathModelNodes(modelId);
    }

    nodePathModels(nodeId)
    //====================
    {
        return this.__pathManager.nodePathModels(nodeId);
    }

    enableSckanPaths(sckanState, enable=true)
    //=======================================
    {
        this._layerManager.enableSckanPaths(sckanState, enable);
    }

    enableConnectivityByTaxonIds(taxonIds, enable=true)
    //=================================================
    {
        this.#taxonFacet.enable(Array.isArray(taxonIds) ? taxonIds : [taxonIds], enable)
        this._layerManager.refresh()
    }

    excludeAnnotated(exclude=false)
    //=============================
    {
        this.#setPaint({excludeAnnotated: exclude});
    }

    //==============================================================================

    // Marker handling

    markerPosition(featureId, annotation, options={})
    //===============================================
    {
        if (this.__markerPositions.has(featureId)) {
            return this.__markerPositions.get(featureId);
        }
        if (annotation.centreline && 'location' in options) {
            if ('lineString' in annotation) {
                const line = annotation.lineString
                const point = turfAlong(line, options.location*annotation.lineLength)
                return point.geometry.coordinates
            }
            return null
        }
        if (!('markerPosition' in annotation) && !annotation.geometry.includes('Polygon')) {
            return null
        }
        let position = annotation.markerPosition || annotation.centroid;
        if (position === null || position == undefined) {
            // Find where to place a label or popup on a feature
            const features = this._map.querySourceFeatures(VECTOR_TILES_SOURCE, {
                'sourceLayer': this._flatmap.options.separateLayers
                                ? `${annotation['layer']}_${annotation['tile-layer']}`
                                : annotation['tile-layer'],
                'filter': [
                    'all',
                    [ '==', ['id'], parseInt(featureId) ],
                    [ '==', ['geometry-type'], 'Polygon' ]
                ]
            });
            if (features.length > 0) {
                position = labelPosition(features[0]);
            }
        }
        this.__markerPositions.set(featureId, position, options);
        return position;
    }

    nextMarkerId()
    //============
    {
        this.#lastMarkerId += 1
        return this.#lastMarkerId
    }

    addMarker(anatomicalId, options={})
    //=================================
    {
        const featureIds = this._flatmap.modelFeatureIds(anatomicalId);
        let markerId = -1;

        for (const featureId of featureIds) {
            const annotation = this._flatmap.annotation(featureId);
            const markerPosition = this.markerPosition(featureId, annotation, options)
            if (markerPosition === null) {
                continue
            }
            if (!('marker' in annotation)) {
                if (markerId === -1) {
                    markerId = this.nextMarkerId()
                }

                // MapLibre dynamically sets a transform on marker elements so in
                // order to apply a scale transform we need to create marker icons
                // inside the marker container <div>.
                const colour = options.colour || '#005974';
                const markerHTML = options.element ? new maplibregl.Marker({element: options.element})
                                                   : new maplibregl.Marker({color: colour, scale: 0.5});

                const markerElement = document.createElement('div');
                const markerIcon = document.createElement('div');
                markerIcon.innerHTML = markerHTML.getElement().innerHTML;
                markerElement.id = `marker-${markerId}`;
                markerElement.appendChild(markerIcon);
                const markerOptions = {element: markerElement};
                if ('className' in options) {
                    markerOptions.className = options.className;
                }
//                if (options.cluster && this._layerManager) {
//                    this._layerManager.addMarker(markerId, markerPosition, annotation)
//                } else {
                    const marker = new maplibregl.Marker(markerOptions)
                                                 .setLngLat(markerPosition)
                                                 .addTo(this._map);
                    markerElement.addEventListener('mouseenter',
                        this.markerMouseEvent_.bind(this, marker, anatomicalId));
                    markerElement.addEventListener('mousemove',
                        this.markerMouseEvent_.bind(this, marker, anatomicalId));
                    markerElement.addEventListener('mouseleave',
                        this.markerMouseEvent_.bind(this, marker, anatomicalId));
                    markerElement.addEventListener('click',
                        this.markerMouseEvent_.bind(this, marker, anatomicalId));

                    this.__markerIdByMarker.set(marker, markerId);
                    this.__markerIdByFeatureId.set(+featureId, markerId);
                    this.__annotationByMarkerId.set(markerId, annotation);
                    if (!this.__featureEnabled(this.mapFeature(+featureId))) {
                        markerElement.style.visibility = 'hidden';
                    }
//                }
            }
        }
        if (markerId === -1) {
            console.warn(`Unable to find feature '${anatomicalId}' on which to place marker`)
        }
        return markerId;
    }

    clearMarkers()
    //============
    {
        if (this._layerManager) {
            this._layerManager.clearMarkers()
        }
        for (const marker of this.__markerIdByMarker.keys()) {
            marker.remove();
        }
        this.__markerIdByMarker.clear();
        this.__annotationByMarkerId.clear();
    }

    removeMarker(markerId)
    //====================
    {
        for (const [marker, id] of this.__markerIdByMarker.entries()) {
            if (markerId === id) {
                marker.remove();
                this.__markerIdByMarker.remove(marker);
                this.__annotationByMarkerId.remove(id);
                break;
            }
        }
    }

    addDatasetMarkers(datasets)
    //=========================
    {
        if (this._layerManager) {
            return this._layerManager.addDatasetMarkers(datasets)
        }
    }

    clearDatasetMarkers()
    //===================
    {
        if (this._layerManager) {
            this._layerManager.clearDatasetMarkers()
        }
    }

    removeDatasetMarker(datasetId)
    //============================
    {
        if (this._layerManager) {
            this._layerManager.removeDatasetMarker(markedatasetIdrId)
        }
    }

    visibleMarkerAnatomicalIds()
    //==========================
    {
        const anatomicalIds = [];
        const visibleBounds = this._map.getBounds();
        for (const [marker, id] of this.__markerIdByMarker.entries()) {
            if (visibleBounds.contains(marker.getLngLat())) {
                const annotation = this.__annotationByMarkerId.get(id);
                if (!anatomicalIds.includes(annotation.models)) {
                    anatomicalIds.push(annotation.models);
                }
            }
        }
        return anatomicalIds;
    }

    markerMouseEvent_(marker, anatomicalId, event)
    //============================================
    {
        // No tooltip when context menu is open
        if (this._modal
         || (this.__activeMarker !== null && event.type === 'mouseleave')) {
            return
        }

        if (['mouseenter', 'mousemove', 'click'].includes(event.type)) {
            this.__activeMarker = marker

            // Remove any tooltip
            marker.setPopup(null)

            // Reset cursor
            marker.getElement().style.cursor = 'default';

            const markerId = this.__markerIdByMarker.get(marker)
            const annotation = this.__annotationByMarkerId.get(markerId)

            this.markerEvent_(event, markerId, marker.getLngLat(), annotation)
            event.stopPropagation()
        }
    }

    markerEvent_(event, markerId, markerPosition, annotation)
    //=======================================================
    {
        if (['mousemove', 'click'].includes(event.type)) {

            // Remove any tooltips
            this.removeTooltip_();

            if (['mouseenter', 'mousemove', 'click'].includes(event.type)) {
                // The marker's feature
                const feature = this.mapFeature(annotation.featureId);
                if (feature !== undefined) {
                    if (event.type === 'mouseenter') {
                        // Highlight on mouse enter
                        this.resetActiveFeatures_();
                        this.activateFeature(feature);
                    } else {
                        this.#selectActiveFeatures(event)
                    }
                }
                // Show tooltip
                const html = this.tooltipHtml_(annotation, true);
                this.__showToolTip(html, markerPosition);

                // Send marker event message
                this._flatmap.markerEvent(event.type, markerId, annotation)
            }
        }
    }

    __clearActiveMarker()
    //==================
    {
        if (this.__activeMarker !== null) {
            this.__activeMarker.setPopup(null);
            this.__activeMarker = null;
        }
    }

    showMarkerPopup(markerId, content, options)
    //=========================================
    {
        const marker = this.__activeMarker;
        if (markerId !== this.__markerIdByMarker.get(marker)) {
            this.__clearActiveMarker();
            return false;
        }

        const location = marker.getLngLat();

        // Make sure the marker is on screen

        if (!this._map.getBounds().contains(location)) {
            this._map.panTo(location);
        }

        const element = document.createElement('div');
        if (typeof content === 'object') {
            element.appendChild(content);
        } else {
            element.innerHTML = content;
        }

        element.addEventListener('click', e => this.__clearActiveMarker());

        this._tooltip = new maplibregl.Popup({
            closeButton: false,
            closeOnClick: false,
            maxWidth: 'none',
            className: 'flatmap-marker-popup'
        });

        this._tooltip
            .setLngLat(location)
            .setDOMContent(element);

        // Set the marker tooltip and show it
        marker.setPopup(this._tooltip);
        marker.togglePopup();

        return true;
    }

    enablePanZoomEvents(enabled=true)
    //===============================
    {
        this.__pan_zoom_enabled = enabled;
    }

    panZoomEvent_(type, event)
    //========================
    {
        if (this.__pan_zoom_enabled) {
            this._flatmap.panZoomEvent(type);
        }
        if (type === 'zoom') {
            if ('originalEvent' in event) {
                if ('layerX' in event.originalEvent && 'layerY' in event.originalEvent) {
                    this.#updateActiveFeature([
                        event.originalEvent.layerX,
                        event.originalEvent.layerY
                    ])
                }
            }
            this._layerManager.zoomEvent()
        }
    }

    //==========================================================================

    addImage(anatomicalId, imageUrl, options={})
    //==========================================
    {
        const featureIds = this._flatmap.modelFeatureIds(anatomicalId)
        const imageIds = []
        const mapImageId = `image-${this.#lastImageId}`
        for (const featureId of featureIds) {
            const annotation = this._flatmap.annotation(featureId)
            if (!annotation.geometry.includes('Polygon')) {
                continue;
            }
            this.#lastImageId += 1
            const imageId = `${mapImageId}-${this.#lastImageId}`
            const featureBounds = annotation.bounds
            this._map.addSource(`${imageId}-source`, {
                type: 'image',
                url: imageUrl,
                coordinates: [
                    [featureBounds[0], featureBounds[3]],
                    [featureBounds[2], featureBounds[3]],
                    [featureBounds[2], featureBounds[1]],
                    [featureBounds[0], featureBounds[1]],
                ]
            })
            this._map.addLayer({
                id: `${imageId}-layer`,
                'type': 'raster',
                'source': `${imageId}-source`,
                'paint': {
                    'raster-fade-duration': 0
                }
            })
            imageIds.push(imageId)
        }
        if (imageIds.length === 0) {
            console.warn(`Unable to find feature '${anatomicalId}' on which to place image`)
            return null
        }
        this.#imageLayerIds.set(mapImageId, imageIds)
        return mapImageId
    }

    removeImage(mapImageId)
    //=====================
    {
        if (this.#imageLayerIds.has(mapImageId)) {
            for (const imageId of this.#imageLayerIds.get(mapImageId)) {
                const layerId = `${imageId}-layer`
                if (this._map.getLayer(layerId)) {
                    this._map.removeLayer(layerId)
                }
                this._map.removeSource(`${imageId}-source`)
            }
            this.#imageLayerIds.delete(mapImageId)
        }
    }

    //==========================================================================

    getNerveDetails()
    //===============
    {
        return this.__pathManager.nerveCentrelineDetails
    }

    enableNeuronPathsByNerve(nerveModels, enable=true, showCentreline=false)
    //======================================================================
    {
        this.#nerveCentrelineFacet.enable(Array.isArray(nerveModels) ? nerveModels : [nerveModels], enable)
        this.#pathTypeFacet.enableCentrelines(showCentreline)
        this._layerManager.refresh()
    }
}

//==============================================================================
