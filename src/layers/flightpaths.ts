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

import type { Position } from '@deck.gl/core'
import { ArcLayer, type ArcLayerProps } from '@deck.gl/layers'

import { Geometry, Model } from '@luma.gl/engine'

//==============================================================================

import { PropertiesFilter } from '../filters'
import type { FlatMap } from '../flatmap'
import type { GeoJSONId, MapFeatureIdentifier } from '../flatmap-types'
import type { UserInteractions } from '../interactions'
import { type PathStyle, pathColourArray }  from '../pathways'

import type { DeckGlOverlay } from './deckgl'
import type { StylingOptions } from './styling'

//==============================================================================

import type { PropertiesType } from '../types'

interface PathProperties extends PropertiesType {
    active?: boolean
    featureId?: number
    hidden?: boolean
    kind?: string
    pathEndPosition?: number[]
    pathStartPosition?: number[]
    selected?: boolean
}

//==============================================================================

const ARC_ID_PREFIX = 'arc-'

//==============================================================================

const transparencyCheck = '|| length(vColor) == 0.0'

class ArcMapLayer extends ArcLayer
{
    static layerName = 'FlightPathsLayer'

    getShaders()
    //==========
    {
        const shaders = super.getShaders()
        shaders.fs = shaders.fs.replace('isValid == 0.0', `isValid == 0.0 ${transparencyCheck}`)
        return shaders
    }
}

//==============================================================================

const makeDashedTriangles = `  float alpha = floor(fract(float(gl_VertexID)/12.0)+0.5);
  if (vColor.a != 0.0) vColor.a *= alpha;
`

class ArcDashedLayer extends ArcMapLayer
{
    static layerName = 'DashedFlightPathsLayer'

    getShaders()
    //==========
    {
        const shaders = super.getShaders()
        shaders.vs = shaders.vs.replace('DECKGL_FILTER_COLOR(', `${makeDashedTriangles}\n  DECKGL_FILTER_COLOR(`)
        return shaders
    }

    _getModel()
    //=========
    {
        const {numSegments} = this.props
        let positions = []
        for (let i = 0; i < numSegments; i++) {
            positions = positions.concat([i,  1, 0, i,  -1, 0, i+1,  1, 0,
                                          i, -1, 0, i+1, 1, 0, i+1, -1, 0])
        }
        const model = new Model(this.context.device, {
            ...this.getShaders(),
            id: this.props.id,
            bufferLayout: this.getAttributeManager()!.getBufferLayouts(),
            geometry: new Geometry({
                topology: 'triangle-list',
                attributes: {
                    positions: new Float32Array(positions)
                }
            }),
            isInstanced: true,
        })
        model.setUniforms({numSegments: numSegments})
        return model
    }
}

//==============================================================================

export class FlightPathLayer
{
    #deckOverlay: DeckGlOverlay
    #dimmed: boolean = false
    #enabled: boolean = false
    #featureFilter: PropertiesFilter = new PropertiesFilter()
    #featureToLayerProperties: Map<GeoJSONId, ArcLayerProps> = new Map()
    #layerProperties: Map<string, ArcLayerProps> = new Map()
    #pathFeatures: Map<GeoJSONId, PathProperties>
    #pathFilters: Map<string, PropertiesFilter>
    #pathStyles: Map<string, PathStyle>
    #pathTypes: string[]

