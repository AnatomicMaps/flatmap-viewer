/*==============================================================================

Flatmap viewer and annotation tool

Copyright (c) 2019 - 2025  David Brooks

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

/*
 *   Annotation drawing mode is enabled/disabled by:
 *
 *   1. A call to ``Flatmap.enableAnnotation()``
 *   2. An on-map control button calls this when in standalone viewing mode.
 *
 *   Drawn features include a GeoJSON geometry. Existing geometries of annotated
 *   features are added to the MapboxDraw control when the map is loaded. These
 *   should only be visible on the map when the draw control is active.
 *
 *   We listen for drawn features being created, updated and deleted, and notify
 *   the external annotator, first assigning new features and ID wrt the flatmap.
 *   The external annotator may reject a new feature (the user's cancelled the
 *   resulting dialog) which results in the newly drawn feature being removed from
 *   the control.
 *
 *   The external annotator is responsible for saving/obtaining drawn geometries
 *   from an annotation service.
 *
 */

//==============================================================================

import MapboxDraw from "@mapbox/mapbox-gl-draw"
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css'
import type * as maplibregl from 'maplibre-gl'

//==============================================================================

import type { FlatMap } from '../flatmap'
import type {AnnotatedFeature, AnnotationDrawMode, AnnotationEvent, GeoJSONId} from '../flatmap-types'

//==============================================================================

interface IdObject
{
    id: string
}

const drawStyleIds: string[] = MapboxDraw.lib.theme.map((s: IdObject) => s.id)

export const DRAW_ANNOTATION_LAYERS = [...drawStyleIds.map(id => `${id}.cold`),
                                       ...drawStyleIds.map(id => `${id}.hot`)]

//==============================================================================

export class AnnotationDrawControl
{
    #committedFeatures: Map<GeoJSONId, AnnotatedFeature> = new Map()
    #container: HTMLElement|null = null
    #draw: MapboxDraw
    #flatmap: FlatMap
    #map: maplibregl.Map|null = null
    #uncommittedFeatureIds: Set<GeoJSONId> = new Set()
    #visible: boolean

