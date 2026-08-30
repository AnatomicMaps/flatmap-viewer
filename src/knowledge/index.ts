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

import {DiGraph, type NodeLinkGraph} from './graphs'

//==============================================================================

const BODY_PROPER = 'UBERON:0013702'
//const MULTICELLULAR_ORGANISM = 'UBERON:0000468'

export const ANATOMICAL_ROOT = BODY_PROPER

//==============================================================================

export class MapTermGraph
{
    #hierarchy: DiGraph = new DiGraph()

    get maxDepth(): number
    //====================
    {
        const d = this.#hierarchy.getAttribute('depth')
        return +d
    }

    load(termGraph: NodeLinkGraph)
    //============================
    {
        this.#hierarchy.load(termGraph)
    }

    connectedTermGraph(terms: string[])
    //=================================
    {
        return this.#hierarchy.connectedSubgraph([ANATOMICAL_ROOT, ...terms])
    }

    depth(term: string): number
    //=========================
    {
        if (this.hasTerm(term)) {
            const depth = this.#hierarchy.getNodeAttribute(term, 'depth')
            if (depth !== undefined) {
                return +depth
            }
        }
        return -1
    }

    hasTerm(term: string): boolean
    //============================
    {
        return this.#hierarchy.hasNode(term)
    }

    parents(term: string): string[]
    //=============================
    {
        return this.#hierarchy.parents(term)
    }
}

//==============================================================================
//==============================================================================
