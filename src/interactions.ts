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
import maplibregl from 'maplibre-gl'

//import {default as turfArea} from '@turf/area'
import {default as turfAlong} from '@turf/along'
import {default as turfBBox} from '@turf/bbox'
import * as turf from '@turf/helpers'
import * as turfCleanCoords from "@turf/clean-coords"
import * as turfNearestPointOnLine from "@turf/nearest-point-on-line"
import * as turfProjection from '@turf/projection'

import polylabel from 'polylabel'

//==============================================================================

import {PropertiesFilter} from './filters'
import {NerveCentreFacet} from './filters/facets/nerve'
import {PathTypeFacet} from './filters/facets/pathtype'
import {TaxonFacet} from './filters/facets/taxon'
import {PropertiesFilterExpression} from './filters'
import {AnnotatedFeature, AnnotationDrawMode, AnnotationEvent,
        FlatMapFeature, FlatMapFeatureAnnotation,
        FlatMapMarkerOptions, FlatMapPopUpOptions, FlatMapState, MapFeature,
        MapFeatureIdentifier, MapPointFeature, MapRenderedFeature} from './flatmap-types'
import type {BoundingBox, DatasetTerms, FeatureZoomOptions, GeoJSONId} from './flatmap-types'
import type {Point2D} from './flatmap-types'
import {FlatMap, FLATMAP_STYLE} from './flatmap'
import {isMarker, LayerManager} from './layers'
import {VECTOR_TILES_SOURCE} from './layers/styling'
import {MARKER_DEFAULT_COLOUR} from './markers'
import {latex2Svg} from './mathjax'
import {NerveCentrelineDetails} from './pathways'
import {PathManager} from './pathways'
import {SystemsManager} from './systems'

import {displayedProperties, InfoControl} from './controls/info'
import {AnnotatorControl, BackgroundControl, ClosePaneControl, LayerControl, NavigationControl, SCKANControl} from './controls/controls'
import {AnnotationDrawControl, DRAW_ANNOTATION_LAYERS} from './controls/annotation'
import {NerveCentrelineControl} from './controls/nerves'
import {PathControl} from './controls/paths'
import {FlightPathControl} from './controls/flightpaths'
import {SearchControl} from './controls/search'
import {MinimapControl, MINIMAP_OPTIONS} from './controls/minimap'
import {SystemsControl} from './controls/systems'
import {TaxonsControl} from './controls/taxons'

import * as utils from './utils'

//==============================================================================
/*
{
    children?: number[]
}
*/

//==============================================================================

// FUTURE
// smallest `group` features when zoom < SHOW_DETAILS_ZOOM if there are some, otherwise smallest feature
// if no non-group features then smallest group one

//export const SHOW_DETAILS_ZOOM = 6

//==============================================================================

function featureBounds(feature: MapRenderedFeature): BoundingBox
//==============================================================
{
    // Find the feature's bounding box

    const bounds = ('bounds' in feature.properties) ? feature.properties.bounds
                                                    : feature.properties.bbox
    if (bounds) {
        // Bounding box is defined in GeoJSON

        return JSON.parse(bounds)
    } else if (feature.geometry.type === 'Polygon') {
        // Get the bounding box of the current polygon. This won't neccessary
        // be the full feature because of tiling

        const polygon = turf.geometry(feature.geometry.type, feature.geometry.coordinates)
        return turfBBox(polygon) as BoundingBox
    }
    return [0, 0, 0, 0]
}

//==============================================================================

function expandBounds(bbox1:BoundingBox|null, bbox2:BoundingBox|null, _pad: number=0): BoundingBox|null
//=====================================================================================================
{
    if (bbox1 === null) {
        if (bbox2 === null) {
            return null
        } else {
            return [...bbox2]
        }
    } else if (bbox2 === null) {
        return [...bbox1]
    } else {
        return [Math.min(bbox1[0], bbox2[0]), Math.min(bbox1[1], bbox2[1]),
                Math.max(bbox1[2], bbox2[2]), Math.max(bbox1[3], bbox2[3])]
    }
}

//==============================================================================

function labelPosition(feature: FlatMapFeature|GeoJSON.Feature): [number, number]
{
    let coords: number[] = [0, 0]
    if (feature.geometry!.type === 'Point') {
        coords = feature.geometry!.coordinates
    } else if (feature.geometry!.type === 'Polygon') {
        const polygon = feature.geometry!.coordinates
        // Rough heuristic. Area is in km^2; below appears to be good enough.
        const precision = ('area' in feature.properties!)
                            ? Math.sqrt(feature.properties.area)/500000
                            : 0.1
        coords = polylabel(polygon, precision)
    }
    return [coords[0], coords[1]]
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
        properties.renderedLabel = uppercaseLabel.replaceAll(/\$([^$]*)\$/g, math => latex2Svg(math.slice(1, -1)))
    }
    return properties.renderedLabel
}

//==============================================================================

export class UserInteractions
{
    #activeFeatures: Map<GeoJSONId, MapFeature> = new Map()
    #activeMarker: maplibregl.Marker|null = null
    #annotationByMarkerId = new Map()
    #annotationDrawControl: AnnotationDrawControl|null = null
    #closeControl: ClosePaneControl|null = null
    #colourOptions
    #currentPopup: maplibregl.Popup|null = null
    #featureEnabledCount: Map<GeoJSONId, number>
    #featureIdToMapId: Map<string, GeoJSONId>
    #flatmap: FlatMap
    #imageLayerIds = new Map()
    #infoControl: InfoControl|null = null
    #lastClickLngLat: maplibregl.LngLat|null = null
    #lastFeatureMouseEntered: number|null = null
    #lastFeatureModelsMouse: string|null = null
    #lastImageId: number = 0
    #lastMarkerId: number = 900000
    #layerManager: LayerManager
    #map: maplibregl.Map
    #markerIdByFeatureId = new Map()
    #markerIdByMarker: Map<maplibregl.Marker, number> = new Map()
    #markerPositions: Map<number, [number, number]> = new Map() // Where to put labels and popups on a feature
    #minimap: MinimapControl|null = null
    #modal: boolean = false
    #nerveCentrelineFacet: NerveCentreFacet
    #pan_zoom_enabled: boolean = false
    #pathManager: PathManager
    #pathTypeFacet: PathTypeFacet
    #selectedFeatureRefCount = new Map()
    #systemsManager: SystemsManager
    #taxonFacet: TaxonFacet
    #tooltip: maplibregl.Popup|null = null
    #resetOnClickEnabled: boolean = true

