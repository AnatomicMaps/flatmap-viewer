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
import type { PathType } from '../pathways'

//==============================================================================

export class PathControl
{
    #button: HTMLButtonElement|null = null
    #checkedCount: number = 0
    #container: HTMLDivElement|null = null
    #flatmap: FlatMap
    #halfCount: number = 0
    #legend: HTMLDivElement|null = null
    #pathTypes: PathType[]

    constructor(flatmap: FlatMap, pathTypes: PathType[])
    {
        this.#flatmap = flatmap
        this.#pathTypes = pathTypes
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
        this.#container.id = 'flatmap-nerve-key'

        this.#legend = document.createElement('div')
        this.#legend.id = 'nerve-key-text'
        this.#legend.className = 'flatmap-nerve-grid'

        const innerHTML = []
        innerHTML.push(`<label class="heading" for="path-all-paths">PATH TYPES:</label><div class="nerve-line"></div><input id="path-all-paths" type="checkbox" checked/>`)
        this.#checkedCount = 0
        for (const path of this.#pathTypes) {
            const checked =  !('enabled' in path) || path.enabled ? 'checked' : ''
            if (checked != '') {
                this.#checkedCount += 1
            }
            const colour = path.colour || '#440'
            const style = path.dashed ? `background: repeating-linear-gradient(to right,${colour} 0,${colour} 6px,transparent 6px,transparent 9px);`
                                      : `background: ${colour};`

            innerHTML.push(`<label for="path-${path.type}">${path.label}</label><div class="nerve-line" style="${style}"></div><input id="path-${path.type}" type="checkbox" ${checked}/>`)
        }
        this.#legend.innerHTML = innerHTML.join('\n')
        this.#halfCount = Math.trunc(this.#pathTypes.length/2)

        this.#button = document.createElement('button')
        this.#button.id = 'nerve-key-button'
        this.#button.className = 'control-button text-button'
        this.#button.setAttribute('type', 'button')
        this.#button.setAttribute('aria-label', "Neuron path type's legend")
        this.#button.setAttribute('control-visible', 'false')
        this.#button.textContent = 'PATHS'
        this.#button.title = 'Show/hide neuron paths by type'
        this.#container.appendChild(this.#button)

        this.#container.addEventListener('click', this.onClick_.bind(this))
        return this.#container
    }

    onRemove()
    //========
    {
        this.#container.parentNode.removeChild(this.#container)
    }

    onClick_(event)
    //=============
    {
        if (event.target.id === 'nerve-key-button') {
            if (this.#button.getAttribute('control-visible') === 'false') {
                this.#container.appendChild(this.#legend)
                this.#button.setAttribute('control-visible', 'true')
                const allPathsCheckbox = <HTMLInputElement>document.getElementById('path-all-paths')
                allPathsCheckbox.indeterminate = this.#checkedCount < this.#pathTypes.length
                                              && this.#checkedCount > 0
                this.#legend.focus()
            } else {
                this.#legend = this.#container.removeChild(this.#legend)
                this.#button.setAttribute('control-visible', 'false')
            }
        } else if (event.target.tagName === 'INPUT') {
            if (event.target.id === 'path-all-paths') {
                if (event.target.indeterminate) {
                    event.target.checked = (this.#checkedCount >= this.#halfCount)
                    event.target.indeterminate = false
                }
                if (event.target.checked) {
                    this.#checkedCount = this.#pathTypes.length
                } else {
                    this.#checkedCount = 0
                }
                for (const path of this.#pathTypes) {
                    const pathCheckbox = <HTMLInputElement>document.getElementById(`path-${path.type}`)
                    if (pathCheckbox) {
                        pathCheckbox.checked = event.target.checked
                    }
                }
                this.#flatmap.enablePath(this.#pathTypes.map(pt => pt.type), event.target.checked)
            } else if (event.target.id.startsWith('path-')) {
                const pathType = event.target.id.substring(5)
                this.#flatmap.enablePath(pathType, event.target.checked)
                if (event.target.checked) {
                    this.#checkedCount += 1
                } else {
                    this.#checkedCount -= 1
                }
                const allPathsCheckbox = <HTMLInputElement>document.getElementById('path-all-paths')
                if (this.#checkedCount === 0) {
                    allPathsCheckbox.checked = false
                    allPathsCheckbox.indeterminate = false
                } else if (this.#checkedCount === this.#pathTypes.length) {
                    allPathsCheckbox.checked = true
                    allPathsCheckbox.indeterminate = false
                } else {
                    allPathsCheckbox.indeterminate = true
                }
            }
        }
        event.stopPropagation()
    }
}

//==============================================================================
