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
import type { UserInteractions } from '../interactions'
import type { NerveCentrelineDetails } from '../pathways'

//==============================================================================

export class NerveCentrelineControl
{
    #button: HTMLButtonElement|null = null
    #checkedCount: number = 0
    #container: HTMLDivElement|null = null
    #halfCount: number = 0
    #legend: HTMLDivElement|null = null
    #nerves: NerveCentrelineDetails[] = []
    #showCentrelines = false
    #checkedNerves: Map<string, boolean> = new Map()
    #ui: UserInteractions

    constructor(_flatmap: FlatMap, ui: UserInteractions)
    {
        this.#ui = ui
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
        this.#container.id = 'centreline-nerve-ctrl'
        this.#container.className = 'maplibregl-ctrl'

        this.#legend = document.createElement('div')
        this.#legend.id = 'centreline-key-text'
        this.#legend.className = 'flatmap-nerve-grid centreline-nerve-grid'
        this.#nerves = this.#ui.getNerveDetails()
                               .sort((a, b) => a.label.localeCompare(b.label))

        const innerHTML = []
        innerHTML.push(`<label class="heading" for="nerve-all-nerves">PATH NERVES:</label></div><input id="nerve-all-nerves" type="checkbox" checked/>`)
        innerHTML.push(`<label for="show-centrelines">Show centrelines?</label></div><input id="show-centrelines" type="checkbox"/>`)
        innerHTML.push(`<label for="nerve-NO-NERVES">No associated nerves</label></div><input id="nerve-NO-NERVES" type="checkbox" checked/>`)
        for (const nerve of this.#nerves) {
            if (nerve.models !== 'NO-NERVES') {
                innerHTML.push(`<label for="nerve-${nerve.models}">${nerve.label}</label></div><input id="nerve-${nerve.models}" type="checkbox" checked/>`)
            }
        }
        this.#checkedNerves = new Map(this.#nerves.map(nerve => [nerve.models, true]))
        this.#legend.innerHTML = innerHTML.join('\n')
        this.#checkedCount = this.#nerves.length
        this.#halfCount = Math.trunc(this.#nerves.length/2)

        this.#button = document.createElement('button')
        this.#button.id = 'centreline-key-button'
        this.#button.className = 'control-button text-button'
        this.#button.setAttribute('type', 'button')
        this.#button.setAttribute('aria-label', 'Neuron paths associated with nerves')
        this.#button.setAttribute('control-visible', 'false')
        this.#button.textContent = 'NERVES'
        this.#button.title = 'Show/hide neuron paths associated with nerves'
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
        if (event.target.id === 'centreline-key-button') {
            if (this.#button.getAttribute('control-visible') === 'false') {
                this.#container.appendChild(this.#legend)
                this.#button.setAttribute('control-visible', 'true')
                const allNervesCheckbox = <HTMLInputElement>document.getElementById('nerve-all-nerves')
                allNervesCheckbox.indeterminate = this.#checkedCount < this.#nerves.length
                                                && this.#checkedCount > 0
                this.#legend.focus()
            } else {
                this.#legend = this.#container.removeChild(this.#legend)
                this.#button.setAttribute('control-visible', 'false')
            }
        } else if (event.target.tagName === 'INPUT') {
            if (event.target.id === 'nerve-all-nerves') {
                if (event.target.indeterminate) {
                    event.target.checked = (this.#checkedCount >= this.#halfCount)
                    event.target.indeterminate = false
                }
                if (event.target.checked) {
                    this.#checkedCount = this.#nerves.length
                } else {
                    this.#checkedCount = 0
                }
                for (const nerve of this.#nerves) {
                    const nerveCheckbox = <HTMLInputElement>document.getElementById(`nerve-${nerve.models}`)
                    if (nerveCheckbox) {
                        nerveCheckbox.checked = event.target.checked
                    }
                }
                this.#ui.enableNeuronPathsByNerve(this.#nerves.map(n => n.models), event.target.checked, this.#showCentrelines)
                this.#checkedNerves = new Map(this.#nerves.map(nerve => [nerve.models, event.target.checked]))
            } else if (event.target.id.startsWith('nerve-')) {
                const nerveModels = event.target.id.substring(6)
                this.#ui.enableNeuronPathsByNerve(nerveModels, event.target.checked, this.#showCentrelines)
                this.#checkedNerves.set(nerveModels, event.target.checked)
                if (event.target.checked) {
                    this.#checkedCount += 1
                } else {
                    this.#checkedCount -= 1
                }
                const allNervesCheckbox = <HTMLInputElement>document.getElementById('nerve-all-nerves')
                if (this.#checkedCount === 0) {
                    allNervesCheckbox.checked = false
                    allNervesCheckbox.indeterminate = false
                } else if (this.#checkedCount === this.#nerves.length) {
                    allNervesCheckbox.checked = true
                    allNervesCheckbox.indeterminate = false
                } else {
                    allNervesCheckbox.indeterminate = true
                }
            } else if (event.target.id === 'show-centrelines') {
                this.#showCentrelines = event.target.checked
                const checkedNerves = [...this.#checkedNerves.entries()].filter(e => e[1]).map(e => e[0])
                this.#ui.enableNeuronPathsByNerve(checkedNerves, true, this.#showCentrelines)
            }
        }
        event.stopPropagation()
    }
}

//==============================================================================