    constructor(flatmap: FlatMap)
    {
        this.#flatmap = flatmap
        this.#map = flatmap.map!

        // Default colour settings
        this.#colourOptions = {coloured: true, outlined: true}

        // Track enabled features

        this.#featureEnabledCount = new Map(Array.from(this.#flatmap.annotations.keys()).map(k => [k, 0]))

        const featuresEnabled = flatmap.options.style !== FLATMAP_STYLE.FUNCTIONAL

        const tooltipDelay = flatmap.options.tooltipDelay || 0

        // Path visibility is either controlled externally or by a local control
        // FC path visiblitity is determined by system visiblity

        this.#pathManager = new PathManager(flatmap, this)

        // The path types in this map

        const mapPathTypes = this.#pathManager.pathTypes()

        // Add and manage our layers. NB. This needs to be done after we
        // have a path manager but before paths are enabled

        this.#layerManager = new LayerManager(flatmap, this)

        // Set initial enabled state of paths
        this.#pathManager.enablePathLines(true, true)

        this.#pathTypeFacet = new PathTypeFacet(mapPathTypes)
        this.#layerManager.addFilteredFacet(this.#pathTypeFacet)

        this.#nerveCentrelineFacet = new NerveCentreFacet(this.#pathManager.nerveCentrelineDetails)
        this.#layerManager.addFilteredFacet(this.#nerveCentrelineFacet)

        // Note features that are FC systems
        this.#systemsManager = new SystemsManager(this.#flatmap, this, featuresEnabled)

        // All taxons of connectivity paths are enabled by default
        this.#taxonFacet = new TaxonFacet(this.#flatmap.taxonIdentifiers)
        this.#layerManager.addFilteredFacet(this.#taxonFacet)

        // Add a minimap if option set
        if (flatmap.options.minimap) {
            const options: MINIMAP_OPTIONS = (typeof flatmap.options.minimap === 'object')
                                           ? flatmap.options.minimap : {}
            this.#minimap = new MinimapControl(flatmap, options,
                this.#layerManager.minimapStyleSpecification)
            this.#map.addControl(this.#minimap)
        }

        // Do we want a fullscreen control?
        if (flatmap.options.fullscreenControl === true) {
            this.#map.addControl(new maplibregl.FullscreenControl(), 'top-right')
        }

        // Add navigation controls if option set
        if (flatmap.options.navigationControl) {
            const value = flatmap.options.navigationControl
            const position = ((typeof value === 'string')
                           && ['top-left', 'top-right', 'bottom-right', 'bottom-left'].includes(value))
                           ? value : 'bottom-right'
            this.#map.addControl(new NavigationControl(flatmap), <maplibregl.ControlPosition>position)
        }

        // Optionally add a close pane control

        if (flatmap.options.addCloseControl) {
            this.addCloseControl()
        }

        // Add various controls when running standalone
        if (flatmap.options.standalone) {
            // Add a control to search annotations if option set
            this.#map.addControl(new SearchControl(flatmap))

            // Control background colour (NB. this depends on having map layers created)
            this.#map.addControl(new BackgroundControl(flatmap))

            // Remaining controls only show if we want all of them

            if (flatmap.options.allControls) {

                // Show information about features
                this.#infoControl = new InfoControl(flatmap)
                this.#map.addControl(this.#infoControl)

                // Add a control to manage our paths
                this.#map.addControl(new PathControl(flatmap, mapPathTypes))

                // Add a control for nerve centrelines if they are present
                if (flatmap.options.style === FLATMAP_STYLE.ANATOMICAL && this.#pathManager.haveCentrelines) {
                    this.#map.addControl(new NerveCentrelineControl(flatmap, this))
                }

                if (flatmap.options.style === FLATMAP_STYLE.FUNCTIONAL) {
                    // SCKAN path and SYSTEMS controls for FC maps
                    this.#map.addControl(new SystemsControl(flatmap, this.#systemsManager.systems))
                    this.#map.addControl(new SCKANControl(flatmap, flatmap.options.layerOptions))
                } else {
                    // Connectivity taxon control for AC maps
                    this.#map.addControl(new TaxonsControl(flatmap))
                }

                if (flatmap.has_flightpaths) {
                    this.#map.addControl(new FlightPathControl(flatmap, !!flatmap.options.flightPaths))
                }

                if (flatmap.options.annotator) {
                    this.#map.addControl(new AnnotatorControl(flatmap))
                }

                // Add a control to control layer visibility
                this.#map.addControl(new LayerControl(flatmap, this.#layerManager))
            }
        }

        // Initialise map annotation
        this.#setupAnnotation()

        // Add an initially hidden tool for drawing on the map.
        this.#annotationDrawControl = new AnnotationDrawControl(flatmap, false)
        this.#map.addControl(this.#annotationDrawControl)

        // Set initial path viewing mode
        if (flatmap.options.flightPaths === true) {
            this.#layerManager.setFlightPathMode(true)
        }

        // Handle mouse events

        const handleMouseMoveEvent = this.#mouseMoveEvent.bind(this)
        this.#map.on('click', this.#clickEvent.bind(this))
        this.#map.on('dblclick', event => {
            const clickedFeatures = this.#layerManager.featuresAtPoint(event.point)
            for (const feature of clickedFeatures) {
                if (feature.properties && feature.properties.kind === 'expandable'
                 && this.#map.getZoom() > (feature.properties.maxzoom - 2)
                 && 'geometry' in feature) {
                    event.preventDefault()
                    this.#map.fitBounds(featureBounds(feature), {
                        padding: 0,
                        animate: false
                    })
                    break
                }
            }
        })
        this.#map.on('touchend', this.#clickEvent.bind(this))
        this.#map.on('mousemove', utils.delay(handleMouseMoveEvent, tooltipDelay))

        // Handle pan/zoom events
        this.#map.on('move', this.#panZoomEvent.bind(this, 'pan'))
        this.#map.on('zoom', this.#panZoomEvent.bind(this, 'zoom'))
    }

    get minimap()
    //===========
    {
        return this.#minimap
    }

    get pathManager()
    //===============
    {
        return this.#pathManager
    }

    addCloseControl()
    //===============
    {
        if (this.#closeControl === null) {
            this.#closeControl = new ClosePaneControl(this.#flatmap)
            this.#map.addControl(this.#closeControl)
        }
    }

    removeCloseControl()
    //==================
    {
        if (this.#closeControl) {
            this.#map.removeControl(this.#closeControl)
            this.#closeControl = null
        }
    }

    getState(): FlatMapState
    //======================
    {
        // Return the map's centre, zoom, bearing and pitch
        // Can only be called when the map is fully loaded
        return {
            center: this.#map.getCenter().toArray(),
            zoom: this.#map.getZoom(),
            bearing: this.#map.getBearing(),
            pitch: this.#map.getPitch()
        }
    }

    setState(state)
    //=============
    {
        // Restore the map to a saved state

        const options = Object.assign({}, state)
        if ('zoom' in options) {
            if ('center' in options) {
                options['around'] = options.center
            } else {
                options['around'] = [0, 0]
            }
        }
        if (Object.keys(options).length > 0) {
            this.#map.jumpTo(options)
        }
    }

    showAnnotator(visible=true)
    //=========================
    {
        if (this.#annotationDrawControl) {
            this.#annotationDrawControl.show(visible)
        }
    }

    commitAnnotationEvent(event: AnnotationEvent)
    //===========================================
    {
        if (this.#annotationDrawControl) {
            this.#annotationDrawControl.commitEvent(event)
        }
    }

    abortAnnotationEvent(event: AnnotationEvent)
    //==========================================
    {
        if (this.#annotationDrawControl) {
            this.#annotationDrawControl.abortEvent(event)
        }
    }

    rollbackAnnotationEvent(event: AnnotationEvent)
    //=============================================
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

    addAnnotationFeature(feature: AnnotatedFeature)
    //=============================================
    {
        if (this.#annotationDrawControl) {
            this.#annotationDrawControl.addFeature(feature)
        }
    }

    refreshAnnotationFeatureGeometry(feature: AnnotatedFeature)
    //=========================================================
    {
        if (this.#annotationDrawControl) {
            return this.#annotationDrawControl.refreshGeometry(feature)
        }
    }

    changeAnnotationDrawMode(mode: AnnotationDrawMode)
    //================================================
    {
        if (this.#annotationDrawControl) {
            this.#annotationDrawControl.changeMode(mode)
        }
    }

    #setupAnnotation()
    //================
    {
        // Relate external annotation identifiers to map (GeoJSON) ids
        this.#featureIdToMapId = new Map([...this.#flatmap.annotations.entries()]
                                                 .map(idAnn => [idAnn[1].id!, idAnn[0]]))
        // Flag features that have annotations
        for (const mapId of this.#featureIdToMapId.values()) {
            const feature = this.mapFeature(mapId)
            if (feature) {
                this.#map.setFeatureState(feature, { 'map-annotation': true })
            }
        }
    }

    setFeatureAnnotated(featureId: string)
    //====================================
    {
        // External feature id to map's GeoJSON id
        const mapId = this.#featureIdToMapId.get(featureId)
        if (mapId) {
            const feature = this.mapFeature(mapId)
            if (feature) {
                this.#map.setFeatureState(feature, { 'annotated': true })
            }
        }
    }

    #setPaint(options)
    //================
    {
        this.#layerManager.setPaint(options)
    }

    setPaint(options)
    //===============
    {
        this.#colourOptions = options
        this.#setPaint(options)
    }

    getLayers()
    //=========
    {
        return this.#layerManager.layers
    }

    enableLayer(layerId: string, enable=true)
    //=======================================
    {
        this.#layerManager.activate(layerId, enable)
    }

    enableFlightPaths(enable=true)
    //============================
    {
        this.#layerManager.setFlightPathMode(enable)
    }

    getSystems()
    //==========
    {
        return this.#systemsManager.systems
    }

    enableSystem(systemId: string, enable=true)
    //=========================================
    {
        this.#systemsManager.enable(systemId, enable)
    }

    mapFeatureFromAnnotation(annotation: FlatMapFeatureAnnotation|null): MapFeature|null
    //==================================================================================
    {
        if (annotation) {
            return {
                id: annotation.featureId,
                source: VECTOR_TILES_SOURCE,
                sourceLayer: (this.#flatmap.options.separateLayers
                             ? `${annotation['layer']}_${annotation['tile-layer']}`
                             : annotation['tile-layer']).replaceAll('/', '_'),
                children: annotation.children || [],
                properties: {}
            }
        }
        return null
    }

    mapFeature(geojsonId: GeoJSONId): MapFeature|null
    //===============================================
    {
        return this.mapFeatureFromAnnotation(this.#flatmap.annotation(geojsonId))
    }

    #markerToFeature(feature: MapFeature|MapRenderedFeature): MapFeature|null
    //=======================================================================
    {
        if (isMarker(feature)) {
            return this.mapFeature(feature.properties!.featureId || -1)
        }
        return feature
    }

    #getFeatureState(feature: MapFeature|MapRenderedFeature)
    //======================================================
    {
        const mapFeature = this.#markerToFeature(feature)
        if (mapFeature) {
            return this.#map.getFeatureState(mapFeature)
        }
    }


    getFeatureState(featureId: GeoJSONId)
    //===================================
    {
        const feature = this.mapFeature(featureId)
        if (feature) {
            const state = this.#map.getFeatureState(feature)
            if (Object.keys(state).length) {
                return state
            }
        }
        return null
    }

    #removeFeatureState(feature: MapFeature|MapRenderedFeature, key: string)
    //======================================================================
    {
        const mapFeature = this.#markerToFeature(feature)
        if (mapFeature) {
            this.#map.removeFeatureState(mapFeature, key)
        }
        this.#layerManager.removeFeatureState(+feature.id!, key)
    }

    #setFeatureState(feature: MapFeature|MapRenderedFeature, state)
    //=============================================================
    {
        const mapFeature = this.#markerToFeature(feature)
        if (mapFeature) {
            this.#map.setFeatureState(mapFeature, state)
        }
        this.#layerManager.setFeatureState(+feature.id!, state)
    }

    enableMapFeature(feature: MapFeature|null, enable=true)
    //=====================================================
    {
        if (feature) {
            const state = this.#getFeatureState(feature)
            if  ('hidden' in state) {
                if (enable) {
                    this.#removeFeatureState(feature, 'hidden')
                } else if (!state.hidden) {
                    this.#setFeatureState(feature, { hidden: true })
                }
            } else if (!enable) {
                this.#setFeatureState(feature, { hidden: true })
            }
            this.#enableFeatureMarker(+feature.id!, enable)
        }
    }

    enableFeature(featureId: GeoJSONId, enable=true, force=false)
    //===========================================================
    {
        const enabledCount = this.#featureEnabledCount.get(+featureId) || 0
        if (force || enable && enabledCount === 0 || !enable && enabledCount == 1) {
            this.enableMapFeature(this.mapFeature(+featureId), enable)
        }
        if (force) {
            this.#featureEnabledCount.set(featureId, enable ? 1 : 0)
        } else {
            this.#featureEnabledCount.set(featureId, enabledCount + (enable ? 1 : -1))
        }
    }

    enableFeatureWithChildren(featureId: GeoJSONId, enable=true, force=false)
    //=======================================================================
    {
        const feature = this.mapFeature(featureId)
        if (feature) {
            this.enableFeature(featureId, enable, force)
            for (const childFeatureId of feature.children || []) {
                this.enableFeatureWithChildren(childFeatureId, enable, force)
            }
        }
    }

    #enableFeatureMarker(featureId: GeoJSONId, enable=true)
    //=====================================================
    {
        const markerId = this.#markerIdByFeatureId.get(featureId)
        if (markerId) {
            const markerDiv = document.getElementById(`marker-${markerId}`)
            if (markerDiv) {
                markerDiv.style.visibility = enable ? 'visible' : 'hidden'
            }
        }
    }

    #featureEnabled(feature: MapFeatureIdentifier|null): boolean
    //==========================================================
    {
        if (feature === null) {
            return false
        } else if (feature.id) {
            const state = this.#getFeatureState(feature)
            return (state
                && !(state.hidden || false)
                && !(state.invisible || false))
        }
        return DRAW_ANNOTATION_LAYERS.includes(feature.layer!.id)
    }

    #featureSelected(featureId: GeoJSONId): boolean
    //=============================================
    {
        return this.#selectedFeatureRefCount.has(+featureId)
    }

    selectFeature(featureId: GeoJSONId, dim=true)
    //===========================================
    {
        const ann = this.#flatmap.annotation(featureId)
        if (ann && 'sckan' in ann) {
            const sckanState = this.#layerManager.sckanState
            if (sckanState === 'none'
             || sckanState === 'valid' && !ann.sckan
             || sckanState === 'invalid' && ann.sckan) {
                return false
            }
        }
        featureId = +featureId;   // Ensure numeric
        let result = false
        const noSelection = (this.#selectedFeatureRefCount.size === 0)
        if (this.#selectedFeatureRefCount.has(featureId)) {
            this.#selectedFeatureRefCount.set(featureId, this.#selectedFeatureRefCount.get(featureId) + 1)
            result = true
        } else {
            const feature = this.mapFeature(featureId)
            if (feature) {
                const state = this.#getFeatureState(feature)
                if (state && (!('hidden' in state) || !state.hidden)) {
                    this.#setFeatureState(feature, { selected: true })
                    this.#selectedFeatureRefCount.set(featureId, 1)
                    result = true
                }
            }
        }
        if (result && noSelection) {
            this.#setPaint({...this.#colourOptions, dimmed: dim})
        }
        return result
    }

    unselectFeature(featureId: GeoJSONId)
    //===================================
    {
        featureId = +featureId;   // Ensure numeric
        if (this.#selectedFeatureRefCount.has(+featureId)) {
            const refCount = this.#selectedFeatureRefCount.get(featureId)
            if (refCount > 1) {
                this.#selectedFeatureRefCount.set(+featureId, refCount - 1)
            } else {
                const feature = this.mapFeature(+featureId)
                if (feature) {
                    this.#removeFeatureState(feature, 'selected')
                    this.#selectedFeatureRefCount.delete(+featureId)
                }
            }
        }
        if (this.#selectedFeatureRefCount.size === 0) {
            this.#setPaint({...this.#colourOptions, dimmed: false})
        }
    }

    unselectFeatures()
    //================
    {
        for (const featureId of this.#selectedFeatureRefCount.keys()) {
            const feature = this.mapFeature(featureId)
            if (feature) {
                this.#removeFeatureState(feature, 'selected')
            }
        }
        this.#selectedFeatureRefCount.clear()
        this.#setPaint({...this.#colourOptions, dimmed: false})
    }

    activateFeature(feature: MapFeature|MapRenderedFeature|null)
    //==========================================================
    {
        if (feature) {
            this.#setFeatureState(feature, { active: true })
            if (!this.#activeFeatures.has(+feature.id!)) {
                this.#activeFeatures.set(+feature.id!, feature)
            }
        }
    }

    activateLineFeatures(lineFeatures: MapPointFeature[])
    //===================================================
    {
        for (const lineFeature of lineFeatures) {
            this.activateFeature(lineFeature)
            const lineIds: Set<GeoJSONId> = new Set(lineFeatures.map(f => f.properties.featureId))
            for (const featureId of this.#pathManager.lineFeatureIds(lineIds)) {
                this.activateFeature(this.mapFeature(featureId))
            }
        }
    }

    #resetActiveFeatures()
    //====================
    {
        for (const feature of this.#activeFeatures.values()) {
            this.#removeFeatureState(feature, 'active')
        }
        this.#activeFeatures.clear()
    }

    /* UNUSED
    #smallestAnnotatedPolygonFeature(features)
    //========================================
    {
        // Get the smallest feature from a list of features

        let smallestArea = 0
        let smallestFeature = null
        for (const feature of features) {
            if (feature.geometry.type.includes('Polygon')
             && this.#getFeatureState(feature)['map-annotation']) {
                const polygon = turf.geometry(feature.geometry.type, feature.geometry.coordinates)
                const area = turfArea(polygon)
                if (smallestFeature === null || smallestArea > area) {
                    smallestFeature = feature
                    smallestArea = area
                }
            }
        }
        return smallestFeature
    }
    */

    #setModal()
    //=========
    {
        this.#modal = true
    }

    #clearModal()
    //===========
    {
        this.#modal = false
    }

    reset()
    //=====
    {
        this.#clearModal()
        this.#clearActiveMarker()
        this.unselectFeatures()
    }

    clearSearchResults(_reset=true)
    //=============================
    {
        this.unselectFeatures()
    }

    /**
     * Select features on the map.
     *
     * @param  featureIds  An array of feature identifiers to highlight
     */
    selectFeatures(featureIds: GeoJSONId[])
    //=====================================
    {
        if (featureIds.length) {
            this.unselectFeatures()
            for (const featureId of featureIds) {
                const annotation = this.#flatmap.annotation(featureId)
                if (annotation) {
                    if (this.selectFeature(featureId)) {
                        if ('type' in annotation && annotation.type!.startsWith('line')) {
                            for (const pathFeatureId of this.#pathManager.lineFeatureIds([+featureId])) {
                                this.selectFeature(pathFeatureId)
                            }
                        }
                    }
                }
            }
        }
    }

    showSearchResults(featureIds: GeoJSONId[])
    //========================================
    {
        this.unselectFeatures()
        this.zoomToFeatures(featureIds, {zoomIn: false})
    }

    zoomToFeatures(featureIds: GeoJSONId[], options: FeatureZoomOptions)
    //==================================================================
    {
        options = utils.setDefaults(options, {
            zoomIn: false
        })
        if (featureIds.length) {
            this.unselectFeatures()
            let bbox: BoundingBox|null = null
            if (!options.zoomIn) {
                const bounds = this.#map.getBounds().toArray()
                bbox = [...bounds[0], ...bounds[1]]
            }
            for (const featureId of featureIds) {
                const annotation = this.#flatmap.annotation(featureId)
                if (annotation) {
                    if (this.selectFeature(featureId)) {
                        bbox = expandBounds(bbox, annotation.bounds||null)
                        if ('type' in annotation && annotation.type!.startsWith('line')) {
                            for (const pathFeatureId of this.#pathManager.lineFeatureIds([+featureId])) {
                                if (this.selectFeature(pathFeatureId)) {
                                    const pathAnnotation = this.#flatmap.annotation(pathFeatureId)
                                    if (pathAnnotation) {
                                        bbox = expandBounds(bbox, pathAnnotation.bounds||null)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if (bbox !== null) {
                this.#map.fitBounds(bbox, {
                    padding: 0,
                    animate: false
                })
            }
        }
    }

    showPopup(featureId: GeoJSONId, content: string, options: FlatMapPopUpOptions={})
    //===============================================================================
    {
        const ann = this.#flatmap.annotation(featureId)!
        const drawn = !!options.annotationFeatureGeometry
        if (ann || drawn) {  // The feature exists or it is a drawn annotation

            // Remove any existing popup

            if (this.#currentPopup) {
                if (options && options.preserveSelection) {
                    this.#currentPopup.options['preserveSelection'] = options.preserveSelection
                }
                this.#currentPopup.remove()
            }

            // Clear selection if we are not preserving it

            if (options && options.preserveSelection) {
                delete options.preserveSelection;       // Don't pass to onClose()
            } else {                                    // via the popup's options
                this.unselectFeatures()
            }

            // Select the feature

            this.selectFeature(featureId)

            // Find the pop-up's postion

            let location: maplibregl.LngLatLike
            if ('positionAtLastClick' in options
               && options.positionAtLastClick
               && this.#lastClickLngLat !== null) {
                location = this.#lastClickLngLat
            } else if (drawn) {
                // Popup at the centroid of the feature
                // Calculated with the feature geometry coordinates
                location = options.annotationFeatureGeometry!
            } else {
                // Position popup at the feature's 'centre'
                location = this.markerPosition(ann)!
            }

            // Make sure the feature is on screen

            if (!this.#map.getBounds().contains(location)) {
                this.#map.panTo(location)
            }
            this.#setModal()
            this.#currentPopup = new maplibregl.Popup(options).addTo(this.#map)
            this.#currentPopup.on('close', this.#onCloseCurrentPopup.bind(this))
            if (drawn) {
                // If annotationEvent is not provided, create a fallback with available geometry
                const fallbackAnnotationEvent: AnnotationEvent = {
                    type: 'created',
                    feature: {
                        id: featureId,
                        geometry: {
                            type: 'Point',
                            coordinates: options.annotationFeatureGeometry!
                        } as GeoJSON.Point,
                    } as AnnotatedFeature
                }
                const annotationEvent: AnnotationEvent = options.annotationEvent || fallbackAnnotationEvent;
                this.#currentPopup.on('close', () => this.abortAnnotationEvent(annotationEvent))
            }
            this.#currentPopup.setLngLat(location)
            if (typeof content === 'object') {
                this.#currentPopup.setDOMContent(content)
            } else {
                this.#currentPopup.setText(content)
            }
        }
    }

    #onCloseCurrentPopup()
    //====================
    {
        if (this.#currentPopup) {
            this.#clearModal()
            if (!(this.#currentPopup.options && this.#currentPopup.options['preserveSelection'])) {
                this.unselectFeatures()
            }
            this.#currentPopup = null
        }
    }

    #removeTooltip()
    //==============
    {
        if (this.#tooltip) {
            this.#tooltip.remove()
            this.#tooltip = null
        }
    }

    /**
     * Remove the currently active popup from the map.
     */
    removePopup()
    //===========
    {
        if (this.#currentPopup) {
            this.#currentPopup.remove()
            this.#currentPopup = null
        }
    }

    #lineTooltip(lineFeatures: MapPointFeature[])
    //===========================================
    {
        const tooltips: string[] = []
        for (const lineFeature of lineFeatures) {
            const properties = lineFeature.properties
            if ('error' in properties) {
                tooltips.push(`<div class="feature-error">Error: ${properties.error}</div>`)
            }
            if ('warning' in properties) {
                tooltips.push(`<div class="feature-error">Warning: ${properties.warning}</div>`)
            }
            if ('label' in properties && (!('tooltip' in properties) || properties.tooltip)) {
                const label = properties.label
                const cleanLabel = (label.substr(0, 1).toUpperCase() + label.substr(1)).replaceAll("\n", "<br/>")
                if (!tooltips.includes(cleanLabel)) {
                    tooltips.push(cleanLabel)
                }
            }
        }
        return (tooltips.length === 0) ? ''
                                       : `<div class='flatmap-feature-label'>${tooltips.join('<hr/>')}</div>`
    }

    #tooltipHtml(properties, forceLabel=false)
    //========================================
    {
        const tooltip: string[] = []
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
            const renderedLabel = getRenderedLabel(properties)
            if ('hyperlink' in properties) {
                if (renderedLabel === '') {
                    tooltip.push(`<a href='${properties.hyperlink}'>${properties.hyperlink}</a>`)
                } else {
                    tooltip.push(`<a href='${properties.hyperlink}'>${renderedLabel}</a></div>`)
                }
            } else {
                tooltip.push(renderedLabel)
            }
        }
        return (tooltip.length === 0) ? ''
                                      : `<div class='flatmap-feature-label'>${tooltip.join('<hr/>')}</div>`
    }

    #featureEvent(type: string, feature: MapPointFeature, values={})
    //==============================================================
    {
        let properties: FlatMapFeatureAnnotation
        if (isMarker(feature)) {
            const markerProperties: object = Object.assign({}, feature.properties, values)
            const markerTerm = markerProperties['models']
            markerProperties['marker-terms'] = this.#layerManager.markerTerms(markerTerm)
            return this.#flatmap.markerEvent(type, +feature.id!, markerProperties as FlatMapFeatureAnnotation)
        } else if ('properties' in feature) {
            properties = Object.assign({}, feature.properties, values) as FlatMapFeatureAnnotation
            return this.#flatmap.featureEvent(type, properties)
        }
        return false
    }

    #multiFeatureEvent(type: string, featureProperties: FlatMapFeatureAnnotation[])
    //=============================================================================
    {
        return this.#flatmap.featureEvent(type, featureProperties)
    }

    #resetFeatureDisplay()
    //====================
    {
        // Remove any existing tooltip
        this.#removeTooltip()

        // Reset cursor
        this.#map.getCanvas().style.cursor = 'default'

        // Reset any active features
        this.#resetActiveFeatures()
    }

    #renderedFeatures(point: [number, number]): MapPointFeature[]
    //===========================================================
    {
        const features = this.#layerManager.featuresAtPoint(point)
        return features.filter(feature => this.#featureEnabled(feature))
    }

    #mouseMoveEvent(event)
    //====================
    {
        this.#updateActiveFeature(event.point, event.lngLat)
    }

    #updateActiveFeature(eventPoint: [number, number], lngLat: maplibregl.LngLat|null=null)
    //=====================================================================================
    {
        // No tooltip when context menu is open
        if (this.#modal) {
            return
        }

        // Remove tooltip, reset active features, etc
        this.#resetFeatureDisplay()

        // Reset any info display
        const displayInfo = (this.#infoControl && this.#infoControl.active)
        if (displayInfo) {
            this.#infoControl!.reset()
        }

        // Get all the features at the current point
        const features = this.#renderedFeatures(eventPoint)
        if (features.length === 0) {
            this.#lastFeatureMouseEntered = null
            this.#lastFeatureModelsMouse = null
            return
        }

        // Simulate `mouseenter` events on features

        const feature = features[0]
        const featureId: number = isMarker(feature) ? +feature.id!
                                                                    : +feature.properties.featureId!
        const featureModels = ('properties' in feature && 'models' in feature.properties)
                            ? feature.properties.models
                            : null
        if (this.#lastFeatureMouseEntered !== featureId
         && (this.#lastFeatureModelsMouse === null
          || this.#lastFeatureModelsMouse !== featureModels)) {
            if (this.#featureEvent('mouseenter', feature,
                                    this.#locationOnLine(+featureId, lngLat))) {
                this.#lastFeatureMouseEntered = featureId
                this.#lastFeatureModelsMouse = featureModels
            } else {
                this.#lastFeatureMouseEntered = null
                this.#lastFeatureModelsMouse = null
            }
        } else if (this.#flatmap.options.style === FLATMAP_STYLE.CENTRELINE
                && feature.properties.centreline) {
            if (this.#lastFeatureMouseEntered === featureId) {
                const location = this.#locationOnLine(+featureId, lngLat)
                if ('location' in location) {
                    this.#featureEvent('mousemove', feature, location)
                }
            }
        }

        let info = ''
        let tooltip = ''
        let tooltipFeature: MapPointFeature|null = null
        const eventLngLat = this.#map.unproject(eventPoint)
        if (displayInfo) {
            if (!('tooltip' in features[0].properties)) {
                this.activateFeature(feature as MapFeature)
            }
            info = this.#infoControl!.featureInformation(features, eventLngLat)
        } else if (this.#flatmap.options.showId) {
            this.activateFeature(feature)
            tooltipFeature = feature
        }
        const lineFeatures = features.filter(feature => ('centreline' in feature.properties
                                                      || ('type' in feature.properties
                                                        && feature.properties.type.startsWith('line')) ))
        if (lineFeatures.length > 0) {
            tooltip = this.#lineTooltip(lineFeatures)
            tooltipFeature = lineFeatures[0]
            this.activateLineFeatures(lineFeatures)
        } else {
            const topSourceLayer = feature.sourceLayer
            let labelledFeatures = features.filter(feature => (feature.sourceLayer === topSourceLayer
                                                         && ('hyperlink' in feature.properties
                                                          || 'label' in feature.properties
                                                          || 'user_label' in feature.properties
                                                          || this.#flatmap.options.showId && 'id' in feature.properties
                                                            )
                                                         && (!('tooltip' in feature.properties)
                                                            || feature.properties.tooltip)))
                                           .sort((a, b) => (a.properties.area - b.properties.area))
            if (labelledFeatures.length > 0) {
                // Favour group features at low zoom levels
                const zoomLevel = this.#map.getZoom()
                const groupFeatures = labelledFeatures.filter(feature => (feature.properties.group
                                                     && zoomLevel < (feature.properties.scale + 1)))
                if (groupFeatures.length > 0) {
                    labelledFeatures = groupFeatures
                }
                const feature = labelledFeatures[0]
                if (feature.properties.user_drawn) {
                    feature.id = feature.properties.id
                }
                tooltip = this.#tooltipHtml(feature.properties)
                tooltipFeature = feature
                if (this.#flatmap.options.debug) {  // Do this when Info on and not debug??
                    const debugProperties = [
                        'featureId',
                        'nerveId',
                        'tile-layer',
                        'type',
                        ...displayedProperties
                    ]
                    const htmlList: string[] = []
                    const featureIds: number[] = []
                    for (const feature of labelledFeatures) {
                        if (!featureIds.includes(+feature.id!)) {
                            featureIds.push(+feature.id!)
                            for (const prop of debugProperties) {
                                if (prop in feature.properties) {
                                    htmlList.push(`<span class="info-name">${prop}:</span>`)
                                    htmlList.push(`<span class="info-value">${feature.properties[prop]}</span>`)
                                }
                            }
                        }
                        //htmlList.push(`<span class="info-name">Area:</span>`)
                        //htmlList.push(`<span class="info-value">${feature.properties.area/1000000000}</span>`)
                        //htmlList.push(`<span class="info-name">Scale:</span>`)
                        //htmlList.push(`<span class="info-value">${feature.properties.scale}</span>`)
                    }
                    if (!this.#flatmap.options.debug) {
                        info = `<div id="info-control-info">${htmlList.join('\n')}</div>`
                    }
                }
                this.activateFeature(feature)
                this.#activateRelatedFeatures(feature)
                if ('hyperlink' in feature.properties) {
                    this.#map.getCanvas().style.cursor = 'pointer'
                }
            }
        }

        if (info !== '') {
            this.#infoControl!.show(info)
        }
        this.#showToolTip(tooltip, eventLngLat, tooltipFeature)
    }

    #showToolTip(html, lngLat, feature: MapPointFeature|null=null)
    //============================================================
    {
        // Show a tooltip
        if (html !== ''
        || this.#flatmap.options.showPosition
        || this.#flatmap.options.showId && feature !== null) {
            let header = ''
            if (this.#flatmap.options.showPosition) {
                const pt = turf.point(lngLat.toArray())
                const gps = turfProjection.toMercator(pt)
                const coords = JSON.stringify(gps.geometry.coordinates)
                let geopos: string|null = null
                if (this.#flatmap.options.showLngLat) {
                    geopos = JSON.stringify(lngLat.toArray())
                }
                const position = (geopos === null) ? coords : `${geopos}<br/>${coords}`
                header = (feature === null)
                             ? position
                             : `${position} (${feature.id})`
            }
            if (this.#flatmap.options.showId && feature !== null && 'id' in feature.properties) {
                header = `${header} ${feature.properties.id}`
            }
            if (header !== '') {
                html = `<span>${header}</span><br/>${html}`
            }
            if (html !== '') {
                this.#tooltip = new maplibregl.Popup({
                    closeButton: false,
                    closeOnClick: false,
                    maxWidth: 'none',
                    className: 'flatmap-tooltip-popup'
                })
                this.#tooltip
                    .setLngLat(lngLat)
                    .setHTML(html)
                    .addTo(this.#map)
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
                       && 'kind' in feature.properties!
                       && ['cell-type', 'scaffold', 'tissue'].includes(feature.properties.kind!))
            if (singleSelection) {
                this.selectFeature(featureId, dim)
            } else if (this.#featureSelected(featureId)) {
                this.unselectFeature(featureId)
            } else {
                this.selectFeature(featureId, dim)
            }
        }
    }

    #clickEvent(event)
    //================
    {
        if (this.#modal) {
            return
        }

        // Reset pitch and bearing with an ``alt-meta-click``
        if (event.originalEvent.altKey && event.originalEvent.metaKey) {
            this.#map.resetNorthPitch({animate: false})
            return
        }

        this.#clearActiveMarker()

        let clickedFeatures = this.#renderedFeatures(event.point)
        if (clickedFeatures.length == 0) {
            if (this.#resetOnClickEnabled) {
                this.unselectFeatures()
            }
            return
        }
        const clickedDrawnFeatures = clickedFeatures.filter((f) => !f.id)
        clickedFeatures = clickedFeatures.filter((f) => f.id)
        const clickedFeature = clickedFeatures[0]
        if (this.#modal) {
            if (this.#resetOnClickEnabled) {
                // Remove tooltip, reset active features, etc
                this.#resetFeatureDisplay()
                this.unselectFeatures()
                this.#clearModal()
            }
        } else if (clickedDrawnFeatures.length > 0) {
            // Layer of existing drawn features
            const clickedOnColdLayer = clickedDrawnFeatures.filter((f) => f.source === 'mapbox-gl-draw-cold')[0]
            // Layer of currently drawing feature
            const clickedOnHotLayer = clickedDrawnFeatures.filter((f) => f.source === 'mapbox-gl-draw-hot')[0]
            this.#featureEvent('click',
                clickedOnColdLayer ? clickedOnColdLayer
              : clickedFeature ? clickedFeature
              : clickedOnHotLayer
            )
        } else if (clickedFeatures.length) {
            this.#lastClickLngLat = event.lngLat
            if (this.#flatmap.options.style !== FLATMAP_STYLE.CENTRELINE) {
                this.#selectActiveFeatures(event.originalEvent)
                const lineFeatures = clickedFeatures.filter(feature => ('centreline' in feature.properties
                                                              || ('type' in feature.properties
                                                                && feature.properties.type.startsWith('line')) ))
                if (lineFeatures.length > 0) {
                    this.#multiFeatureEvent('click', lineFeatures.map(f => f.properties))
                } else if (!('details-layer' in clickedFeature.properties)) {
                    this.#featureEvent('click', clickedFeature)
                }
            } else {        // A ``centreline`` map -- we send the click's location along centrelines
                this.#selectActiveFeatures(event.originalEvent)
                const centreline_click = (clickedFeature.properties.kind === 'centreline')
                if (!centreline_click) {
                    this.#featureEvent('click', clickedFeature)
                } else {
                    const seenModels = new Set()
                    const featureProperties: FlatMapFeatureAnnotation[] = []
                    for (const feature of clickedFeatures) {
                        if (feature.properties.models && !seenModels.has(feature.properties.models)) {
                            const location = this.#locationOnLine(+feature.id!, event.lngLat)
                            featureProperties.push(Object.assign({}, feature.properties, location) as FlatMapFeatureAnnotation)
                            seenModels.add(feature.properties.models)
                        }
                    }
                    this.#multiFeatureEvent('click', featureProperties)
                }
            }
            if (this.#flatmap.options.style === FLATMAP_STYLE.FUNCTIONAL
             && 'details-layer' in clickedFeature.properties) {
                this.#layerManager.enableDetailedLayer(clickedFeature.properties.layer,
                                                       clickedFeature.properties['details-layer'])
            } else if (this.#flatmap.options.standalone) {
                if ('hyperlink' in clickedFeature.properties) {
                    window.open(clickedFeature.properties.hyperlink, '_blank')
                }
            }
        }
    }

    #locationOnLine(featureId: GeoJSONId, lngLat: maplibregl.LngLat|null)
    //===================================================================
    {
        if (lngLat && this.#flatmap.options.style === FLATMAP_STYLE.CENTRELINE) {
            const annotation = this.#flatmap.annotation(featureId)
            if (annotation && annotation.centreline && 'lineString' in annotation) {
                const line = annotation.lineString!
                const clickedPoint = turf.point([lngLat.lng, lngLat.lat])
                const linePoint = turfNearestPointOnLine.nearestPointOnLine(turfCleanCoords.cleanCoords(line), clickedPoint)
                return {
                    location: linePoint.properties.location/annotation.lineLength!
                }
            }
        }
        return {}
    }

    #activateRelatedFeatures(feature: MapPointFeature)
    //================================================
    {
        if ('nerveId' in feature.properties) {
            const nerveId = feature.properties.nerveId
            if (nerveId !== feature.id) {
                this.activateFeature(this.mapFeature(+nerveId))
            }
            for (const featureId of this.#pathManager.nerveFeatureIds(nerveId)) {
                this.activateFeature(this.mapFeature(+featureId))
            }
        }
        if ('nodeId' in feature.properties) {
            for (const featureId of this.#pathManager.pathFeatureIds(+feature.properties.nodeId)) {
                this.activateFeature(this.mapFeature(featureId))
            }
        }
    }

    clearVisibilityFilter()
    //=====================
    {
        this.#layerManager.clearVisibilityFilter()
    }

    setVisibilityFilter(filterSpecification: PropertiesFilterExpression=true)
    //=======================================================================
    {
        this.#layerManager.setVisibilityFilter(new PropertiesFilter(filterSpecification))
    }

    enablePathsBySystem(system, enable=true, force=false)
    //===================================================
    {
        this.#pathManager.enablePathsBySystem(system, enable, force)
    }

    enablePathsByType(pathTypes: string|string[], enable=true)
    //========================================================
    {
        const types = Array.isArray(pathTypes) ? pathTypes : [pathTypes]
        this.#pathTypeFacet.enable(types, enable)
        if (types.includes('centreline')) {
            this.#nerveCentrelineFacet.enableAllCentrelines(enable)
        }
        this.#layerManager.refresh()
    }

    pathFeatureIds(externalIds: string[]): Set<GeoJSONId>
    //===================================================
    {
        let featureIds = new Set<GeoJSONId>()
        for (const id of externalIds) {
            featureIds = featureIds.union(this.#pathManager.connectivityModelFeatureIds(id))
            featureIds = featureIds.union(this.#pathManager.pathModelFeatureIds(id))
        }
        return featureIds
    }

    pathModelNodes(modelId: string): Set<number>
    //===========================================
    {
        return this.#pathManager.pathModelNodes(modelId)
    }

    nodePathModels(nodeId: GeoJSONId): Set<string>
    //============================================
    {
        return this.#pathManager.nodePathModels(nodeId)
    }

    enableSckanPaths(sckanState: string, enable=true)
    //===============================================
    {
        this.#layerManager.enableSckanPaths(sckanState, enable)
    }

    enableConnectivityByTaxonIds(taxonIds: string|string[], enable=true)
    //==================================================================
    {
        this.#taxonFacet.enable(Array.isArray(taxonIds) ? taxonIds : [taxonIds], enable)
        this.#layerManager.refresh()
    }

    enableFeatureResetOnClick(enable=true)
    //====================================
    {
        this.#resetOnClickEnabled = enable
    }

    excludeAnnotated(exclude=false)
    //=============================
    {
        this.#setPaint({excludeAnnotated: exclude})
    }

    //==============================================================================

    // Marker handling

    markerPosition(annotation: FlatMapFeatureAnnotation, options:FlatMapMarkerOptions={}): Point2D|null
    //=================================================================================================
    {
        const featureId = +annotation.featureId
        if (this.#markerPositions.has(featureId)) {
            return this.#markerPositions.get(featureId)!
        }
        if (annotation.centreline && 'location' in options) {
            if ('lineString' in annotation) {
                const line = annotation.lineString!
                const point = turfAlong(line, options.location!*annotation.lineLength!)
                return point.geometry.coordinates as Point2D
            }
            return null
        }
        if (!annotation.markerPosition
         && (!annotation.geometry || !annotation.geometry.includes('Polygon'))) {
            return null
        }
        let position = annotation.markerPosition || annotation.centroid
        if (!position) {
            // Find where to place a label or popup on a feature
            const features = this.#map.querySourceFeatures(VECTOR_TILES_SOURCE, {
                'sourceLayer': this.#flatmap.options.separateLayers
                                ? `${annotation['layer']}_${annotation['tile-layer']}`
                                : annotation['tile-layer'],
                'filter': [
                    'all',
                    [ '==', ['id'], featureId ],
                    [ '==', ['geometry-type'], 'Polygon' ]
                ]
            })
            if (features.length > 0) {
                position = labelPosition(features[0])
            }
        }
        if (position) {
            this.#markerPositions.set(featureId, position)
        }
        return position || null
    }

    nextMarkerId(): number
    //====================
    {
        this.#lastMarkerId += 1
        return this.#lastMarkerId
    }

    addLayeredMarker(anatomicalId: string, options: FlatMapMarkerOptions={}): GeoJSONId[]
    //===================================================================================
    {
        const markerIds: GeoJSONId[] = []
        const featureIds = this.#flatmap.modelFeatureIds(anatomicalId)
        for (const featureId of featureIds) {
            const annotation = this.#flatmap.annotation(featureId)!
            if (annotation.kind !== 'zoom-point') {
                const markerId = this.#layerManager.addLayeredMarker(annotation, options)
                if (markerId !== null) {
                    markerIds.push(markerId)
                }
            }
        }
        return markerIds
    }

    addMarker(anatomicalId: string, options: FlatMapMarkerOptions={}): number
    //=======================================================================
    {
        const featureIds = this.#flatmap.modelFeatureIds(anatomicalId)
        let markerId = -1
        for (const featureId of featureIds) {
            const annotation = this.#flatmap.annotation(featureId)!
            const markerPosition = this.markerPosition(annotation, options)
            if (markerPosition === null
             || annotation.kind === 'zoom-point') {
                continue
            }
            // Only create a marker if there's not already one for the feature
            // NB. If several features have the same anatomical id then each will have
            //     a marker, all with the same marker id
            if (!('marker' in annotation)) {
                if (markerId === -1) {
                    markerId = this.nextMarkerId()
                }

                // MapLibre dynamically sets a transform on marker elements so in
                // order to apply a scale transform we need to create marker icons
                // inside the marker container <div>
                const colour = options.colour || MARKER_DEFAULT_COLOUR
                const markerHTML = options.element ? new maplibregl.Marker({element: options.element})
                                                   : new maplibregl.Marker({color: colour, scale: 0.5})
                const markerElement = document.createElement('div')
                const markerIcon = document.createElement('div')
                markerIcon.innerHTML = markerHTML.getElement().innerHTML
                markerElement.id = `marker-${markerId}`
                markerElement.appendChild(markerIcon)
                const markerOptions: maplibregl.MarkerOptions = {element: markerElement}
                if ('className' in options) {
                    markerOptions.className = options.className
                }
                const marker = new maplibregl.Marker(markerOptions)
                                             .setLngLat(markerPosition)
                                             .addTo(this.#map)
                markerElement.addEventListener('mouseenter', this.#markerMouseEvent.bind(this, marker))
                markerElement.addEventListener('mousemove', this.#markerMouseEvent.bind(this, marker))
                markerElement.addEventListener('mouseleave', this.#markerMouseEvent.bind(this, marker))
                markerElement.addEventListener('click', this.#markerMouseEvent.bind(this, marker))
                this.#markerIdByMarker.set(marker, markerId)
                if (!this.#featureEnabled(this.mapFeature(featureId))) {
                    markerElement.style.visibility = 'hidden'
                }

                this.#markerIdByFeatureId.set(featureId, markerId)
                // Remember that the feature has a marker
                this.#annotationByMarkerId.set(markerId, annotation)
            }
        }
        if (markerId === -1) {
            console.warn(`Unable to find feature '${anatomicalId}' on which to place marker`)
        }
        return markerId
    }

    clearMarkers()
    //============
    {
        if (this.#layerManager) {
            this.#layerManager.clearMarkers()
        }
        for (const marker of this.#markerIdByMarker.keys()) {
            marker.remove()
        }
        this.#markerIdByMarker.clear()
        this.#annotationByMarkerId.clear()
    }

    removeMarker(markerId: number)
    //============================
    {
        for (const [marker, id] of this.#markerIdByMarker.entries()) {
            if (markerId === id) {
                marker.remove()
                this.#markerIdByMarker.delete(marker)
                this.#annotationByMarkerId.delete(id)
                break
            }
        }
    }

    addDatasetMarkers(datasets: DatasetTerms[])
    //=========================================
    {
        if (this.#layerManager) {
            this.#layerManager.addDatasetMarkers(datasets)
        }
    }

    clearDatasetMarkers()
    //===================
    {
        if (this.#layerManager) {
            this.#layerManager.clearDatasetMarkers()
        }
    }

    removeDatasetMarker(datasetId: string)
    //====================================
    {
        if (this.#layerManager) {
            this.#layerManager.removeDatasetMarker(datasetId)
        }
    }

    visibleMarkerAnatomicalIds()
    //==========================
    {
        const anatomicalIds: string[] = []
        const visibleBounds = this.#map.getBounds()
        for (const [marker, id] of this.#markerIdByMarker.entries()) {
            if (visibleBounds.contains(marker.getLngLat())) {
                const annotation = this.#annotationByMarkerId.get(id)
                if (!anatomicalIds.includes(annotation.models)) {
                    anatomicalIds.push(annotation.models)
                }
            }
        }
        return anatomicalIds
    }

    #markerMouseEvent(marker: maplibregl.Marker, event)
    //=================================================
    {
        // No tooltip when context menu is open
        if (this.#modal
         || (this.#activeMarker !== null && event.type === 'mouseleave')) {
            return
        }

        // Remove any tooltips
        this.#removeTooltip()
        if (['mouseenter', 'mousemove', 'click'].includes(event.type)) {
            this.#activeMarker = marker

            // Remove any marker popup
            marker.setPopup(null)

            // Reset cursor
            marker.getElement().style.cursor = 'default'

            const markerId = this.#markerIdByMarker.get(marker)
            if (markerId) {
                const annotation = this.#annotationByMarkerId.get(markerId)
                // Show tooltip
                const html = this.#tooltipHtml(annotation, true)
                this.#showToolTip(html, marker.getLngLat())
                // Send event to app
                this.markerEvent(event, markerId, marker.getLngLat().toArray(), annotation)
            }
            event.stopPropagation()
        }
    }

    markerEvent(event, markerId: number, markerPosition: [number, number], annotation)
    //================================================================================
    {
        if (['mousemove', 'click'].includes(event.type)) {

            // Remove any tooltips
            this.#removeTooltip()

            if (['mouseenter', 'mousemove', 'click'].includes(event.type)) {
                // The marker's feature
                const feature = this.mapFeature(annotation.featureId)
                if (feature) {
                    if (event.type === 'mouseenter') {
                        // Highlight on mouse enter
                        this.#resetActiveFeatures()
                        this.activateFeature(feature)
                    } else {
                        this.#selectActiveFeatures(event)
                    }
                }
                // Show tooltip
                const html = this.#tooltipHtml(annotation, true)
                this.#showToolTip(html, markerPosition)

                // Send marker event message
                this.#flatmap.markerEvent(event.type, markerId, annotation)
            }
        }
    }

    #clearActiveMarker()
    //==================
    {
        if (this.#activeMarker !== null) {
            this.#activeMarker.setPopup(null)
            this.#activeMarker = null
        }
    }

    showMarkerPopup(markerId: number, content, _options)
    //==================================================
    {
        const marker = this.#activeMarker
        if (marker === null || markerId !== this.#markerIdByMarker.get(marker)) {
            this.#clearActiveMarker()
            return false
        }

        const location = marker.getLngLat()

        // Make sure the marker is on screen

        if (!this.#map.getBounds().contains(location)) {
            this.#map.panTo(location)
        }

        const element = document.createElement('div')
        if (typeof content === 'object') {
            element.appendChild(content)
        } else {
            element.innerHTML = content
        }

        element.addEventListener('click', _ => this.#clearActiveMarker())

        this.#tooltip = new maplibregl.Popup({
            closeButton: false,
            closeOnClick: false,
            maxWidth: 'none',
            className: 'flatmap-marker-popup'
        })

        this.#tooltip
            .setLngLat(location)
            .setDOMContent(element)

        // Set the marker tooltip and show it
        marker.setPopup(this.#tooltip)
        marker.togglePopup()

        return true
    }

    enablePanZoomEvents(enabled: boolean=true)
    //========================================
    {
        this.#pan_zoom_enabled = enabled
    }

    #panZoomEvent(type: string, event)
    //================================
    {
        if (this.#pan_zoom_enabled) {
            this.#flatmap.panZoomEvent(type)
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
            this.#layerManager.zoomEvent()
        }
    }

    //==========================================================================

    addImage(anatomicalId, imageUrl, _options={})
    //===========================================
    {
        const featureIds = this.#flatmap.modelFeatureIds(anatomicalId)
        const imageIds: string[] = []
        const mapImageId = `image-${this.#lastImageId}`
        for (const featureId of featureIds) {
            const annotation = this.#flatmap.annotation(featureId)
            if (!(annotation
               && annotation.geometry
               && annotation.geometry.includes('Polygon'))) {
                continue
            }
            this.#lastImageId += 1
            const imageId = `${mapImageId}-${this.#lastImageId}`
            const featureBounds = annotation.bounds!
            this.#map.addSource(`${imageId}-source`, {
                type: 'image',
                url: imageUrl,
                coordinates: [
                    [featureBounds[0], featureBounds[3]],
                    [featureBounds[2], featureBounds[3]],
                    [featureBounds[2], featureBounds[1]],
                    [featureBounds[0], featureBounds[1]],
                ]
            })
            this.#map.addLayer({
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

    removeImage(mapImageId: string)
    //=============================
    {
        if (this.#imageLayerIds.has(mapImageId)) {
            for (const imageId of this.#imageLayerIds.get(mapImageId)) {
                const layerId = `${imageId}-layer`
                if (this.#map.getLayer(layerId)) {
                    this.#map.removeLayer(layerId)
                }
                this.#map.removeSource(`${imageId}-source`)
            }
            this.#imageLayerIds.delete(mapImageId)
        }
    }

    //==========================================================================

    getNerveDetails(): NerveCentrelineDetails[]
    //=========================================
    {
        return this.#pathManager.nerveCentrelineDetails
    }

    enableNeuronPathsByNerve(nerveModels: string|string[], enable=true, showCentreline=false)
    //=======================================================================================
    {
        this.#nerveCentrelineFacet.enable(Array.isArray(nerveModels) ? nerveModels : [nerveModels], enable)
        this.#pathTypeFacet.enableCentrelines(showCentreline)
        this.#layerManager.refresh()
    }
}

//==============================================================================
