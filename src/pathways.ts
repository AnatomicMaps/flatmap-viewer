/*==============================================================================

Flatmap viewer and annotation tool

Copyright (c) 2020  David Brooks

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

import {colord} from 'colord'

//==============================================================================

import {type FlatMap, FLATMAP_STYLE} from './flatmap'
import type {FlatMapPathways, GeoJSONId, PathDetailsType} from './flatmap-types'
import type {UserInteractions} from './interactions'
import type {Callback} from './types'
import {reverseMap} from './utils'

export const PATHWAYS_LAYER = 'pathways'

//==============================================================================

export const APINATOMY_PATH_PREFIX = 'ilxtr:'

//==============================================================================

export type PathStyle = {
    type: string
    label: string
    colour: string
    dashed?: boolean
}

export type PathTypeDefn = PathStyle & {
    enabled?: boolean
}

export type PathType = PathStyle & {
    enabled: boolean
}

//==============================================================================

const PATH_TYPES: PathTypeDefn[] = [
    { type: "cns", label: "CNS", colour: "#9B1FC1"},
    { type: "enteric", label: "Enteric", colour: "#C0D040"},
    { type: "intracardiac", label: "Local circuit neuron", colour: "#F19E38"},
    { type: "para-pre", label: "Parasympathetic pre-ganglionic", colour: "#3F8F4A"},
    { type: "para-post", label: "Parasympathetic post-ganglionic", colour: "#3F8F4A", dashed: true},
    { type: "sensory", label: "Sensory (afferent) neuron", colour: "#2A62F6"},
    { type: "motor", label: "Somatic lower motor", colour: "#98561D"},
    { type: "somatic", label: "Somatic lower motor", colour: "#98561D"},
    { type: "symp-pre", label: "Sympathetic pre-ganglionic", colour: "#EA3423"},
    { type: "symp-post", label: "Sympathetic post-ganglionic", colour: "#EA3423", dashed: true},
    { type: "other", label: "Other neuron type", colour: "#888"},
    { type: "arterial", label: "Arterial blood vessel", colour: "#F00", enabled: false},
    { type: "venous", label: "Venous blood vessel", colour: "#2F6EBA", enabled: false},
    { type: "centreline", label: "Nerve centrelines", colour: "#CCC", enabled: false},
    { type: "error", label: "Paths with errors or warnings", colour: "#FF0", enabled: false}
]

const PathTypeMap: Map<string, PathTypeDefn> = new Map(PATH_TYPES.map(t => [t.type, t]))

export const PATH_STYLE_RULES =
    PATH_TYPES.flatMap(pathType => [['==', ['get', 'kind'], pathType.type], pathType.colour])


export type RGBAArray = [number, number, number, number]

export function pathColourArray(pathType: string, alpha: number=255): RGBAArray
//=============================================================================
{
    const rgb = colord(PathTypeMap.has(pathType)
                        ? PathTypeMap.get(pathType).colour
                        : PathTypeMap.get('other').colour).toRgb()
    return [rgb.r, rgb.g, rgb.b, alpha]
}

//==============================================================================

const NO_NERVES = ['NO-NERVES', 'No associated nerves']

//==============================================================================

export const noFlatMapPathways: FlatMapPathways = {
    models: [],
    'node-paths': {},
    paths: {},
    'type-paths': {}
}

//==============================================================================

/* To go into systems.ts */

export interface SystemComponent
{
    label: string
    models: string
    ftus?: SystemComponent[]
}

export interface SystemsType
{
    name: string
    colour: string
    featureIds: string[]
    enabled: boolean
    pathIds: string[]
    organs: SystemComponent[]
}

//==============================================================================

export interface NerveCentrelineDetails
{
    models: string
    label: string
}

//==============================================================================

export class PathManager
{
    #allFeatureIds: Set<GeoJSONId>
    #nerveCentrelineDetails: Map<string, string> = new Map() // models --> label
    #connectivityModelPaths: Record<string, string[]>   // modelId: [pathIds]
    #enabledCentrelines: boolean = false
    #flatmap: FlatMap
    #haveCentrelines: boolean = true
    #nodePaths: Record<GeoJSONId, string[]>
    #pathsByCentreline: Map<string, Set<string>> = new Map()
    #pathsByType: Record<string, string[]>
    #pathLines: Map<string, Array<GeoJSONId>> = new Map()  // pathId: [lineIds]
    #pathModelPaths: Record<string, string[]>
    #paths: Record<string, PathDetailsType>
    #pathsByLine: Map<GeoJSONId, Set<string>>
    #pathsByNerve: Map<string, Set<string>>
    #pathToConnectivityModel: Record<string, string>
    #pathToPathModel: Record<string, string>
    #pathtypeEnabled: Record<string, boolean>
    #ui: UserInteractions

