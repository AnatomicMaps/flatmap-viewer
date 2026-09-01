/*==============================================================================

Flatmap viewer and annotation tool

Copyright (c) 2019 - 2025  David Brooks

Licensed under the Apache License, Version 2.0 (the "License")
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

==============================================================================*/

import type {FlatMap} from './flatmap'
import type {GeoJSONId} from './flatmap-types'
import type {UserInteractions} from './interactions'

//==============================================================================

type FC_CLASS_LIST = string[]

const FC_KIND: Record<string, FC_CLASS_LIST> = {
    SYSTEM: ['fc:System', 'fc-class:System'],
    ORGAN:  ['fc:Organ', 'fc-class:Organ'],
    FTU:    ['fc:Ftu', 'fc-class:Ftu']
}

//==============================================================================

type SystemFeature = {
    label: string
    models: string
    ftus?: SystemFeature[]
}

type SystemDetail = {
    colour: string
    enabled: boolean
    featureIds: GeoJSONId[]
    name: string
    organs: SystemFeature[]
    pathIds: string[]
}

//==============================================================================

export type System = {
    colour: string
    enabled: boolean
    id: string
    name: string
    organs: string[]
}

//==============================================================================

export class SystemsManager
{
    #enabledChildren: Map<GeoJSONId, number> = new Map()
    #flatmap: FlatMap
    #systems: Map<string, SystemDetail> = new Map()
    #ui: UserInteractions

    constructor(flatmap: FlatMap, ui: UserInteractions, enabled: boolean=false)
    {
        this.#flatmap = flatmap
        this.#ui = ui
        for (const [_, ann] of flatmap.annotations) {
            if (FC_KIND.SYSTEM.includes(ann['fc-class'])) {
                const systemId = ann.name.replaceAll(' ', '_')
                if (this.#systems.has(systemId)) {
                    this.#systems.get(systemId).featureIds.push(ann.featureId)
                } else {
                    this.#systems.set(systemId, {
                        name: ann.name,
                        colour: ann.colour,
                        featureIds: [ ann.featureId ],
                        enabled: false,
                        pathIds: ('path-ids' in ann) ? ann['path-ids'] : [],
                        organs: this.#children(ann.children, FC_KIND.ORGAN)
                    })
                this.#ui.enableFeature(ann.featureId, false, true)
                }
                for (const childId of ann['children']) {
                    this.#enabledChildren.set(childId, 0)
                    this.#ui.enableFeatureWithChildren(childId, false, true)
                }
            }
        }
        for (const system of this.#systems.values()) {
            if (enabled) {
                this.#enableSystem(system, true)
            } else {
                // Disable all paths associated with the disabled system
                this.#ui.enablePathsBySystem(system, false, true)
            }
        }
    }

    #children(childFeatureIds: GeoJSONId[], childClass: FC_CLASS_LIST): SystemFeature[]
    //=================================================================================
    {
        const children = []
        for (const childFeatureId of childFeatureIds || []) {
            const childAnnotation = this.#flatmap.annotation(childFeatureId)
            if (childAnnotation && childClass.includes(childAnnotation['fc-class'])) {
                const child: SystemFeature = {
                    label: childAnnotation.label,
                    models: childAnnotation.models
                }
                if (childClass === FC_KIND.ORGAN) {
                    child.ftus = this.#children(childAnnotation.children, FC_KIND.FTU)
                }
                children.push(child)
            }
        }
        return children
    }

    get systems(): System[]
    //=====================
    {
        const systems = []
        for (const [systemId, system] of this.#systems.entries()) {
            systems.push({
                id: systemId,
                name: system.name,
                colour: system.colour,
                enabled: system.enabled,
                organs: system.organs
            })
        }
        return systems
    }

    enable(systemId: string, enable: boolean=true)
    //============================================
    {
        const system = this.#systems.get(systemId)
        if (system && enable !== system.enabled) {
            this.#enableSystem(system, enable)
        }
    }

    #enableSystem(system: SystemDetail, enable: boolean=true)
    //=======================================================
    {
        for (const featureId of system.featureIds) {
            const feature = this.#ui.mapFeature(featureId)
            if (feature) {
                this.#ui.enableMapFeature(feature, enable)
                for (const childFeatureId of feature.children) {
                    const enabledCount = this.#enabledChildren.get(childFeatureId)
                    if (enable && enabledCount === 0 || !enable && enabledCount === 1) {
                        this.#ui.enableFeatureWithChildren(childFeatureId, enable)
                    }
                    this.#enabledChildren.set(childFeatureId, enabledCount + (enable ? 1 : -1))
                }
            }
        }

        // Enable/disable all paths associated with the system
        this.#ui.enablePathsBySystem(system, enable)

        // Save system state
        system.enabled = enable
    }

    systemEnabled(systemId: string)
    //=============================
    {
        const system = this.#systems.get(systemId)
        return system?.enabled
    }
}

//==============================================================================