    constructor(deckOverlay: DeckGlOverlay, flatmap: FlatMap, ui: UserInteractions)
    {
        this.#deckOverlay = deckOverlay
        this.#pathFeatures = new Map([...flatmap.annotations.values()]
                                    .filter(ann => ann['tile-layer'] === 'pathways'
                                                && ('geometry' in ann && ann['geometry'] === 'LineString'
                                                 || 'geom-type' in ann && ann['geom-type'] === 'LineString')
                                                && 'type' in ann && ann['type']!.startsWith('line')
                                                && 'kind' in ann
                                                && 'pathStartPosition' in ann
                                                && 'pathEndPosition' in ann)
                                    .map(ann => [ann.featureId, ann as PathProperties]))
        this.#pathStyles = new Map(ui.pathManager.pathStyles().map(pathStyle => [pathStyle.type, pathStyle]))
        this.#pathTypes = [...this.#pathStyles.keys()]
        const knownTypes = this.#pathTypes.filter(pathType => pathType !== 'other')
        this.#pathFilters = new Map(
            this.#pathTypes
                .map(pathType => [pathType, new PropertiesFilter({
                    OR: [{
                        AND: [
                            {kind: knownTypes},
                            {kind: pathType}
                        ],
                    },
                    {
                        AND: [
                            {NOT: {kind: knownTypes}},
                            {pathType: 'other'}
                        ]
                    }]
                })
            ])
        )
        this.#layerProperties = new Map(this.#pathTypes.map(pathType => [pathType, this.#newLayerProperties(pathType)]))
        this.#redraw()
    }

    clearVisibilityFilter()
    //=====================
    {
        this.setVisibilityFilter(new PropertiesFilter(true))
    }

    enable(enable: boolean=true)
    //==========================
    {
        if (enable !== this.#enabled) {
            this.#layerProperties = new Map(this.#pathTypes.map(pathType => [pathType, this.#newLayerProperties(pathType)]))
            for (const [_, properties] of this.#layerProperties.entries()) {
                properties.visible = enable
            }
        this.#enabled = enable
        this.#redraw()
        }
    }

    queryFeaturesAtPoint(point): MapFeatureIdentifier[]
    //=================================================
    {
        if (this.#enabled) {
            return this.#deckOverlay
                       .queryFeaturesAtPoint(point)
                       .filter(o => o.layer!.id.startsWith(ARC_ID_PREFIX))
                       .map(o => this.#makeMapFeature(o.object))
        }
        return []
    }

    setDataProperty(featureId: number, key: string, enabled: boolean)
    //===============================================================
    {
        const properties = this.#pathFeatures.get(featureId)
        if (properties) {
            if (!(key in properties) || properties[key] !== enabled) {
                properties[key] = enabled
            }
        }
    }

    removeFeatureState(featureId: GeoJSONId, key: string)
    //===================================================
    {
        const properties = this.#featureToLayerProperties.get(featureId)
        if (properties) {
            properties[key] = false
            this.#redraw()
        }
    }

    setFeatureState(featureId: GeoJSONId, state: PropertiesType)
    //==========================================================
    {
        const properties = this.#featureToLayerProperties.get(featureId)
        if (properties) {
            for (const [key, value] of Object.entries(state)) {
                properties[key] = value
            }
            this.#redraw()
        }
    }

    setPaint(options: StylingOptions)
    //===============================
    {
        const dimmed = options.dimmed || false
        if (this.#dimmed !== dimmed) {
            this.#dimmed = dimmed
            this.#redraw()
        }
    }

    setVisibilityFilter(featureFilter: PropertiesFilter)
    //==================================================
    {
        this.#featureFilter = featureFilter
        if (this.#enabled) {
            this.#layerProperties = new Map(this.#pathTypes.map(pathType => [pathType, this.#newLayerProperties(pathType)]))
            this.#redraw()
        }
    }

    #newLayerProperties(pathType: string): ArcLayerProps
    //==================================================
    {
        return {
            id: `${ARC_ID_PREFIX}${pathType}`,
            data: this.#pathData(pathType),
            pickable: true,
            numSegments: 400,
            // Styles
            getSourcePosition: (f: PathProperties) => (f.pathStartPosition as Position),
            getTargetPosition: (f: PathProperties) => (f.pathEndPosition as Position),
            getSourceColor: this.#pathColour.bind(this),
            getTargetColor: this.#pathColour.bind(this),
            opacity: 1.0,
            getWidth: 3,
            visible: this.#enabled
        }
    }

    #makeMapFeature(pickedObject: PropertiesType): MapFeatureIdentifier
    //===============================================================
    {
        // Mock up a map vector feature
        return {
            id: +pickedObject.featureId,
            source: 'vector-tiles',
            sourceLayer: `${pickedObject.layer}_${pickedObject['tile-layer']}`,
            properties: pickedObject,
            flightPath: true
        }
    }

    #newArcLayer(pathType: string): ArcMapLayer
    //=========================================
    {
        const layerProperties = this.#layerProperties.get(pathType)
        const pathStyle = this.#pathStyles.get(pathType)
        const layer = pathStyle.dashed ? new ArcDashedLayer(layerProperties)
                                       : new ArcMapLayer(layerProperties)
        for (const PathProperties of (layerProperties.data as PathProperties[])) {
            this.#featureToLayerProperties.set(+PathProperties.featureId, layerProperties)
        }
        return layer
    }

    // DeckGL isn't recognising changes in active and selected...

    #pathColour(properties: PropertiesType)
    //=====================================
    {
        if (properties.hidden) {
            return [0, 0, 0, 0]
        }
        return pathColourArray(properties.kind as string,
                               properties.active || properties.selected ? 255
                                                                        : this.#dimmed ? 20 : 160)
    }

    #pathData(pathType: string): PathProperties[]
    //===========================================
    {
        const filter = this.#pathFilters.get(pathType)
        if (filter) {
            return ([...this.#pathFeatures.values()]  as PathProperties[])
                        .filter(ann => filter.match(ann))
                        .filter(ann => this.#featureFilter.match(ann))
        }
        return []
    }

    #redraw()
    //=======
    {
        const layers = this.#pathTypes.map(pathType => this.#newArcLayer(pathType))
        this.#deckOverlay.setLayers(layers)
    }
}

//==============================================================================