    constructor(flatmap: FlatMap, ui: UserInteractions)
    {
        this.#flatmap = flatmap
        this.#ui = ui
        this.#connectivityModelPaths = {}
        this.#pathToConnectivityModel = {}
        for (const model of flatmap.pathways.models || []) {
            this.#connectivityModelPaths[model.id] = model.paths
            for (const path of model.paths) {
                this.#pathToConnectivityModel[path] = model.id
            }
        }
        this.#pathModelPaths = {}                               // pathModelId: [pathIds]
        this.#pathToPathModel = {}                              // pathId: pathModelId
        this.#paths = {}                                        // pathId: path
        const pathNerves = new Map()                            // pathId: [nerveIds]
        if ('paths' in flatmap.pathways) {
            for (const [pathId, path] of Object.entries(flatmap.pathways.paths)) {
                this.#pathLines.set(pathId, path.lines)
                pathNerves.set(pathId, path.nerves)
                this.#paths[pathId] = path
                this.#paths[pathId].systemCount = 0
                if ('models' in path) {
                    const modelId = path.models
                    if (!(modelId in this.#pathModelPaths)) {
                        this.#pathModelPaths[modelId] = []
                    }
                    this.#pathModelPaths[modelId].push(pathId)
                    this.#pathToPathModel[pathId] = modelId
                }
                for (const id of (path.centrelines || [])) {
                    if (!this.#pathsByCentreline.has(id)) {
                        this.#pathsByCentreline.set(id, new Set())
                    }
                    this.#pathsByCentreline.get(id).add(pathId)
                }
            }
        }

        this.#pathsByLine = reverseMap(this.#pathLines)         // lineId: [pathIds]
        this.#pathsByNerve = reverseMap(pathNerves)             // nerveId: [pathIds]

        const nodePaths = flatmap.pathways['node-paths']
        this.#nodePaths = nodePaths                             // nodeId: [pathIds]
        const featureIds: Set<GeoJSONId> = new Set()
        for (const paths of Object.values(this.#nodePaths)) {
            this.#addPathsToFeatureSet(paths, featureIds)
        }
        this.#allFeatureIds = featureIds

        // Construct a list of path types we know about
        const pathTypes = {}
        this.#pathtypeEnabled = {}
        for (const pathTypeDefn of PATH_TYPES) {
            pathTypes[pathTypeDefn.type] = pathTypeDefn
            this.#pathtypeEnabled[pathTypeDefn.type] = !('enabled' in pathTypeDefn) || pathTypeDefn.enabled
        }

        // Set path types, mapping unknown path types to ``other``
        this.#pathsByType = {}
        this.#pathsByType.other = []
        for (const [pathType, pathIds] of Object.entries(flatmap.pathways['type-paths'])) {
            if (pathType in pathTypes) {
                this.#pathsByType[pathType] = pathIds
            } else {
                this.#pathsByType.other.push(...pathIds)
                this.#pathtypeEnabled[pathType] = false
            }
            if (pathType === 'centreline') {
                // Set details of centrelines
                for (const centrelineId of pathIds) {
                    const annotation = flatmap.annotationById(centrelineId)
                    if (annotation) {
                        if (flatmap.options.style === FLATMAP_STYLE.CENTRELINE
                         || this.#pathsByCentreline.has(centrelineId)) {
                            if (annotation.models) {
                                this.#nerveCentrelineDetails.set(annotation.models, annotation.label || annotation.models)
                            }
                        }
                    }
                }
            }
        }
        // Assign types to individual paths
        this.#assignPathTypes()

        // Nerve centrelines are a special case with their own controls
        if (flatmap.options.style === FLATMAP_STYLE.CENTRELINE) {
            // Centrelines are always enabled in a ``centreline`` map
            this.#enabledCentrelines = true
        } else {
            this.#haveCentrelines = (this.#nerveCentrelineDetails.size > 0)
        }
    }

    get nerveCentrelineDetails(): NerveCentrelineDetails[]
    //====================================================
    {
        return [NO_NERVES, ...this.#nerveCentrelineDetails.entries()].map((entry) => {
            const label = entry[1]
            return {
                models: entry[0],
                label: label.charAt(0).toUpperCase() + label.slice(1)
            }
        })
    }

    get haveCentrelines(): boolean
    //============================
    {
        return this.#haveCentrelines
    }

    get enabledCentrelines(): boolean
    //===============================
    {
        return this.#enabledCentrelines
    }

    #assignPathTypes()
    //================
    {
        for (const [pathType, paths] of Object.entries(this.#pathsByType)) {
            for (const pathId of paths) {
                this.#paths[pathId].pathType = pathType
            }
        }
    }

    pathStyles(): PathStyle[]
    //=======================
    {
        const styles = []
        for (const mapType of this.pathTypes()) {
            const defn = PathTypeMap.get(mapType.type)
            styles.push({
                type: defn.type,
                colour: defn.colour,
                dashed: defn.dashed || false
            })
        }
        return styles
    }

    pathTypes(): PathType[]
    //=====================
    {
        const pathTypes: PathType[] = []
        for (const pathTypeDefn of PATH_TYPES) {
            if (pathTypeDefn.type in this.#pathsByType
            && this.#pathsByType[pathTypeDefn.type].length > 0) {
                if (pathTypeDefn.type === 'centreline') {
                    if (this.#flatmap.options.style !== FLATMAP_STYLE.CENTRELINE) {
                        this.#haveCentrelines = true
                        this.#enabledCentrelines = this.#pathtypeEnabled[pathTypeDefn.type]
                        pathTypes.push({
                            ...pathTypeDefn,
                            enabled: this.#pathtypeEnabled[pathTypeDefn.type]
                        })
                    }
                } else {
                    pathTypes.push({
                        ...pathTypeDefn,
                        enabled: this.#pathtypeEnabled[pathTypeDefn.type]
                    })
                }
            }
        }
        return pathTypes
    }

    #addPathsToFeatureSet(pathIds: Iterable<string>, featureSet: Set<GeoJSONId>)
    //==========================================================================
    {
        for (const pathId of pathIds) {
            const path = this.#paths[pathId]
            path.lines.forEach(lineId => { featureSet.add(lineId) })
            path.nerves.forEach(nerveId => { featureSet.add(nerveId) })
            path.nodes.forEach(nodeId => { featureSet.add(nodeId) })
        }
    }

    allFeatureIds(): Set<GeoJSONId>
    //=============================
    {
        return this.#allFeatureIds
    }

    lineFeatureIds(lineIds: Iterable<GeoJSONId>): Set<GeoJSONId>
    //==========================================================
    {
        const featureIds: Set<GeoJSONId> = new Set()
        for (const lineId of lineIds) {
            if (this.#pathsByLine.has(lineId)) {
                this.#addPathsToFeatureSet(this.#pathsByLine.get(lineId), featureIds)
            }
        }
        return featureIds
    }

    nerveFeatureIds(nerveId: string): Set<GeoJSONId>
    //==============================================
    {
        const featureIds: Set<GeoJSONId> = new Set()
        if (this.#pathsByNerve.has(nerveId)) {
            this.#addPathsToFeatureSet(this.#pathsByNerve.get(nerveId), featureIds)
        }
        return featureIds
    }

    connectivityModelFeatureIds(modelId: string): Set<GeoJSONId>
    //==========================================================
    {
        const featureIds: Set<GeoJSONId> = new Set()
        if (modelId in this.#connectivityModelPaths) {
            this.#addPathsToFeatureSet(this.#connectivityModelPaths[modelId], featureIds)
            }
        return featureIds
    }

    pathModelFeatureIds(modelId: string): Set<GeoJSONId>
    //==================================================
    {
        const featureIds: Set<GeoJSONId> = new Set()
        if (modelId in this.#pathModelPaths) {
            this.#addPathsToFeatureSet(this.#pathModelPaths[modelId], featureIds)
            }
        return featureIds
    }

    isNode(id: GeoJSONId): boolean
    //============================
    {
        return id in this.#nodePaths
    }

    pathFeatureIds(nodeId: GeoJSONId): Set<GeoJSONId>
    //===============================================
    {
        const featureIds: Set<GeoJSONId> = new Set()
        if (nodeId in this.#nodePaths) {
            this.#addPathsToFeatureSet(this.#nodePaths[nodeId], featureIds)
        }
        return featureIds
    }

    /* FUTURE
    #typeFeatureIds(pathType: string): Set<GeoJSONId>
    //===============================================
    {
        const featureIds: Set<GeoJSONId> = new Set()
        if (pathType in this.#pathsByType) {
            this.#addPathsToFeatureSet(this.#pathsByType[pathType], featureIds)
        }
        return featureIds
    }
    */

    enablePathLines(enable: boolean, force: boolean=false)
    //====================================================
    {
        for (const lineId of this.#pathsByLine.keys()) {
            this.#ui.enableFeature(lineId, enable, force)
        }
    }

    enablePathsByCentreline(centrelineId: string, enable: boolean, force: boolean=false)
    //==================================================================================
    {
        if (this.#pathsByCentreline.has(centrelineId)) {
            // Enable the lines that make up a centreline
            if (this.#pathLines.has(centrelineId)) {
                for (const lineId of this.#pathLines.get(centrelineId)) {
                    this.#ui.enableFeature(lineId, enable, force)
                }
            }
            // Enable the paths that are associated with a centreline
            const featureIds: Set<GeoJSONId> = new Set()
            this.#addPathsToFeatureSet(this.#pathsByCentreline.get(centrelineId), featureIds)
            for (const featureId of featureIds) {
                this.#ui.enableFeature(featureId, enable, force)
            }
            this.#notifyWatchers()
        }
    }

    enablePathsBySystem(system: SystemsType, enable: boolean, force: boolean=false)
    //=============================================================================
    {
        let changed = false
        for (const pathId of system.pathIds) {
            const path = this.#paths[pathId]
            if (this.#pathtypeEnabled[path.pathType]
              && (force
               || enable && path.systemCount === 0
               || !enable && path.systemCount === 1)) {
                // and type(pathId) is enabled...
                const featureIds: Set<GeoJSONId> = new Set()
                this.#addPathsToFeatureSet([pathId], featureIds)
                for (const featureId of featureIds) {
                    this.#ui.enableFeature(featureId, enable, force)
                }
                changed = true
            }
            path.systemCount += (enable ? 1 : -1)
            if (path.systemCount < 0) {
                path.systemCount = 0
            }
            // TODO? Show connectors and parent components of these paths??
        }
        if (changed) {
            this.#notifyWatchers()
        }
    }

    pathTypeEnabled(pathType: string): boolean
    //========================================
    {
        return this.#pathtypeEnabled[pathType] || false
    }

    nodePathModels(nodeId: GeoJSONId): Set<string>
    //============================================
    {
        const modelIds: Set<string> = new Set()
        if (nodeId in this.#nodePaths) {
            for (const pathId of this.#nodePaths[nodeId]) {
                if (pathId in this.#pathToPathModel) {
                    modelIds.add(this.#pathToPathModel[pathId])
                }
            }
        }
        return modelIds
    }

    pathModelNodes(modelId: string): Set<GeoJSONId>
    //=============================================
    {
        const nodeIds: Set<GeoJSONId> = new Set()
        if (modelId in this.#pathModelPaths) {
            for (const pathId of this.#pathModelPaths[modelId]) {
                for (const nodeId of this.#paths[pathId].nodes) {
                    nodeIds.add(nodeId)
                }
            }
        }
        return nodeIds
    }

    //==========================================================================

    #lastWatcherId = 0
    #watcherCallbacks: Map<number, Callback> = new Map()

    addWatcher(callback: Callback): number
    //====================================
    {
        this.#lastWatcherId += 1
        this.#watcherCallbacks.set(this.#lastWatcherId, callback)
        return this.#lastWatcherId
    }

    removeWatcher(watcherId: number)
    //==============================
    {
        this.#watcherCallbacks.delete(watcherId)
    }

    #notifyWatchers(changes: object={})
    //=================================
    {
        for (const callback of this.#watcherCallbacks.values()) {
            callback(changes)
        }
    }
}

//==============================================================================