    constructor(flatmap: FlatMap, visible=false)
    {
        MapboxDraw.constants.classes.CONTROL_BASE  = 'maplibregl-ctrl'
        MapboxDraw.constants.classes.CONTROL_PREFIX = 'maplibregl-ctrl-'
        MapboxDraw.constants.classes.CONTROL_GROUP = 'maplibregl-ctrl-group'

        this.#flatmap = flatmap
        this.#visible = visible
        this.#draw = new MapboxDraw({
            displayControlsDefault: false,
            controls: {
                point: true,
                line_string: true,
                polygon: true,
                trash: true
            },
            userProperties: true,
            keybindings: true
        })
    }

    onAdd(map: maplibregl.Map): HTMLElement
    //====================================
    {
        this.#map = map
        this.#container = this.#draw.onAdd(map)

        // Fix to allow deletion with Del Key when default trash icon is not shown.
        // See https://github.com/mapbox/mapbox-gl-draw/issues/989
        this.#draw.options.controls.trash = true

        // Prevent firefox menu from appearing on Alt key up
        window.addEventListener('keyup', function (e) {
            if (e.key === "Alt") {
                e.preventDefault()
            }
        }, false)
        map.on('draw.modechange', this.modeChangedEvent.bind(this))
        map.on('draw.create', this.createdFeature.bind(this))
        map.on('draw.delete', this.deletedFeature.bind(this))
        map.on('draw.update', this.updatedFeature.bind(this))
        map.on('draw.selectionchange', this.selectionChangedEvent.bind(this))
        this.show(this.#visible)
        return this.#container!
    }

    onRemove()
    //========
    {
        if (this.#container && this.#container.parentNode) {
            this.#container.parentNode.removeChild(this.#container)
        }
        this.#container = null
        this.#map = null
    }

    show(visible=true)
    //================
    {
        if (this.#map && this.#container) {
            this.#container.style.display = visible ? 'block' : 'none'
            if (visible && !this.#visible) {
                for (const layerId of DRAW_ANNOTATION_LAYERS) {
                    this.#map.setLayoutProperty(layerId, 'visibility', 'visible')
                }
            } else if (!visible && this.#visible) {
                for (const layerId of DRAW_ANNOTATION_LAYERS) {
                    this.#map.setLayoutProperty(layerId, 'visibility', 'none')
                }
            }
        }
        this.#visible = visible
    }

    #cleanFeature(event): AnnotatedFeature|null
    //=========================================
    {
        const features = event.features.filter(f => f.type === 'Feature')
                                       .map(f => {
                                            return {
                                                id: f.id,
                                                type: 'Feature',
                                                geometry: f.geometry
                                            }
                                        })
        return features.length ? features[0] : null
    }

    #sendEvent(type: string, feature: AnnotatedFeature)
    //=================================================
    {
        if (feature.id) {
            // Add when the event is 'created', 'updated' or 'deleted'
            this.#uncommittedFeatureIds.add(+feature.id)
        }
        this.#flatmap.annotationEvent(type, feature)
    }

    createdFeature(event)
    //===================
    {
        const feature = this.#cleanFeature(event)
        if (feature) {
            // Set properties to indicate that this is a drawn annotation
            this.#draw.setFeatureProperty(feature.id, 'drawn', true)
            this.#draw.setFeatureProperty(feature.id, 'label', 'Drawn annotation')
            // They need to be on the feature passed to the annotator for storage
            feature.properties = {
                user_drawn: true,
                user_label: 'Drawn annotation'
            }
            this.#sendEvent('created', feature)
        }
    }

    deletedFeature(event)
    //===================
    {
        const feature = this.#cleanFeature(event)
        if (feature) {
            if (this.#uncommittedFeatureIds.has(feature.id)) {
                // Ignore delete on an uncommitted create or update
            } else {
                this.#sendEvent('deleted', feature)
            }
        }
    }

    updatedFeature(event)
    //===================
    {
        const feature = this.#cleanFeature(event)
        if (feature) {
            // specify updated callback type, either `move` or `change_coordinates`
            feature.action = event.action
            if (this.#uncommittedFeatureIds.has(feature.id)) {
                // Ignore updates on an uncommitted create or update
            } else {
                this.#sendEvent('updated', feature)
            }
        }
    }

    modeChangedEvent(event)
    //=====================
    {
        // Used to indicate the feature mode changes
        this.#sendEvent('modeChanged', event)
    }

    selectionChangedEvent(event)
    //==========================
    {
        // Used to indicate a feature is selected or deselected
        this.#sendEvent('selectionChanged', event)
    }

    commitEvent(event: AnnotationEvent)
    //=================================
    {
        const feature = event.feature
        if (event.type === 'deleted') {
            this.#committedFeatures.delete(feature.id)
        } else {
            this.#committedFeatures.set(feature.id, feature)
        }
        this.#uncommittedFeatureIds.delete(feature.id)
    }

    abortEvent(event: AnnotationEvent)
    //================================
    {
        // Used as a flag to indicate the popup is closed
        // Rollback should be performed when triggered 'aborted' event
        this.#sendEvent('aborted', event.feature)
    }

    rollbackEvent(event: AnnotationEvent)
    //===================================
    {
        const feature = event.feature
        if (event.type === 'created') {
            this.#draw.delete(feature.id)
            this.#committedFeatures.delete(feature.id)
            this.#uncommittedFeatureIds.delete(feature.id)
        } else if (event.type === 'deleted') {
            this.#draw.add(feature)
            this.#committedFeatures.set(feature.id, feature)
            this.#uncommittedFeatureIds.delete(feature.id)
        } else if (event.type === 'updated') {
            const savedFeature = this.#committedFeatures.get(feature.id)
            if (savedFeature) {
                this.#draw.delete(feature.id)
                this.#draw.add(savedFeature)
                this.#uncommittedFeatureIds.delete(feature.id)
            }
        }
    }
    
    clearFeatures()
    //=============
    {
        this.#draw.deleteAll()
    }

    removeFeature()
    //=============
    {
        this.#draw.trash()
    }

    addFeature(feature: AnnotatedFeature)
    //===================================
    {
        feature = Object.assign({}, feature, {type: 'Feature'})
        const ids = this.#draw.add(feature)
        this.#committedFeatures.set(ids[0], feature)
        this.#uncommittedFeatureIds.delete(ids[0])
    }

    refreshGeometry(feature: AnnotatedFeature)
    //========================================
    {
        return this.#draw.get(feature.id) || null
    }

    changeMode(mode: AnnotationDrawMode)
    //==================================
    {
        // Change the mode directly without listening to modes callback
        this.#draw.changeMode(mode.mode, mode.options)
    }
}

//==============================================================================
