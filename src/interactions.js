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

import {default as turfArea} from '@turf/area';
import {default as turfBBox} from '@turf/bbox';
import * as turf from '@turf/helpers';
import * as turfProjection from '@turf/projection';

import polylabel from 'polylabel';

//==============================================================================

import {LayerManager} from './layers';
import {PATHWAYS_LAYER, PathManager} from './pathways';
import {VECTOR_TILES_SOURCE} from './layers/styling';
import {Paths3DLayer} from './layers/paths3d'
import {SystemsManager} from './systems';

import {displayedProperties, InfoControl} from './controls/info';
import {AnnotatorControl, BackgroundControl, LayerControl, NerveControl,
        SCKANControl, CompletenessControl} from './controls/controls';
import {AnnotationDrawControl, DRAW_ANNOTATION_LAYERS} from './controls/annotation'
import {PathControl} from './controls/paths';
import {Path3DControl} from './controls/paths3d'
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
    return (bbox1 === null) ? [bbox2[0]-padding.lng, bbox2[1]-padding.lat,
                               bbox2[2]+padding.lng, bbox2[3]+padding.lat]
                            : [Math.min(bbox1[0], bbox2[0]-padding.lng), Math.min(bbox1[1], bbox2[1]-padding.lat),
                               Math.max(bbox1[2], bbox2[2]+padding.lng), Math.max(bbox1[3], bbox2[3]+padding.lat)
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
        properties.renderedLabel = uppercaseLabel.replaceAll(/`\$([^\$]*)\$`/g, math => latex2Svg(math.slice(2, -2)));
    }
    return properties.renderedLabel;
}

//==============================================================================

export class UserInteractions
{
    #annotationDrawControl = null
    #minimap = null
    #paths3dLayer = null

