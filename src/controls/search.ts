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

import type * as maplibregl from 'maplibre-gl'

//==============================================================================

import type {FlatMap} from '../flatmap'

//==============================================================================

export class SearchControl
{
    #button: HTMLButtonElement|null = null
    #container: HTMLDivElement|null = null
    #flatmap: FlatMap
    #input: HTMLInputElement|null = null

    constructor(flatmap: FlatMap)
    {
        this.#flatmap = flatmap
    }

    onAdd(_map: maplibregl.Map)
    //=========================
    {
        this.#container = document.createElement('div')
        this.#container.className = 'maplibregl-ctrl search-control'

        this.#input = document.createElement('input')
        this.#input.id = 'search-control-input'
        this.#input.setAttribute('type', 'search')
        this.#input.setAttribute('visible', 'false')
        this.#input.setAttribute('placeholder', 'Search...')

        this.#button = document.createElement('button')
        this.#button.id = 'search-control-button'
        this.#button.className = 'control-button'
        this.#button.title = 'Search flatmap'
        this.#button.setAttribute('type', 'button')
        this.#button.setAttribute('aria-label', 'Search flatmap')
        // https://iconmonstr.com/magnifier-6-svg/
        this.#button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" id="search-control-icon" viewBox="0 0 24 24">
    <path d="M21.172 24l-7.387-7.387c-1.388.874-3.024 1.387-4.785 1.387-4.971 0-9-4.029-9-9s4.029-9 9-9 9 4.029 9 9c0 1.761-.514 3.398-1.387 4.785l7.387 7.387-2.828 2.828zm-12.172-8c3.859 0 7-3.14 7-7s-3.141-7-7-7-7 3.14-7 7 3.141 7 7 7z"/>
</svg>`
        this.#container.appendChild(this.#button)

        this.#container.onclick = this.onClick_.bind(this)
        return this.#container
    }

    getDefaultPosition(): maplibregl.ControlPosition
    //==============================================
    {
        return 'top-right'
    }

    onRemove()
    //========
    {
        this.#container.parentNode.removeChild(this.#container)
    }

    searchMap_(search: boolean=true)
    //==============================
    {
        this.#input = this.#container.removeChild(this.#input)
        this.#input.setAttribute('visible', 'false')
        const text = this.#input.value
        if (search && text !== '') {
            const results = this.#flatmap.search(text)
            this.#flatmap.showSearchResults(results)
        }
    }

    onKeyDown_(e)
    //===========
    {
        if (e.key === 'Enter') {
            this.searchMap_()
        } else if (e.key === 'Escape') {
            this.searchMap_(false)
        }
    }

    onClick_(e)
    //=========
    {
        const targetId = ('rangeTarget' in e) ? e.rangeTarget.id : e.target.id // FF has rangeTarget
        if (['search-control-button', 'search-control-icon'].includes(targetId)) {
            if (this.#input.getAttribute('visible') === 'false') {
                this.#container.appendChild(this.#input)
                this.#container.appendChild(this.#button)
                this.#input.setAttribute('visible', 'true')
                this.#input.onkeydown = this.onKeyDown_.bind(this)
                this.#input.value = ''
                this.#flatmap.clearSearchResults()
                this.#input.focus()
            } else {
                this.searchMap_()
            }
        }
    }
}

//==============================================================================
