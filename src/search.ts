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

import MiniSearch, {type Suggestion} from 'minisearch'

//==============================================================================

import type {FlatMapFeatureAnnotation} from './flatmap-types'
import type {GeoJSONId} from './flatmap-types'

//==============================================================================

// The properties of a feature we index and show

export const indexedProperties = [
    'id',
    'label',
    'models',
    'source'
]

//==============================================================================

export class SearchIndex
{
    #featureIds: GeoJSONId[] = []
    #searchEngine: MiniSearch

    constructor()
    {
        this.#searchEngine =  new MiniSearch({
            fields: ['text'],
            storeFields: ['text'],
            tokenize: (string, _fieldName) => string.split(' ')
        })
    }

    indexMetadata(featureId: GeoJSONId, metadata: FlatMapFeatureAnnotation)
    //=====================================================================
    {
        const textSeen: string[] = []
        for (const prop of indexedProperties) {
            if (prop in metadata) {
                const text = metadata[prop]
                if (!textSeen.includes(text)) {
                    this.indexText(featureId, text)
                    textSeen.push(text)
                }
            }
        }
    }

    indexText(featureId: GeoJSONId, text: string)
    //===========================================
    {
        text = text.replace(/<br\/>/g, ' ')
                   .replace(/\n/g, ' ')
        if (text) {
            this.#searchEngine.add({
                id: this.#featureIds.length,
                text: text
            })
            this.#featureIds.push(featureId)
        }
    }

    auto_suggest(text: string): Suggestion[]
    //======================================
    {
        return this.#searchEngine.autoSuggest(text, {prefix: true})
    }

    search(text: string): SearchResults
    //=================================
    {
        let results = []
        text = text.trim()
        if (text.length > 2 && ["'", '"'].includes(text.slice(0, 1))) {
            text = text.replaceAll(text.slice(0, 1), '')
            results = this.#searchEngine.search(text, {prefix: true, combineWith: 'AND'})
        } else if (text.length > 1) {
            results = this.#searchEngine.search(text, {prefix: true})
        }
        const featureResults = results.map(r => {
            return {
                featureId: this.#featureIds[r.id],
                score: r.score,
                terms: r.terms,
                text: r.text
            }})
        return new SearchResults(featureResults)
    }
}

//==============================================================================

export type SearchResult = {
    featureId: GeoJSONId
    score: number
    terms: string[]
    text: string
}

//==============================================================================

export class SearchResults
{
    #featureIds: GeoJSONId[]
    #results: SearchResult[]

    constructor(results: SearchResult[])
    {
        this.#results = results.sort((a, b) => (b.score - a.score))
        this.#featureIds = results.map(r => r.featureId)
    }

    get featureIds(): GeoJSONId[]
    {
        return this.#featureIds
    }

    get results(): SearchResult[]
    {
        return this.#results
    }
}

//==============================================================================
