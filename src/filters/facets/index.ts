/*==============================================================================

Flatmap viewer and annotation tool

Copyright (c) 2019 - 2024 David Brooks

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

import type {PropertiesType} from '../../types'

import {PropertiesFilter} from '..'

//==============================================================================

export interface FacetState
{
    id: string
    label?: string
    enabled?: boolean
    properties?: PropertiesType
}

//==============================================================================

class InternalState
{
    #id: string
    #label: string
    #enabled: boolean
    #properties: PropertiesType

    constructor(state: FacetState)
    {
        this.#id = state.id
        this.#label = state.label || state.id
        this.#enabled = ('enabled' in state) ? state.enabled : true
        this.#properties = ('properties' in state && state.properties) || {}
    }

    get enabled()
    //===========
    {
        return this.#enabled
    }

    get id()
    //======
    {
        return this.#id
    }

    get label()
    //=========
    {
        return this.#label
    }

    get properties()
    //==============
    {
        return this.#properties
    }

    // Returns true if state changed
    enable(enable: boolean=true): boolean
    //===================================
    {
        if (this.#enabled != enable) {
            this.#enabled = enable
            return true
        }
        return false
    }
}

//==============================================================================

export class Facet
{
    #id: string
    #states: Map<string, InternalState>

    constructor(id: string, states: FacetState[])
    {
        this.#id = id
        this.#states = new Map(states.map(s => [s.id, new InternalState(s)]))
    }

    get id()
    //======
    {
        return this.#id
    }

    get size()
    //========
    {
        return this.#states.size
    }

    get enabledStates(): string[]
    //===========================
    {
        return [...this.#states.values()].filter(s => s.enabled).map(s => s.id)
    }

    // Returns true if state changed
    enable(state: string, enable: boolean=true): boolean
    //==================================================
    {
        return this.#states.has(state) && this.#states.get(state).enable(enable)
    }

    enabled(state: string): boolean
    //=============================
    {
        return this.#states.has(state) && this.#states.get(state).enabled
    }
}

//==============================================================================

export class FilteredFacet
{
    #facet: Facet

    constructor(facet: Facet)
    {
        this.#facet = facet
    }

    get facet()
    //=========
    {
        return this.#facet
    }

    get id()
    //======
    {
        return this.#facet.id
    }

    enable(idList: string[], enable: boolean=true)
    //============================================
    {
        idList.forEach(id => this.#facet.enable(id, enable))
    }

    makeFilter(): PropertiesFilter
    //============================
    {
        return new PropertiesFilter(true)
    }
}

//==============================================================================
