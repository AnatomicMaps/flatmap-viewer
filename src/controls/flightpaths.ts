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

import type { FlatMap } from '../flatmap'

//==============================================================================

export class FlightPathControl
{
    #button: HTMLButtonElement|null = null
    #container: HTMLDivElement|null = null
    #enabled: boolean = false
    #flatmap: FlatMap

    constructor(flatmap: FlatMap, enabled: boolean)
    {
        this.#flatmap = flatmap
        this.#enabled = !!enabled
    }

    getDefaultPosition(): maplibregl.ControlPosition
    //==============================================
    {
        return 'top-right'
    }

    onAdd(_map: maplibregl.Map)
    //=========================
    {
        this.#container = document.createElement('div')
        this.#container.className = 'maplibregl-ctrl'
        this.#button = document.createElement('button')
        this.#button.className = 'control-button text-button'
        this.#button.setAttribute('type', 'button')
        this.#button.setAttribute('aria-label', 'Show flight paths')
        this.#button.textContent = '3D'
        this.#button.title = 'Show/hide flight paths'
        this.#container.appendChild(this.#button)
        this.#container.addEventListener('click', this.#onClick.bind(this))
        if (this.#enabled) {
            this.#button.classList.add('control-active')
            this.#setBackground()
        }
        return this.#container
    }

    onRemove()
    //========
    {
        this.#container.parentNode.removeChild(this.#container)
    }

    #setBackground()
    //==============
    {
        if (this.#enabled) {
            this.#button.setAttribute('style', 'background: red')
        } else {
            this.#button.removeAttribute('style')
        }
    }

    #onClick(_event)
    //==============
    {
        if (this.#button.classList.contains('control-active')) {
            this.#flatmap.enableFlightPaths(false)
            this.#button.classList.remove('control-active')
            this.#enabled = false
        } else {
            this.#flatmap.enableFlightPaths(true)
            this.#button.classList.add('control-active')
            this.#enabled = true
        }
        this.#setBackground()
    }
}

//==============================================================================