    constructor(flatmap)
    {
        this._flatmap = flatmap;
        this._map = flatmap.map;

        this._activeFeatures = new Set()
        this._selectedFeatureIds = new Map();
        this._currentPopup = null;
        this._infoControl = null;
        this._tooltip = null;

        this._inQuery = false;
        this._modal = false;

        // Default colour settings
        this.__colourOptions = {colour: true, outline: true};

        // Marker placement and interaction

        this.__activeMarker = null;
        this.__lastMarkerId = 900000;
        this.__markerIdByMarker = new Map();
        this.__markerIdByFeatureId = new Map();
        this.__annotationByMarkerId = new Map();

        // Where to put labels and popups on a feature
        this.__markerPositions = new Map();

        // Fit the map to its initial position

        flatmap.setInitialPosition();

        // Add and manage our layers

        this._layerManager = new LayerManager(flatmap);

        this.__featureEnabledCount = new Map(Array.from(this._flatmap.annotations.keys()).map(k => [+k, 0]));

        const featuresEnabled = flatmap.options.style !== 'functional';

        // Path visibility is either controlled externally or by a local control
        // FC path visiblitity is determined by system visiblity

        this.__pathManager = new PathManager(flatmap, this, featuresEnabled);

        // The path types in this map
        const mapPathTypes = this.__pathManager.pathTypes();

        // Set initial enabled state of paths
        for (const path of mapPathTypes) {
            this.__pathManager.enablePathsByType(path.type, path.enabled, true);
        }
        if (this.__pathManager.haveCentrelines) {
            this.enableCentrelines(this.__pathManager.enabledCentrelines, true);
        }

        // Note features that are FC systems
        this.__systemsManager = new SystemsManager(this._flatmap, this, featuresEnabled);

        // All taxons of connectivity paths are enabled by default
        this.__enabledConnectivityTaxons = new Set(this._flatmap.taxonIdentifiers);

        // Add a minimap if option set
        if (flatmap.options.minimap) {
            this.#minimap = new MinimapControl(flatmap, flatmap.options.minimap);
            this._map.addControl(this.#minimap);
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

        // Support 3D path view
        this.#paths3dLayer = new Paths3DLayer(flatmap, this)

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

            // Add a control to manage our layers
            this._map.addControl(new LayerControl(flatmap, this._layerManager));

            // Add a control for nerve centrelines if they are present
            if (this.__pathManager.haveCentrelines) {
                this._map.addControl(new NerveControl(flatmap, this._layerManager, {showCentrelines: false}));
            }

            if (flatmap.options.style === 'functional') {
                // SCKAN path and SYSTEMS controls for FC maps
                this._map.addControl(new SystemsControl(flatmap, this.__systemsManager.systems));
                this._map.addControl(new SCKANControl(flatmap, flatmap.options.layerOptions));
            } else {
                // Connectivity taxon control for AC maps
                this._map.addControl(new TaxonsControl(flatmap));
            }
            this._map.addControl(new CompletenessControl(flatmap, flatmap.options.layerOptions));

            this._map.addControl(new Path3DControl(this));

            if (flatmap.options.annotator) {
                this._map.addControl(new AnnotatorControl(flatmap));
            }
        }

        // Initialise map annotation
        this.__setupAnnotation()

        // Add an initially hidden tool for drawing on the map.
        this.#annotationDrawControl = new AnnotationDrawControl(flatmap, false)
        this._map.addControl(this.#annotationDrawControl)

        // Handle mouse events

        this._map.on('click', this.clickEvent_.bind(this));
        this._map.on('mousemove', this.mouseMoveEvent_.bind(this));
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
            layers: this.layers
        };
    }

    setState(state)
    //=============
    {
        // Restore the map to a saved state
        const options = {};
        if ('center' in state) {
            options['center'] = state.center;
        }
        if ('zoom' in state) {
            options['zoom'] = state.zoom;
            if ('center' in state) {
                options['around'] = state.center;
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

    rollbackAnnotationEvent(event)
    //==========================
    {
        if (this.#annotationDrawControl) {
            this.#annotationDrawControl.rollbackEvent(event)
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
        if (this.#paths3dLayer) {
            this.#paths3dLayer.setPaint(options)
        }
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

    enable3dPaths(enable=true)
    //========================
    {
        if (this.#paths3dLayer) {
            this.#paths3dLayer.enable(enable)
        }
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

    mapFeature(featureId)
    //===================
    {
        const ann = this._flatmap.annotation(featureId);
        if (ann !== undefined) {
            return {
                id: featureId,
                source: VECTOR_TILES_SOURCE,
                sourceLayer: (this._flatmap.options.separateLayers
                             ? `${ann['layer']}_${ann['tile-layer']}`
                             : ann['tile-layer']).replaceAll('/', '_'),
                children: ann.children || []
            };
        }
        return undefined;
    }

    #getFeatureState(feature)
    //=======================
    {
        return this._map.getFeatureState(feature)
    }

    #removeFeatureState(feature, key)
    //===============================
    {
        this._map.removeFeatureState(feature, key)
        if (this.#paths3dLayer) {
            this.#paths3dLayer.removeFeatureState(feature.id, key)
        }
    }

    #setFeatureState(feature, state)
    //==============================
    {
        this._map.setFeatureState(feature, state)
        if (this.#paths3dLayer) {
            this.#paths3dLayer.setFeatureState(feature.id, state)
        }
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
                && (!('hidden' in state) || !state.hidden));
        }
        return DRAW_ANNOTATION_LAYERS.includes(feature.layer.id)
    }

    featureSelected_(featureId)
    //=========================
    {
        return this._selectedFeatureIds.has(+featureId);
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
        const noSelection = (this._selectedFeatureIds.size === 0);
        if (this._selectedFeatureIds.has(featureId)) {
            this._selectedFeatureIds.set(featureId, this._selectedFeatureIds.get(featureId) + 1);
            result = true;
        } else {
            const feature = this.mapFeature(featureId);
            if (feature !== undefined) {
                const state = this.#getFeatureState(feature);
                if (state !== undefined && (!('hidden' in state) || !state.hidden)) {
                    this.#setFeatureState(feature, { selected: true });
                    this._selectedFeatureIds.set(featureId, 1);
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
        if (this._selectedFeatureIds.has(featureId)) {
            const references = this._selectedFeatureIds.get(featureId);
            if (references > 1) {
                this._selectedFeatureIds.set(featureId, references - 1);
            } else {
                const feature = this.mapFeature(featureId);
                if (feature !== undefined) {
                    this.#removeFeatureState(feature, 'selected');
                    this._selectedFeatureIds.delete(+featureId);
                }
            }
        }
        if (this._selectedFeatureIds.size === 0) {
            this.#setPaint({...this.__colourOptions, dimmed: false});
        }
    }

    unselectFeatures()
    //================
    {
        for (const featureId of this._selectedFeatureIds.keys()) {
            const feature = this.mapFeature(featureId);
            if (feature !== undefined) {
                this.#removeFeatureState(feature, 'selected');
            }
        }
        this._selectedFeatureIds.clear();
        this.#setPaint({...this.__colourOptions, dimmed: false});
    }

    activateFeature(feature)
    //======================
    {
        if (feature !== undefined) {
            this.#setFeatureState(feature, { active: true });
            this._activeFeatures.add(feature);
        }
    }

    activateLineFeatures(lineFeatures)
    //================================
    {
        for (const lineFeature of lineFeatures) {
            const lineFeatureId = +lineFeature.properties.featureId  // Ensure numeric
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
        for (const feature of this._activeFeatures) {
            this.#removeFeatureState(feature, 'active');
        }
        this._activeFeatures.clear()
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
        this.zoomToFeatures(featureIds, {noZoomIn: true});
    }

    /**
     * Select features and zoom the map to them.
     *
     * @param      {Array.<string>}  featureIds   An array of feature identifiers
     * @param      {Object}  [options]
     * @param      {boolean} [options.noZoomIn=false]  Don't zoom in (although zoom out as necessary)
     * @param      {number}  [options.padding=10]  Padding in pixels around the composite bounding box
     */
    zoomToFeatures(featureIds, options=null)
    //======================================
    {
        options = utils.setDefaults(options, {
            noZoomIn: false,
            padding: 10        // pixels
        });
        if (featureIds.length) {
            this.unselectFeatures();
            let bbox = null;
            if (options.noZoomIn) {
                const bounds = this._map.getBounds().toArray();
                bbox = [...bounds[0], ...bounds[1]];
            }
            // Convert pixel padding to LngLat and apply it to a feature's bounds
            const padding = this._map.unproject({x: options.padding, y: options.padding});
            padding.lng -= bbox[0];
            padding.lat = bbox[3] - padding.lat;
            for (const featureId of featureIds) {
                const annotation = this._flatmap.annotation(featureId);
                if (annotation) {
                    if (this.selectFeature(featureId)) {
                        bbox = expandBounds(bbox, annotation.bounds, padding);
                        if ('type' in annotation && annotation.type.startsWith('line')) {
                            for (const pathFeatureId of this.__pathManager.lineFeatureIds([featureId])) {
                                if (this.selectFeature(pathFeatureId)) {
                                    const pathAnnotation = this._flatmap.annotation(pathFeatureId)
                                    bbox = expandBounds(bbox, pathAnnotation.bounds, padding);
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
                });
            }
        }
    }

    showPopup(featureId, content, options={})
    //=======================================
    {
        const ann = this._flatmap.annotation(featureId);
        if (ann) {  // The feature exists

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
            } else {
                // Position popup at the feature's 'centre'
                location = this.__markerPosition(featureId, ann);
            }

            // Make sure the feature is on screen

            if (!this._map.getBounds().contains(location)) {
                this._map.panTo(location);
            }
            this.setModal_();
            this._currentPopup = new maplibregl.Popup(options).addTo(this._map);
            this._currentPopup.on('close', this.__onCloseCurrentPopup.bind(this));
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
        let renderedLabel;
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

    __featureEvent(type, feature)
    //===========================
    {
        if (feature.sourceLayer === PATHWAYS_LAYER) {  // I suspect this is never true as source layer
                                                       // names are like `neural_routes_pathways`
            return this._flatmap.featureEvent(type, this.__pathManager.pathProperties(feature));
        } else if ('properties' in feature) {
            return this._flatmap.featureEvent(type, feature.properties);
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
        let features = []
        if (this.#paths3dLayer) {
            features = this.#paths3dLayer.queryFeaturesAtPoint(point)
        }
        if (features.length === 0) {
            features = this._map.queryRenderedFeatures(point)
        }
        return features.filter(feature => this.__featureEnabled(feature));
    }

    mouseMoveEvent_(event)
    //====================
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
        const features = this.#renderedFeatures(event.point)
        if (features.length === 0) {
            this._lastFeatureMouseEntered = null;
            this._lastFeatureModelsMouse = null;
            return;
        }

        // Simulate `mouseenter` events on features

        const feature = features[0];
        const featureModels = ('properties' in feature && 'models' in feature.properties)
                            ? feature.properties.models
                            : null;
        if (this._lastFeatureMouseEntered !== feature.id
         && (this._lastFeatureModelsMouse === null
          || this._lastFeatureModelsMouse !== featureModels)) {
            if (this.__featureEvent('mouseenter', feature)) {
                this._lastFeatureMouseEntered = feature.id;
                this._lastFeatureModelsMouse = featureModels;
            } else {
                this._lastFeatureMouseEntered = null;
                this._lastFeatureModelsMouse = null;
            }
        }

        let info = '';
        let tooltip = '';
        if (displayInfo) {
            if (!('tooltip' in features[0].properties)) {
                this.activateFeature(features[0]);
            }
            info = this._infoControl.featureInformation(features, event.lngLat);
        }
        const lineFeatures = features.filter(feature => ('centreline' in feature.properties
                                                      || ('type' in feature.properties
                                                        && feature.properties.type.startsWith('line')) ));
        let tooltipFeature = null;
        if (lineFeatures.length > 0) {
            tooltip = this.lineTooltip_(lineFeatures);
            tooltipFeature = lineFeatures[0];
            this.activateLineFeatures(lineFeatures)
        } else {
            let labelledFeatures = features.filter(feature => (('hyperlink' in feature.properties
                                                             || 'label' in feature.properties
                                                             || 'user_label' in feature.properties)
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
        this.__showToolTip(tooltip, event.lngLat, tooltipFeature);
    }

    __showToolTip(html, lngLat, feature=null)
    //=======================================
    {
        // Show a tooltip
        if (html !== '' || this._flatmap.options.showId && feature !== null) {
            let header = '';
            if (this._flatmap.options.showPosition) {
                const pt = turf.point(lngLat.toArray());
                const gps = turfProjection.toMercator(pt);
                const coords = gps.geometry.coordinates;
                header = (feature === null)
                             ? JSON.stringify(coords)
                             : `${JSON.stringify(coords)} (${feature.id})`;
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

    selectionEvent_(event, feature)
    //=============================
    {
        if (feature !== undefined) {
            const clickedFeatureId = +feature.id;
            const dim = !('properties' in feature
                       && 'kind' in feature.properties
                       && ['cell-type', 'scaffold', 'tissue'].includes(feature.properties.kind));
            if (!(event.ctrlKey || event.metaKey)) {
                let selecting = true;
                for (const featureId of this._selectedFeatureIds.keys()) {
                    if (featureId === clickedFeatureId) {
                        selecting = false;
                        break;
                    }
                }
                this.unselectFeatures();
                if (selecting) {
                    for (const feature of this._activeFeatures) {
                        this.selectFeature(feature.id, dim);
                    }
                }
            } else {
                const clickedSelected = this.featureSelected_(clickedFeatureId);
                for (const feature of this._activeFeatures) {
                    if (clickedSelected) {
                        this.unselectFeature(feature.id);
                    } else {
                        this.selectFeature(feature.id, dim);
                    }
                }
            }
        }
    }

    clickEvent_(event)
    //================
    {
        if (this._modal) {
            return;
        }

        this.__clearActiveMarker();

        const clickedFeatures = this.#renderedFeatures(event.point)
        if (clickedFeatures.length == 0) {
            this.unselectFeatures();
            return;
        }
        const clickedFeature = clickedFeatures[0];
        this.selectionEvent_(event.originalEvent, clickedFeature);
        if (this._modal) {
            // Remove tooltip, reset active features, etc
            this.__resetFeatureDisplay();
            this.unselectFeatures();
            this.__clearModal();
        } else if (clickedFeature !== undefined) {
            this.__lastClickLngLat = event.lngLat;
            this.__featureEvent('click', clickedFeature);
            if ('properties' in clickedFeature && 'hyperlink' in clickedFeature.properties) {
                window.open(clickedFeature.properties.hyperlink, '_blank');
            }
        }
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

    enablePathsBySystem(system, enable=true, force=false)
    //===================================================
    {
        this.__pathManager.enablePathsBySystem(system, enable, force);
    }

    enablePathsByType(pathType, enable=true)
    //======================================
    {
        this.__pathManager.enablePathsByType(pathType, enable);
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

    enableCentrelines(enable=true, force=false)
    //=========================================
    {
        this.__pathManager.enablePathsByType('centreline', enable, force);
        this.#setPaint({showCentrelines: enable});
    }

    enableSckanPaths(sckanState, enable=true)
    //=======================================
    {
        this._layerManager.enableSckanPaths(sckanState, enable);
    }

    enableCompletenessPaths(completenessState, enable=true)
    //=======================================
    {
        this._layerManager.enableCompletenessPaths(completenessState, enable);
    }

    enableConnectivityByTaxonIds(taxonIds, enable=true)
    //=================================================
    {
        if (enable) {
            for (const taxonId of taxonIds) {
               this.__enabledConnectivityTaxons.add(taxonId);
            }
        } else {
            for (const taxonId of taxonIds) {
               this.__enabledConnectivityTaxons.delete(taxonId);
            }
        }
        this._layerManager.setFilter({taxons: [...this.__enabledConnectivityTaxons.values()]});
    }

    excludeAnnotated(exclude=false)
    //=============================
    {
        this.#setPaint({excludeAnnotated: exclude});
    }

    //==============================================================================

    // Marker handling

    __markerPosition(featureId, annotation)
    {
        if (this.__markerPositions.has(featureId)) {
            return this.__markerPositions.get(featureId);
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
        this.__markerPositions.set(featureId, position);
        return position;
    }

    addMarker(anatomicalId, options={})
    //=================================
    {
        const featureIds = this._flatmap.modelFeatureIds(anatomicalId);
        let markerId = -1;

        for (const featureId of featureIds) {
            const annotation = this._flatmap.annotation(featureId);
            if (!('markerPosition' in annotation) && !annotation.geometry.includes('Polygon')) {
                continue;
            }
            if (!('marker' in annotation)) {
                if (markerId === -1) {
                    this.__lastMarkerId += 1;
                    markerId = this.__lastMarkerId;
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
                const markerPosition = this.__markerPosition(featureId, annotation);
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
            return;
        }

        if (['mouseenter', 'mouseleave', 'click'].includes(event.type)) {
            this.__activeMarker = marker;

            // Remove any existing tooltips
            this.removeTooltip_();
            marker.setPopup(null);

            // Reset cursor
            marker.getElement().style.cursor = 'default';

            if (['mouseenter', 'click'].includes(event.type)) {
                const markerId = this.__markerIdByMarker.get(marker);
                const annotation = this.__annotationByMarkerId.get(markerId);
                // The marker's feature
                const feature = this.mapFeature(annotation.featureId);
                if (feature !== undefined) {
                    if (event.type === 'mouseenter') {
                        // Highlight on mouse enter
                        this.resetActiveFeatures_();
                        this.activateFeature(feature);
                    } else {
                        this.selectionEvent_(event, feature)
                    }
                }
                // Show tooltip
                const html = this.tooltipHtml_(annotation, true);
                this.__showToolTip(html, marker.getLngLat());

                // Send marker event message
                this._flatmap.markerEvent(event.type, markerId, anatomicalId);
            }
        }
        event.stopPropagation();
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

        // Set the merker tooltip and show it
        marker.setPopup(this._tooltip);
        marker.togglePopup();

        return true;
    }

    enablePanZoomEvents(enabled=true)
    //===============================
    {
        this.__pan_zoom_enabled = enabled;
    }

    panZoomEvent_(type)
    //=================
    {
        if (this.__pan_zoom_enabled) {
            this._flatmap.panZoomEvent(type);
        }
    }
}

//==============================================================================
